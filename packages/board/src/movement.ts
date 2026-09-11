/**
 * Where a model can go.
 *
 * Movement is measured across the table, but it is paid for in three dimensions: climbing a ruin to
 * its first floor costs the height you climb. So reachability is a shortest-path search over the
 * *surfaces* of the table — the ground, and every floor of every piece standing on it — rather than
 * over a flat grid.
 *
 * The numbers that make it a rules question rather than a geometry one live in `MoveRules`, which
 * the game-system plugin supplies. Nothing here knows what edition it is playing.
 */

import type { ModelHull } from "./shapes";
import { footReach } from "./shapes";
import type { BoardSize } from "./board";
import { onBoard } from "./board";
import type { TerrainPiece , TerrainIndex} from "./terrain";
import { floorHeights, hasTrait, mayClimb, topOf } from "./terrain";
import { ENGAGEMENT_HORIZONTAL, ENGAGEMENT_VERTICAL, horizontalGap, inEngagementRange, verticalGap } from "./distance";
import type { Vec2, Vec3 } from "./vec";
import { EPS, dist2, norm2 } from "./vec";

export interface MoveRules {
  /** Terrain no taller than this is stepped over at no cost. */
  readonly stepOver: number;
  /** Movement charged per inch climbed or descended beyond `stepOver`. */
  readonly climbCost: number;
  /** Multiplier applied while crossing a `difficult` footprint. */
  readonly difficultMultiplier: number;
  /** Sampling resolution of the search lattice, in inches. Smaller is slower and more exact. */
  readonly resolution: number;
  /** Two surfaces this far apart in height count as the same storey. */
  readonly floorTolerance: number;
}

/**
 * Defaults matching 10th and 11th edition: terrain 2" or less is ignored, climbing costs its height,
 * and there is no difficult ground. An edition that disagrees passes its own numbers.
 */
export const MOVE_RULES: MoveRules = {
  stepOver: 2,
  climbCost: 1,
  difficultMultiplier: 1,
  resolution: 0.5,
  floorTolerance: 0.1,
};

export interface ReachOptions {
  readonly rules?: Partial<MoveRules>;
  /** Keywords the moving model has; they open `passableBy` terrain. */
  readonly keywords?: readonly string[];
  /** Enemy models. The move may not end — or pass — within engagement range of one. */
  readonly enemies?: readonly ModelHull[];
  /** Other models whose bases the mover cannot move through. */
  readonly blockers?: readonly ModelHull[];
  /** A charge or a pile-in may close to engagement range; a normal move may not. */
  readonly allowEngagement?: boolean;
  /** The table. Given, no position that puts any of the base over its edge is reachable. */
  readonly board?: BoardSize;
  /** Stop as soon as this returns true for a settled node — used by the charge search. */
  readonly until?: (at: Vec3) => boolean;
}

/** One position the model can occupy, with the cheapest way to get there. */
export interface ReachNode {
  readonly at: Vec3;
  /** Inches of movement spent reaching it. */
  readonly cost: number;
  /** Index of the previous node on the cheapest path, or -1 for the starting position. */
  readonly from: number;
}

export interface ReachResult {
  readonly nodes: readonly ReachNode[];
  /** The node the search stopped on when `until` was given and met. */
  readonly stoppedAt?: number;
  /** Cheapest node within half a cell of `at`, at `z` when given. */
  find(at: Vec2, z?: number): number | undefined;
  /** The cheapest path to a node, starting position first. */
  pathTo(index: number): Vec3[];
}

/**
 * Every position the model can end its move in, and what each costs.
 *
 * A Dijkstra search over a lattice of (cell, surface) nodes: eight-way steps across the table, plus
 * transitions between the surfaces stacked over one cell. The search settles nodes in cost order, so
 * `until` can stop it the moment a charge target comes into reach.
 */
export function reachable(model: ModelHull, budget: number, index: TerrainIndex, opts: ReachOptions = {}): ReachResult {
  const rules = { ...MOVE_RULES, ...opts.rules };
  const step = rules.resolution;
  const keywords = new Set((opts.keywords ?? []).map((k) => k.toUpperCase()));
  const origin: Vec2 = { x: model.pos.x, y: model.pos.y };

  const surfaces = new SurfaceMap(model, index, rules, keywords);
  // The search never leaves `budget + step` of the origin, so a model further away than that plus
  // both reaches can never be touched — and a charge search across a full table would otherwise
  // measure every enemy on it at every step.
  const horizon = budget + step + footReach(model.foot) + ENGAGEMENT_HORIZONTAL + EPS;
  const nearby = (hulls: readonly ModelHull[] | undefined) => hulls?.filter((h) => dist2(h.pos, origin) <= horizon + footReach(h.foot));
  const near: ReachOptions = { ...opts, enemies: nearby(opts.enemies), blockers: nearby(opts.blockers) };
  const board = opts.board;
  const legal = (at: Vec3): boolean => (!board || onBoard({ ...model, pos: at }, board)) && surfaces.standable(at) && !obstructed(at, model, near);

  const nodes: ReachNode[] = [{ at: model.pos, cost: 0, from: -1 }];
  const byKey = new Map<string, number>([[key(model.pos, step, rules.floorTolerance), 0]]);
  const settled = new Set<number>();
  const heap = new MinHeap();
  heap.push(0, 0);

  // A cell is reached from up to eight neighbours, and whether the model may stand there does not
  // depend on which. Both answers are remembered per cell, which is most of the search's work saved.
  const heightsByCell = new Map<string, number[]>();
  const legalByKey = new Map<string, boolean>();

  let stoppedAt: number | undefined;

  while (heap.size > 0) {
    const current = heap.pop()!;
    if (settled.has(current)) continue;
    settled.add(current);
    const here = nodes[current]!;
    if (here.cost > budget + EPS) continue;

    // The starting position counts. If the model is already where it needs to be, the answer is
    // zero — excluding it turns "you are already there" into "you cannot get there".
    if (opts.until?.(here.at)) {
      stoppedAt = current;
      break;
    }

    for (const next of neighbours(here.at, origin, budget, step)) {
      const cell = `${Math.round(next.x / step)}:${Math.round(next.y / step)}`;
      let heights = heightsByCell.get(cell);
      if (!heights) {
        heights = surfaces.at(next);
        heightsByCell.set(cell, heights);
      }
      for (const z of heights) {
        const to: Vec3 = { x: next.x, y: next.y, z };
        const cost = here.cost + stepCost(here.at, to, index, rules);
        if (cost > budget + EPS) continue;
        const k = key(to, step, rules.floorTolerance);
        const seen = byKey.get(k);
        if (seen !== undefined && nodes[seen]!.cost <= cost + EPS) continue;
        let ok = legalByKey.get(k);
        if (ok === undefined) {
          ok = legal(to);
          legalByKey.set(k, ok);
        }
        if (!ok || !passable(here.at, to, model, index, rules, keywords, near)) continue;
        if (seen === undefined) {
          byKey.set(k, nodes.length);
          nodes.push({ at: to, cost, from: current });
          heap.push(nodes.length - 1, cost);
        } else {
          nodes[seen] = { at: to, cost, from: current };
          heap.push(seen, cost);
        }
      }
    }
  }

  return {
    nodes,
    stoppedAt,
    find(at: Vec2, z?: number): number | undefined {
      let best: number | undefined;
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i]!;
        if (dist2(n.at, at) > step * 0.75) continue;
        if (z !== undefined && Math.abs(n.at.z - z) > rules.floorTolerance) continue;
        if (best === undefined || n.cost < nodes[best]!.cost) best = i;
      }
      return best;
    },
    pathTo(target: number): Vec3[] {
      const out: Vec3[] = [];
      for (let i = target; i >= 0; i = nodes[i]!.from) out.push(nodes[i]!.at);
      return out.reverse();
    },
  };
}

/** Can this model stand with its base centred here, given the terrain? */
export function canStand(model: ModelHull, at: Vec3, index: TerrainIndex, opts: ReachOptions = {}): boolean {
  const rules = { ...MOVE_RULES, ...opts.rules };
  const keywords = new Set((opts.keywords ?? []).map((k) => k.toUpperCase()));
  return new SurfaceMap(model, index, rules, keywords).standable(at) && !obstructed(at, model, opts);
}

/* ---- charging --------------------------------------------------------------------------------- */

/** The longest a 2D6 charge can ever roll, and so the furthest the search needs to look. */
export const MAX_CHARGE = 12;

export interface ChargeResult {
  /** Inches the closest model must travel to reach engagement range. `Infinity` when it cannot. */
  readonly distance: number;
  /** The 2D6 result needed, or `Infinity` when no roll is enough. */
  readonly minimumRoll: number;
  /** Index into `unit` of the model that gets there first. */
  readonly model?: number;
  /** The route it takes, starting position first. */
  readonly path: readonly Vec3[];
}

/**
 * What the unit needs to roll to make the charge.
 *
 * The rules ask more of a real charge — every model moves, coherency must hold, and the closest
 * model must reach engagement range — but the roll is decided by that closest model's route, so that
 * is what this measures. It searches a legal path, not a straight line, so a ruin between the two
 * units lengthens the charge exactly as it does on a table.
 */
export function chargeGeometry(unit: readonly ModelHull[], targets: readonly ModelHull[], index: TerrainIndex, opts: ReachOptions = {}): ChargeResult {
  let best: ChargeResult = { distance: Infinity, minimumRoll: Infinity, path: [] };
  const search: ReachOptions = { ...opts, allowEngagement: true };
  const rules = { ...MOVE_RULES, ...opts.rules };

  // Nearest first: the closest model usually sets the answer, and every model after it only has to
  // be searched as far as that answer, which is most of the work saved.
  const order = unit.map((_, i) => i).sort((a, b) => straightGap(unit[a]!, targets) - straightGap(unit[b]!, targets));

  for (const i of order) {
    const model = unit[i]!;
    // A straight line is the shortest a route can be, so it is a lower bound on the charge: a model
    // whose lower bound already fails needs no search at all. Without this a hopeless charge across
    // a table costs a full 12" flood fill per model.
    const floor = straightGap(model, targets) - ENGAGEMENT_HORIZONTAL;
    if (floor > MAX_CHARGE + EPS || floor >= best.distance) continue;
    const reach = reachable(model, Math.min(MAX_CHARGE, best.distance), index, search);
    for (let n = 0; n < reach.nodes.length; n++) {
      const node = reach.nodes[n]!;
      if (node.cost >= best.distance) continue;
      for (const target of targets) {
        const dash = dashToEngage(model, node.at, target);
        if (dash === undefined) continue;
        const total = node.cost + dash;
        if (total > MAX_CHARGE + EPS || total >= best.distance) continue;
        const arrival = advance(node.at, target, dash);
        if (dash > EPS && !clearRun(model, node.at, arrival, index, search, rules.resolution)) continue;
        const path = reach.pathTo(n);
        if (dash > EPS) path.push(arrival);
        best = { distance: total, minimumRoll: Math.max(2, Math.ceil(total - EPS)), model: i, path };
      }
    }
  }
  return best;
}

/** Closest a model is to any target as the crow flies — a lower bound on the charge it must make. */
function straightGap(model: ModelHull, targets: readonly ModelHull[]): number {
  let best = Infinity;
  for (const t of targets) best = Math.min(best, horizontalGap(model, t));
  return best;
}

/**
 * How far the model must dash, level and straight at the target, to reach engagement range — or
 * undefined when no level dash can (the target is more than five inches above or below).
 *
 * The lattice can only stop on half-inch cells, which would round a 5.74" charge up to 6". Since the
 * last leg of a charge is a straight run, it can be measured exactly, and the difference is the
 * difference between needing a 6 and needing a 7.
 */
function dashToEngage(model: ModelHull, at: Vec3, target: ModelHull): number | undefined {
  const here: ModelHull = { ...model, pos: at };
  if (verticalGap(here, target) > ENGAGEMENT_VERTICAL) return undefined;
  const gap = horizontalGap(here, target);
  if (gap <= ENGAGEMENT_HORIZONTAL) return 0;

  // Closing the whole gap puts the bases flush, so it is an upper bound — unless the target's shape
  // means a run at its centre never gets there, in which case there is no straight answer.
  let hi = gap;
  if (horizontalGap({ ...model, pos: advance(at, target, hi) }, target) > ENGAGEMENT_HORIZONTAL) return undefined;
  let lo = 0;
  for (let step = 0; step < 24; step++) {
    const mid = (lo + hi) / 2;
    if (horizontalGap({ ...model, pos: advance(at, target, mid) }, target) <= ENGAGEMENT_HORIZONTAL) hi = mid;
    else lo = mid;
  }
  return hi;
}

/**
 * Is a straight, level run clear the whole way?
 *
 * The lattice validated where the dash starts; the dash itself still has to get there, and a run
 * that ends on open ground can perfectly well have crossed a building to do it.
 */
function clearRun(model: ModelHull, from: Vec3, to: Vec3, index: TerrainIndex, opts: ReachOptions, step: number): boolean {
  const steps = Math.max(1, Math.ceil(dist2(from, to) / step));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const at: Vec3 = { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t, z: from.z };
    if (!canStand(model, at, index, opts)) return false;
  }
  return true;
}

/** `at` moved `by` inches straight at the target, staying level. */
function advance(at: Vec3, target: ModelHull, by: number): Vec3 {
  const d = norm2({ x: target.pos.x - at.x, y: target.pos.y - at.y });
  return { x: at.x + d.x * by, y: at.y + d.y * by, z: at.z };
}

/* ---- surfaces --------------------------------------------------------------------------------- */

/**
 * The heights a model may stand at over a given point.
 *
 * A piece with floors is *hollow*: its interior is open at each floor level, which is what makes a
 * ruin something to walk into rather than around. A piece without floors is a solid block — a model
 * stands on nothing but the ground beside it. Hollow or not, a `breachable` piece's footprint is its
 * walls, and only the keywords it names may be inside them.
 */
class SurfaceMap {
  constructor(
    private readonly model: ModelHull,
    private readonly index: TerrainIndex,
    private readonly rules: MoveRules,
    private readonly keywords: ReadonlySet<string>,
  ) {}

  /**
   * Candidate standing heights over a point, lowest first. Low terrain keeps its surface — the
   * step-over allowance makes a 1.5" ruin free to climb, not invisible, and standing on top of it
   * still raises the model's eye line.
   */
  at(p: Vec2): number[] {
    const out = [0];
    for (const piece of this.index.at(p)) {
      if (!mayClimb(piece, this.keywords)) continue;
      for (const z of floorHeights(piece)) if (z > EPS) out.push(z);
    }
    return out.length > 1 ? [...new Set(out)].sort((a, b) => a - b) : out;
  }

  /** Can the model's base rest here without any solid running through it? */
  standable(at: Vec3): boolean {
    const reach = footReach(this.model.foot);
    for (const piece of this.index.near({ x: at.x, y: at.y }, reach)) {
      if (this.permitted(piece)) continue;
      if (this.occupies(piece, at)) return false;
    }
    return true;
  }

  /** Does this piece's solid fill the space the model would stand in? */
  occupies(piece: TerrainPiece, at: Vec3): boolean {
    if (piece.height <= this.rules.stepOver) return false; // stepped over
    if (at.z + this.model.height <= piece.base + EPS) return false; // the model is under it
    if (at.z >= topOf(piece) - EPS) return false; // the model is on top of it
    if (hasTrait(piece, "impassable")) return true;
    // Whoever may pass a ruin's walls was let through in `standable` before this was asked; anyone
    // still asking cannot be inside them, on any storey.
    if (hasTrait(piece, "breachable")) return true;
    // Inside a hollow piece the model must be on one of its storeys, not embedded in it.
    return !floorHeights(piece).some((z) => Math.abs(z - at.z) <= this.rules.floorTolerance);
  }

  permitted(piece: TerrainPiece): boolean {
    return piece.passableBy.some((k) => this.keywords.has(k.toUpperCase()));
  }

  climbable(piece: TerrainPiece): boolean {
    return mayClimb(piece, this.keywords);
  }
}

/* ---- step costs and legality ------------------------------------------------------------------ */

function stepCost(from: Vec3, to: Vec3, index: TerrainIndex, rules: MoveRules): number {
  const flat = dist2(from, to);
  const rise = Math.abs(to.z - from.z);
  const climb = rise <= rules.stepOver ? 0 : rise * rules.climbCost;
  const slow = rules.difficultMultiplier !== 1 && index.at({ x: to.x, y: to.y }, (p) => hasTrait(p, "difficult")).length > 0;
  return flat * (slow ? rules.difficultMultiplier : 1) + climb;
}

/** Is the transition itself legal — a climb that has something to climb, and a gap it can cross? */
function passable(from: Vec3, to: Vec3, model: ModelHull, index: TerrainIndex, rules: MoveRules, keywords: ReadonlySet<string>, opts: ReachOptions): boolean {
  const rise = Math.abs(to.z - from.z);
  if (rise > rules.stepOver) {
    // A climb needs a piece under one of the two points that can be climbed.
    const here = index.at({ x: to.x, y: to.y });
    const there = index.at({ x: from.x, y: from.y });
    const climbable = [...here, ...there].some((p) => mayClimb(p, keywords) && (hasTrait(p, "scalable") || p.floors.length > 1 || p.passableBy.some((k) => keywords.has(k.toUpperCase()))));
    if (!climbable) return false;
  }
  // Guard against slipping diagonally through a thin wall between two legal cells.
  const mid: Vec3 = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2, z: Math.max(from.z, to.z) };
  for (const piece of index.at({ x: mid.x, y: mid.y }, (p) => hasTrait(p, "impassable") || hasTrait(p, "breachable"))) {
    if (piece.passableBy.some((k) => keywords.has(k.toUpperCase()))) continue;
    if (mid.z < topOf(piece) - EPS && mid.z + model.height > piece.base + EPS) return false;
  }
  return !obstructed(mid, model, opts);
}

/** Enemy engagement and other models' bases, both of which a move must respect. */
function obstructed(at: Vec3, model: ModelHull, opts: ReachOptions): boolean {
  const here: ModelHull = { ...model, pos: at };
  if (!opts.allowEngagement) {
    for (const enemy of opts.enemies ?? []) if (inEngagementRange(here, enemy)) return true;
  }
  for (const other of opts.blockers ?? []) {
    if (other === model) continue;
    if (horizontalGap(here, other) <= EPS && Math.abs(other.pos.z - at.z) < model.height) return true;
  }
  return false;
}

/* ---- lattice ---------------------------------------------------------------------------------- */

const NEIGHBOURS: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

/** Cells adjacent to a position, snapped to the lattice and clipped to the budget's reach. */
function neighbours(at: Vec3, origin: Vec2, budget: number, step: number): Vec2[] {
  const out: Vec2[] = [];
  for (const [dx, dy] of NEIGHBOURS) {
    const p = { x: at.x + dx * step, y: at.y + dy * step };
    if (dist2(p, origin) > budget + step) continue;
    out.push(p);
  }
  return out;
}

const key = (p: Vec3, step: number, tol: number): string => `${Math.round(p.x / step)}:${Math.round(p.y / step)}:${Math.round(p.z / Math.max(tol, EPS))}`;

/** A binary min-heap keyed by cost. Small, and the search settles thousands of nodes. */
class MinHeap {
  private readonly items: { id: number; cost: number }[] = [];

  get size(): number {
    return this.items.length;
  }

  push(id: number, cost: number): void {
    const items = this.items;
    items.push({ id, cost });
    let i = items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (items[parent]!.cost <= items[i]!.cost) break;
      [items[parent], items[i]] = [items[i]!, items[parent]!];
      i = parent;
    }
  }

  pop(): number | undefined {
    const items = this.items;
    const top = items[0];
    if (!top) return undefined;
    const last = items.pop()!;
    if (items.length > 0) {
      items[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let small = i;
        if (l < items.length && items[l]!.cost < items[small]!.cost) small = l;
        if (r < items.length && items[r]!.cost < items[small]!.cost) small = r;
        if (small === i) break;
        [items[small], items[i]] = [items[i]!, items[small]!];
        i = small;
      }
    }
    return top.id;
  }
}
