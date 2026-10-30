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
import { coreSegment, footReach } from "./shapes";
import type { BoardSize } from "./board";
import { onBoard } from "./board";
import type { TerrainPiece , TerrainIndex} from "./terrain";
import { containsPoint, floorHeights, hasTrait, topOf } from "./terrain";
import { ENGAGEMENT_HORIZONTAL, ENGAGEMENT_VERTICAL, horizontalGap, inEngagementRange, verticalGap } from "./distance";
import type { Aabb2, Vec2, Vec3 } from "./vec";
import { EPS, bounds, dist2, inBox, norm2, segPolygonDistance } from "./vec";

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
  /** Keywords the moving model has, which open `passableBy` terrain. */
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
  /** Cheapest node within three quarters of a cell of `at`, at `z` when given. */
  find(at: Vec2, z?: number): number | undefined;
  /**
   * The first node the search settled within `radius` of `at`.
   *
   * That is the node a search told to stop within `radius` of `at` stops on, since the two searches
   * run the same steps up to that point. A search of everywhere the model can go therefore answers
   * for any destination.
   */
  firstWithin(at: Vec2, radius: number): number | undefined;
  /**
   * Every node in order of its distance from `at` across the table, nearest first, then by cost and
   * then by index. A caller looking for the nearest node that meets some test stops at the first
   * that does, having read only the nodes nearer than it.
   */
  byDistance(at: Vec2): Generator<number>;
  /** The cheapest path to a node, starting position first. */
  pathTo(index: number): Vec3[];
}

/**
 * Every position the model can end its move in, and what each costs.
 *
 * A Dijkstra search over a lattice of (cell, surface) nodes: eight-way steps across the table, plus
 * transitions between the surfaces stacked over one cell. The search settles nodes in cost order, so
 * `until` can stop it the moment a charge target comes into reach.
 *
 * Eight-way steps alone would charge a move at 22.5 degrees 8% more than its length. So a node may
 * also be reached by a straight, level run from the node its neighbour was reached from, at the
 * run's length, when the run is clear (see `StraightRuns`). In the open that makes every move cost
 * the straight line to where it ends. Climbs and changes of storey are still made by steps, so
 * climbing is charged exactly as before. A run is checked only when the node it reaches is the
 * cheapest left, and a node whose run is blocked falls back to the best clear way in and waits its
 * turn again, which keeps nodes settling in order of cost.
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
  const blocked = new Obstruction(model, { ...opts, enemies: nearby(opts.enemies), blockers: nearby(opts.blockers) });
  // The walls the model may not cross that reach into the search, gathered once: a wall standing
  // on a point the search asks about reaches within the horizon of the start.
  const walls = new Walls(index.near(origin, horizon, isWall).filter((p) => !p.passableBy.some((k) => keywords.has(k.toUpperCase()))), model.height);
  const board = opts.board;
  const legal = (at: Vec3): boolean => (!board || onBoard({ ...model, pos: at }, board)) && surfaces.standable(at) && !blocked.at(at);

  const zOf = (z: number): number => Math.round(z / Math.max(rules.floorTolerance, EPS));
  const cells = new Lattice(step, budget);
  /** The lattice point `(i, j)` steps from the start. Every node but the first stands on one. */
  const pointAt = (i: number, j: number): Vec2 => ({ x: origin.x + i * step, y: origin.y + j * step });
  const nodes: ReachNode[] = [{ at: model.pos, cost: 0, from: -1 }];
  /** Each node's cell, and whether its link to `from` is a straight run still to be checked. */
  const cellOf: [number, number][] = [[0, 0]];
  const unchecked = new Flags();
  cells.slot(cells.record(0, 0), zOf(model.pos.z)).node = 0;
  const settled = new Flags();
  /** The order nodes were settled in, by node. */
  const rank: number[] = [];
  let order = 0;
  const heap = new MinHeap();
  heap.push(0, 0);

  let stoppedAt: number | undefined;
  /** The furthest any node stands from the start, in cells along either axis. */
  let extent = 0;

  const sight = new StraightRuns(cells, pointAt, index, rules, surfaces, legal, (mid) => walls.clear(mid) && !blocked.at(mid), zOf);
  /** Can the model run straight and level from node `a` to the lattice point `to`? */
  const straightTo = (a: number, to: readonly [number, number]): boolean => sight.clear(cellOf[a]!, to, nodes[a]!.at.z, zOf(nodes[a]!.at.z));
  const straight = (a: number, b: number): boolean => straightTo(a, cellOf[b]!);
  /**
   * May the model step from `a` in cell `ac` to `b` in cell `(bi, bj)`? A level step asks the point halfway
   * along it, which a straight run across the same ground asks too, so the answer is shared.
   */
  const stepOpen = (a: Vec3, ac: readonly [number, number], b: Vec3, bi: number, bj: number): boolean =>
    a.z === b.z ? sight.halfway(ac[0] + bi, ac[1] + bj, a.z) : passable(a, b, index, rules, keywords, walls, blocked);
  /** Nodes `a`, `b` and `c` stand on one storey, so a straight run between the first and last is level. */
  const level = (a: Vec3, b: Vec3, c: Vec3): boolean => zOf(a.z) === zOf(b.z) && zOf(b.z) === zOf(c.z);

  /**
   * The cheapest way into node `n` from the nodes around it that are already settled: a step from
   * one of them, or a straight run from the node that one was reached from. Every run is checked.
   */
  const refit = (n: number): { cost: number; from: number } => {
    const at = nodes[n]!.at;
    const [ci, cj] = cellOf[n]!;
    let best = { cost: Infinity, from: -1 };
    for (const [dx, dy] of NEIGHBOURS) {
      const cell = cells.peek(ci + dx, cj + dy);
      if (!cell) continue;
      for (const slot of cell.slots) {
        const k = slot.node;
        if (k < 0 || !settled.has(k)) continue;
        const by = nodes[k]!;
        if (stepOpen(by.at, cellOf[k]!, at, ci, cj)) {
          const cost = by.cost + stepCost(by.at, at, index, rules);
          if (cost < best.cost) best = { cost, from: k };
        }
        const g = by.from;
        if (g < 0 || !level(nodes[g]!.at, by.at, at)) continue;
        const cost = nodes[g]!.cost + Math.hypot(at.x - nodes[g]!.at.x, at.y - nodes[g]!.at.y);
        if (cost < best.cost && straight(g, n)) best = { cost, from: g };
      }
    }
    return best;
  };

  while (heap.size > 0) {
    const current = heap.pop()!;
    if (settled.has(current)) continue;
    const popped = nodes[current]!;
    if (unchecked.has(current)) {
      // The straight run this node was offered is checked only now it is the cheapest in hand. When
      // it is blocked, the node takes the best of the steps and runs that are clear, and waits its
      // turn again if that costs more.
      unchecked.delete(current);
      if (!straight(popped.from, current)) {
        const fit = refit(current);
        nodes[current] = { at: popped.at, cost: fit.cost, from: fit.from };
        if (fit.cost > popped.cost + EPS) {
          heap.push(current, fit.cost);
          continue;
        }
      }
    }
    settled.add(current);
    rank[current] = order++;
    const here = nodes[current]!;
    if (here.cost > budget + EPS) continue;

    // The starting position counts. If the model is already where it needs to be, the answer is
    // zero — excluding it turns "you are already there" into "you cannot get there".
    if (opts.until?.(here.at)) {
      stoppedAt = current;
      break;
    }

    const [hi, hj] = cellOf[current]!;
    const parent = here.from >= 0 ? nodes[here.from]! : undefined;
    for (const [dx, dy] of NEIGHBOURS) {
      const ci = hi + dx;
      const cj = hj + dy;
      const next = pointAt(ci, cj);
      if (dist2(next, origin) > budget + step) continue;
      // A cell is reached from up to eight neighbours, and neither its storeys nor whether the model
      // may stand on each depends on which. Both answers are kept in the cell's record.
      const cell = cells.record(ci, cj);
      cell.heights ??= surfaces.at(next);
      for (const z of cell.heights) {
        const to: Vec3 = { x: next.x, y: next.y, z };
        const slot = cells.slot(cell, zOf(z));
        const seen = slot.node;
        if (seen >= 0 && settled.has(seen)) continue;
        // A step from here, and a straight run from where this node was reached from. The run is
        // the whole of the model's move in the open, and a step on the lattice is what is left
        // when something is in the way. Neither is asked about when both together cannot improve
        // on what the node has.
        const byStep = here.cost + stepCost(here.at, to, index, rules);
        const run = parent && level(parent.at, here.at, to) ? parent.cost + Math.hypot(to.x - parent.at.x, to.y - parent.at.y) : Infinity;
        const least = Math.min(byStep, run);
        if (least > budget + EPS || (seen >= 0 && nodes[seen]!.cost <= least + EPS)) continue;
        slot.legal ??= legal(to);
        if (!slot.legal) continue;
        const stepped = stepOpen(here.at, cellOf[current]!, to, ci, cj) ? byStep : Infinity;
        let cost = stepped;
        let from = current;
        let check = false;
        if (run < stepped) {
          if (stepped <= budget + EPS) {
            // The step is there to fall back on, so the run is checked only if it is ever needed.
            cost = run;
            from = here.from;
            check = true;
          } else if (run <= budget + EPS && straightTo(here.from, [ci, cj])) {
            cost = run;
            from = here.from;
          }
        }
        if (cost > budget + EPS) continue;
        if (seen >= 0 && nodes[seen]!.cost <= cost + EPS) continue;
        const n = seen >= 0 ? seen : (slot.node = nodes.length);
        if (seen < 0) {
          extent = Math.max(extent, Math.abs(ci), Math.abs(cj));
          nodes.push({ at: to, cost, from });
          cellOf.push([ci, cj]);
        } else nodes[n] = { at: to, cost, from };
        if (check) unchecked.add(n);
        else unchecked.delete(n);
        heap.push(n, cost);
      }
    }
  }

  /**
   * Every node that could stand within `radius` of `at`, read from the cells that can hold one. A
   * node stands on its cell's lattice point to within rounding, which the slack covers.
   */
  const around = (at: Vec2, radius: number, visit: (i: number) => void): void => {
    const u = (at.x - origin.x) / step;
    const v = (at.y - origin.y) / step;
    const span = radius / step + 1e-6;
    for (let i = Math.ceil(u - span); i <= Math.floor(u + span); i++) {
      for (let j = Math.ceil(v - span); j <= Math.floor(v + span); j++) {
        const cell = cells.peek(i, j);
        if (!cell) continue;
        for (const slot of cell.slots) if (slot.node >= 0) visit(slot.node);
      }
    }
  };

  return {
    nodes,
    stoppedAt,
    find(at: Vec2, z?: number): number | undefined {
      let best: number | undefined;
      around(at, step * 0.75, (i) => {
        const n = nodes[i]!;
        if (dist2(n.at, at) > step * 0.75) return;
        if (z !== undefined && Math.abs(n.at.z - z) > rules.floorTolerance) return;
        if (best === undefined || n.cost < nodes[best]!.cost || (n.cost === nodes[best]!.cost && i < best)) best = i;
      });
      return best;
    },
    firstWithin(at: Vec2, radius: number): number | undefined {
      let best: number | undefined;
      around(at, radius, (i) => {
        const n = nodes[i]!;
        if (rank[i] === undefined || Math.hypot(n.at.x - at.x, n.at.y - at.y) > radius) return;
        if (best === undefined || rank[i]! < rank[best]!) best = i;
      });
      return best;
    },
    *byDistance(at: Vec2): Generator<number> {
      // Rings of cells around the one `at` falls in. Every node in ring k stands at least k - 0.5
      // cells from `at` across one axis, so once the nearest node held back is closer than that it
      // is nearer than anything still to come, and it goes out.
      const u = (at.x - origin.x) / step;
      const v = (at.y - origin.y) / step;
      const i0 = Math.round(u);
      const j0 = Math.round(v);
      const last = extent + Math.max(Math.abs(i0), Math.abs(j0));
      const held = new NearestFirst();
      const hold = (i: number, j: number): void => {
        const cell = cells.peek(i, j);
        if (!cell) return;
        for (const slot of cell.slots) {
          if (slot.node < 0) continue;
          const n = nodes[slot.node]!;
          held.push(Math.hypot(n.at.x - at.x, n.at.y - at.y), n.cost, slot.node);
        }
      };
      for (let k = 0; k <= last; k++) {
        const floor = (k - 0.5) * step - 1e-9;
        while (held.size > 0 && held.gap() < floor) yield held.pop();
        if (k === 0) hold(i0, j0);
        for (let d = -k; d <= k && k > 0; d++) {
          hold(i0 + d, j0 - k);
          hold(i0 + d, j0 + k);
          if (d > -k && d < k) {
            hold(i0 - k, j0 + d);
            hold(i0 + k, j0 + d);
          }
        }
      }
      while (held.size > 0) yield held.pop();
    },
    pathTo(target: number): Vec3[] {
      const out: Vec3[] = [];
      for (let i = target; i >= 0; i = nodes[i]!.from) out.push(nodes[i]!.at);
      return out.reverse();
    },
  };
}

/** Nodes held back by `byDistance`: a min-heap on distance, then cost, then node index. */
class NearestFirst {
  private readonly gaps: number[] = [];
  private readonly costs: number[] = [];
  private readonly ids: number[] = [];

  get size(): number {
    return this.ids.length;
  }

  gap(): number {
    return this.gaps[0]!;
  }

  private less(a: number, b: number): boolean {
    const { gaps, costs, ids } = this;
    if (gaps[a]! !== gaps[b]!) return gaps[a]! < gaps[b]!;
    if (costs[a]! !== costs[b]!) return costs[a]! < costs[b]!;
    return ids[a]! < ids[b]!;
  }

  private swap(a: number, b: number): void {
    const { gaps, costs, ids } = this;
    const g = gaps[a]!;
    gaps[a] = gaps[b]!;
    gaps[b] = g;
    const c = costs[a]!;
    costs[a] = costs[b]!;
    costs[b] = c;
    const i = ids[a]!;
    ids[a] = ids[b]!;
    ids[b] = i;
  }

  push(gap: number, cost: number, id: number): void {
    this.gaps.push(gap);
    this.costs.push(cost);
    this.ids.push(id);
    let i = this.ids.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!this.less(i, parent)) break;
      this.swap(i, parent);
      i = parent;
    }
  }

  pop(): number {
    const top = this.ids[0]!;
    const n = this.ids.length - 1;
    this.swap(0, n);
    this.gaps.pop();
    this.costs.pop();
    this.ids.pop();
    let i = 0;
    for (;;) {
      const l = 2 * i + 1;
      const r = l + 1;
      let small = i;
      if (l < n && this.less(l, small)) small = l;
      if (r < n && this.less(r, small)) small = r;
      if (small === i) break;
      this.swap(i, small);
      i = small;
    }
    return top;
  }
}

/**
 * Can this model stand with its base centred here, given the terrain?
 *
 * This asks what the search asks of every cell it settles. There has to be a surface at this height,
 * the model's keywords have to be allowed on it, and no solid may run through the base.
 */
export function canStand(model: ModelHull, at: Vec3, index: TerrainIndex, opts: ReachOptions = {}): boolean {
  const rules = { ...MOVE_RULES, ...opts.rules };
  const keywords = new Set((opts.keywords ?? []).map((k) => k.toUpperCase()));
  return new SurfaceMap(model, index, rules, keywords).standable(at) && !obstructed(at, model, opts);
}

/* ---- charging --------------------------------------------------------------------------------- */

/** The longest a 2D6 charge can ever roll, and so the furthest the search needs to look. */
export const MAX_CHARGE = 12;

/**
 * Slack on the charge's lower bound. It is far above the rounding in a sum of a few inches and far
 * below any distance a roll turns on, so the bound never passes over a target that could win.
 */
const BOUND_SLACK = 1e-9;

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
      const here: ModelHull = { ...model, pos: node.at };
      for (const target of targets) {
        // A straight dash closes the gap by no more than the distance it covers, so the charge from
        // here is at least this long. A target that cannot beat the answer in hand is not measured.
        const gap = horizontalGap(here, target);
        const floor = node.cost + gap - ENGAGEMENT_HORIZONTAL - BOUND_SLACK;
        if (floor >= best.distance || floor > MAX_CHARGE + EPS) continue;
        const dash = dashToEngage(model, here, target, gap);
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
 *
 * `here` is the model standing at the dash's start, and `gap` its horizontal gap to the target.
 */
function dashToEngage(model: ModelHull, here: ModelHull, target: ModelHull, gap: number): number | undefined {
  const at = here.pos;
  if (verticalGap(here, target) > ENGAGEMENT_VERTICAL) return undefined;
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
   *
   * A `scalable` piece's roof counts as one of those surfaces. A ruin's `floors` list the storeys
   * inside it and stop five inches below the top, so leaving the roof out gave the search a building
   * whose highest reachable level was a storey under the one the table draws.
   */
  at(p: Vec2): number[] {
    const out = [0];
    for (const piece of this.index.at(p)) {
      if (!this.climbable(piece)) continue;
      for (const z of floorHeights(piece)) if (z > EPS) out.push(z);
      if (hasTrait(piece, "scalable")) {
        const roof = topOf(piece);
        if (roof > EPS) out.push(roof);
      }
    }
    return out.length > 1 ? [...new Set(out)].sort((a, b) => a - b) : out;
  }

  /**
   * Is there a surface at this height to stand on?
   *
   * The surfaces are the ones the search itself walks on, so a height `canStand` allows is a height
   * `reachable` offers. A piece that only some keywords may climb keeps the rest off its floors.
   */
  supported(at: Vec3): boolean {
    // The table is under every point of the board, which settles a ground-level search here rather
    // than in an index query per cell.
    if (Math.abs(at.z) <= this.rules.floorTolerance) return true;
    return this.at({ x: at.x, y: at.y }).some((z) => Math.abs(z - at.z) <= this.rules.floorTolerance);
  }

  /** Can the model's base rest here, with something under it and no solid running through it? */
  standable(at: Vec3): boolean {
    if (!this.supported(at)) return false;
    // The enclosing circle is the broad phase. It over-reaches an oval base by `half`, which is
    // harmless here because everything it lets through is measured again inside `occupies`.
    const here: ModelHull = { ...this.model, pos: at };
    for (const piece of this.index.near({ x: at.x, y: at.y }, footReach(this.model.foot))) {
      if (this.permitted(piece)) continue;
      if (this.occupies(piece, here)) return false;
    }
    return true;
  }

  /** Does this piece's solid fill the space the model would stand in? */
  occupies(piece: TerrainPiece, here: ModelHull): boolean {
    const at = here.pos;
    // Terrain this low is stepped over, unless the piece is a wall. `impassable` and `breachable`
    // name who may cross them at any height, and the search enforces that on every step it takes.
    if (piece.height <= this.rules.stepOver && !hasTrait(piece, "impassable") && !hasTrait(piece, "breachable")) return false;
    if (at.z + here.height <= piece.base + EPS) return false; // the model is under it
    if (at.z >= topOf(piece) - EPS) return false; // the model is on top of it
    // The narrow phase: the base's own core segment against the piece's polygon, which is how the
    // zone and cover tests measure a base too. A base exactly tangent to the footprint is left
    // standing. This comes last because the flood fill runs it over every cell of the search, and
    // the three height checks above settle most pieces before it is reached.
    if (segPolygonDistance(coreSegment(here), piece.polygon) >= here.foot.r) return false;
    if (hasTrait(piece, "impassable")) return true;
    // Whoever may pass a ruin's walls was let through in `standable` before this was asked; anyone
    // still asking cannot be inside them, on any storey.
    if (hasTrait(piece, "breachable")) return true;
    // Inside a hollow piece the model must stand on one of its storeys rather than inside the walls.
    return !floorHeights(piece).some((z) => Math.abs(z - at.z) <= this.rules.floorTolerance);
  }

  permitted(piece: TerrainPiece): boolean {
    return piece.passableBy.some((k) => this.keywords.has(k.toUpperCase()));
  }

  climbable(piece: TerrainPiece): boolean {
    return climbs(piece, this.keywords);
  }
}

/** `mayClimb` for keywords already upper-cased, which the search holds and would otherwise copy per piece. */
const climbs = (piece: TerrainPiece, keywords: ReadonlySet<string>): boolean => piece.climbableBy.length === 0 || piece.climbableBy.some((k) => keywords.has(k.toUpperCase()));

/* ---- step costs and legality ------------------------------------------------------------------ */

const isDifficult = (p: TerrainPiece): boolean => hasTrait(p, "difficult");
/** Walls a model may cross only when its keywords are named: the thin-wall guard's pieces. */
const isWall = (p: TerrainPiece): boolean => hasTrait(p, "impassable") || hasTrait(p, "breachable");

function stepCost(from: Vec3, to: Vec3, index: TerrainIndex, rules: MoveRules): number {
  const flat = dist2(from, to);
  const rise = Math.abs(to.z - from.z);
  const climb = rise <= rules.stepOver ? 0 : rise * rules.climbCost;
  const slow = rules.difficultMultiplier !== 1 && index.at({ x: to.x, y: to.y }, isDifficult).length > 0;
  return flat * (slow ? rules.difficultMultiplier : 1) + climb;
}

/** Is the transition itself legal — a climb that has something to climb, and a gap it can cross? */
function passable(from: Vec3, to: Vec3, index: TerrainIndex, rules: MoveRules, keywords: ReadonlySet<string>, walls: Walls, blocked: Obstruction): boolean {
  const rise = Math.abs(to.z - from.z);
  if (rise > rules.stepOver) {
    // A climb needs a piece under one of the two points that can be climbed.
    const here = index.at({ x: to.x, y: to.y });
    const there = index.at({ x: from.x, y: from.y });
    const climbable = [...here, ...there].some((p) => climbs(p, keywords) && (hasTrait(p, "scalable") || p.floors.length > 1 || p.passableBy.some((k) => keywords.has(k.toUpperCase()))));
    if (!climbable) return false;
  }
  // Guard against slipping diagonally through a thin wall between two legal cells.
  const mid: Vec3 = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2, z: Math.max(from.z, to.z) };
  return walls.clear(mid) && !blocked.at(mid);
}

/** The walls near one search that the model may not cross, each with its bounding box. */
class Walls {
  private readonly boxes: Aabb2[];

  constructor(
    private readonly pieces: readonly TerrainPiece[],
    private readonly height: number,
  ) {
    this.boxes = pieces.map((p) => bounds(p.polygon));
  }

  /** Is no wall standing at this point, at a height that would stop the model there? */
  clear(mid: Vec3): boolean {
    for (let i = 0; i < this.pieces.length; i++) {
      if (!inBox(mid, this.boxes[i]!)) continue;
      const piece = this.pieces[i]!;
      if (!containsPoint(piece, mid)) continue;
      if (mid.z < topOf(piece) - EPS && mid.z + this.height > piece.base + EPS) return false;
    }
    return true;
  }
}

/** Enemy engagement and other models' bases, both of which a move must respect. */
function obstructed(at: Vec3, model: ModelHull, opts: ReachOptions): boolean {
  const here: ModelHull = { ...model, pos: at };
  if (!opts.allowEngagement) {
    for (const enemy of opts.enemies ?? []) if (inEngagementRange(here, enemy)) return true;
  }
  for (const other of opts.blockers ?? []) if (stoodOn(here, other, model)) return true;
  return false;
}

/** Would a model standing as `here` stand on `other`'s base? The mover's own hull never counts. */
const stoodOn = (here: ModelHull, other: ModelHull, model: ModelHull): boolean => other !== model && horizontalGap(here, other) <= EPS && Math.abs(other.pos.z - here.pos.z) < model.height;

/**
 * `obstructed` for one search, with the models filed by position.
 *
 * It asks the same two questions of the same models, but only of those whose centres are close
 * enough for the answer to be yes. A base's gap to another is at least the distance between their
 * centres less both reaches, so a model further off than that plus the range asked about is passed
 * over unmeasured.
 */
class Obstruction {
  private readonly enemies?: HullGrid;
  private readonly blockers: HullGrid;
  private readonly reach: number;

  constructor(
    private readonly model: ModelHull,
    opts: ReachOptions,
  ) {
    this.reach = footReach(model.foot);
    this.enemies = opts.allowEngagement ? undefined : new HullGrid(opts.enemies ?? []);
    this.blockers = new HullGrid(opts.blockers ?? []);
  }

  at(at: Vec3): boolean {
    const here: ModelHull = { ...this.model, pos: at };
    if (this.enemies?.some(at, this.reach + ENGAGEMENT_HORIZONTAL, (enemy) => inEngagementRange(here, enemy))) return true;
    return this.blockers.some(at, this.reach, (other) => stoodOn(here, other, this.model));
  }
}

/** Slack on the centre-distance filter, far above rounding and far below anything on a table. */
const FIELD_SLACK = 1e-6;

/**
 * Models filed in a uniform grid by where their centres stand, with the centres and reaches copied
 * out so that passing over a model far from the question costs no more than reading two numbers.
 * A query names a point and a range, and reads only the models whose bases could come within that
 * range of the point.
 */
export class HullGrid {
  private readonly cell = 1;
  private readonly gx: number;
  private readonly gy: number;
  private readonly cols: number;
  private readonly rows: number;
  private readonly grid: number[][];
  private readonly xs: Float64Array;
  private readonly ys: Float64Array;
  private readonly reaches: Float64Array;
  private readonly widest: number;

  constructor(private readonly hulls: readonly ModelHull[]) {
    const n = hulls.length;
    this.xs = new Float64Array(n);
    this.ys = new Float64Array(n);
    this.reaches = new Float64Array(n);
    let widest = 0;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < n; i++) {
      const h = hulls[i]!;
      const { x, y } = h.pos;
      this.xs[i] = x;
      this.ys[i] = y;
      this.reaches[i] = footReach(h.foot);
      widest = Math.max(widest, this.reaches[i]!);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
    this.widest = widest;
    if (!n || !Number.isFinite(minX + minY + maxX + maxY)) {
      // Nothing to file, or a position the grid cannot hold: one cell holds everything.
      this.gx = this.gy = 0;
      this.cols = this.rows = 1;
      this.grid = [hulls.map((_, i) => i)];
      return;
    }
    this.gx = minX;
    this.gy = minY;
    this.cols = Math.min(4096, Math.floor((maxX - minX) / this.cell) + 1);
    this.rows = Math.min(4096, Math.floor((maxY - minY) / this.cell) + 1);
    this.grid = Array.from({ length: this.cols * this.rows }, () => []);
    for (let i = 0; i < n; i++) this.grid[this.row(this.ys[i]!) * this.cols + this.col(this.xs[i]!)]!.push(i);
  }

  private col(x: number): number {
    return Math.min(this.cols - 1, Math.max(0, Math.floor((x - this.gx) / this.cell)));
  }

  private row(y: number): number {
    return Math.min(this.rows - 1, Math.max(0, Math.floor((y - this.gy) / this.cell)));
  }

  /** Does `test` hold for any model whose base could come within `range` of the point `at`? */
  some(at: Vec2, range: number, test: (h: ModelHull) => boolean): boolean {
    return this.visit(at, range, (i) => test(this.hulls[i]!));
  }

  /** Every model whose base could come within `range` of the point `at`, in the order given. */
  near(at: Vec2, range: number): ModelHull[] {
    const found: number[] = [];
    this.visit(at, range, (i) => {
      found.push(i);
      return false;
    });
    return found.sort((a, b) => a - b).map((i) => this.hulls[i]!);
  }

  /** Hand `visit` each model close enough, by index, until it returns true. */
  private visit(at: Vec2, range: number, visit: (i: number) => boolean): boolean {
    if (!this.hulls.length) return false;
    const reach = range + this.widest + FIELD_SLACK;
    const c0 = this.col(at.x - reach);
    const c1 = this.col(at.x + reach);
    const r0 = this.row(at.y - reach);
    const r1 = this.row(at.y + reach);
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        for (const i of this.grid[r * this.cols + c]!) {
          if (Math.hypot(this.xs[i]! - at.x, this.ys[i]! - at.y) > range + this.reaches[i]! + FIELD_SLACK) continue;
          if (visit(i)) return true;
        }
      }
    }
    return false;
  }
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

/** One storey of a cell: the node standing there, if any, and whether the model may stand there. */
interface Slot {
  readonly z: number;
  node: number;
  legal?: boolean;
}

/** One cell of the lattice: the storeys over it and a slot for each storey a step has asked about. */
interface Cell {
  heights?: number[];
  readonly slots: Slot[];
  /** Whether the cell is difficult ground, asked only when an edition charges for it. */
  slow?: boolean;
}

/**
 * The search's cells, by their offset in steps from where the model started.
 *
 * A dense table while the budget keeps it small, which is every real move, and a map past that.
 */
class Lattice {
  /** How many cells the table reaches from the start along either axis. */
  readonly half: number;
  private readonly width: number;
  private readonly dense?: (Cell | undefined)[];
  private readonly sparse?: Map<number, Cell>;

  constructor(step: number, budget: number) {
    const half = Math.ceil((budget + step) / step) + 2;
    if (Number.isFinite(half) && half <= 1 << 19) {
      this.half = half;
      this.width = 2 * half + 1;
    } else {
      this.half = 1 << 19;
      this.width = 1 << 20;
    }
    if (this.width * this.width <= 1 << 21) this.dense = new Array<Cell | undefined>(this.width * this.width);
    else this.sparse = new Map();
  }

  private key(i: number, j: number): number {
    return (i + this.half) * this.width + (j + this.half);
  }

  private inside(i: number, j: number): boolean {
    return i >= -this.half && i <= this.half && j >= -this.half && j <= this.half;
  }

  /** The cell at offset `(i, j)`, made when it is first asked for. */
  record(i: number, j: number): Cell {
    const k = this.key(i, j);
    let cell = this.dense ? this.dense[k] : this.sparse!.get(k);
    if (!cell) {
      cell = { slots: [] };
      if (this.dense) this.dense[k] = cell;
      else this.sparse!.set(k, cell);
    }
    return cell;
  }

  /** The cell at offset `(i, j)`, if the search ever reached it. */
  peek(i: number, j: number): Cell | undefined {
    if (!this.inside(i, j)) return undefined;
    const k = this.key(i, j);
    return this.dense ? this.dense[k] : this.sparse!.get(k);
  }

  /** The cell's slot for storey key `z`, made when it is first asked for. */
  slot(cell: Cell, z: number): Slot {
    for (const s of cell.slots) if (s.z === z) return s;
    const made: Slot = { z, node: -1 };
    cell.slots.push(made);
    return made;
  }
}

/**
 * Whether the model can run straight and level between two lattice points, asked of the same
 * questions the lattice steps ask, as densely.
 *
 * A step checks the cell it lands on and the point halfway along it. A straight run checks every
 * cell whose square it passes through, which the model must be able to stand on at the run's
 * storey, and every point on the half-step grid whose square it passes through, where no wall the
 * model may not cross stands and no other model is in the way. So every point of the run is as
 * close to a checked position as every point of a lattice path is. The answers are kept by cell
 * and by storey, so runs that cross the same ground ask about it once.
 */
class StraightRuns {
  /** Answers for points on the half-step grid, by height and then by point: 0 not asked, 1 clear, 2 not. */
  private readonly halves = new Map<number, Int8Array | Map<number, number>>();
  /** Whether each cell is quiet, by height and then by cell: 0 not asked, 1 quiet, 2 not. */
  private readonly calm = new Map<number, Int8Array | Map<number, number>>();

  constructor(
    private readonly cells: Lattice,
    private readonly pointAt: (i: number, j: number) => Vec2,
    private readonly index: TerrainIndex,
    private readonly rules: MoveRules,
    private readonly surfaces: SurfaceMap,
    private readonly legal: (at: Vec3) => boolean,
    private readonly open: (mid: Vec3) => boolean,
    private readonly zOf: (z: number) => number,
  ) {}

  /** Is the run from cell `a` to cell `b`, on the storey at height `z` with key `zk`, clear? */
  clear(a: readonly [number, number], b: readonly [number, number], z: number, zk: number): boolean {
    const [ai, aj] = a;
    const [bi, bj] = b;
    // Every half-step point whose square the run touches lies around some cell the run touches, so
    // a run over quiet cells alone is clear without asking about the points one by one.
    if (cover(ai, aj, bi, bj, (i, j) => this.quiet(i, j, z, zk))) return true;
    // The start is a node, so the ground under it has been answered for already.
    if (!cover(ai, aj, bi, bj, (i, j) => (i === ai && j === aj) || this.cellClear(i, j, zk))) return false;
    return cover(2 * ai, 2 * aj, 2 * bi, 2 * bj, (i, j) => ((i & 1) === 0 && (j & 1) === 0) || this.halfway(i, j, z));
  }

  /**
   * Is the cell one the model can stand on, with the nine half-step points in and around its
   * square all clear? Open ground is quiet, and a run across it needs nothing more.
   */
  private quiet(i: number, j: number, z: number, zk: number): boolean {
    let known = this.calm.get(z);
    const width = this.cells.half * 2 + 1;
    if (!known) this.calm.set(z, (known = width * width <= 1 << 22 ? new Int8Array(width * width) : new Map<number, number>()));
    const key = (i + this.cells.half) * width + (j + this.cells.half);
    let calm = known instanceof Int8Array ? known[key]! : (known.get(key) ?? 0);
    if (calm === 0) {
      calm = 1;
      if (!this.cellClear(i, j, zk)) calm = 2;
      for (let di = -1; di <= 1 && calm === 1; di++) for (let dj = -1; dj <= 1 && calm === 1; dj++) if (!this.halfway(2 * i + di, 2 * j + dj, z)) calm = 2;
      if (known instanceof Int8Array) known[key] = calm;
      else known.set(key, calm);
    }
    return calm === 1;
  }

  /** Can the model stand on this cell's storey `zk`, and is the cell free of ground that costs extra? */
  private cellClear(i: number, j: number, zk: number): boolean {
    const cell = this.cells.record(i, j);
    const at = this.pointAt(i, j);
    cell.heights ??= this.surfaces.at(at);
    const height = cell.heights.find((h) => this.zOf(h) === zk);
    if (height === undefined) return false;
    const slot = this.cells.slot(cell, zk);
    slot.legal ??= this.legal({ x: at.x, y: at.y, z: height });
    if (!slot.legal) return false;
    if (this.rules.difficultMultiplier !== 1) {
      cell.slow ??= this.index.at(at, isDifficult).length > 0;
      if (cell.slow) return false;
    }
    return true;
  }

  /**
   * Is the point `(i, j)` half steps from the start clear of walls and models at height `z`? A level
   * step between two cells asks this of the point halfway along it, which is the same question.
   */
  halfway(i: number, j: number, z: number): boolean {
    let known = this.halves.get(z);
    if (!known) this.halves.set(z, (known = this.width * this.width <= 1 << 22 ? new Int8Array(this.width * this.width) : new Map<number, number>()));
    const span = this.cells.half * 2;
    const key = (i + span) * this.width + (j + span);
    let clear = known instanceof Int8Array ? known[key]! : (known.get(key) ?? 0);
    if (clear === 0) {
      const at = this.pointAt(i / 2, j / 2);
      clear = this.open({ x: at.x, y: at.y, z }) ? 1 : 2;
      if (known instanceof Int8Array) known[key] = clear;
      else known.set(key, clear);
    }
    return clear === 1;
  }

  /** Points across the half-step grid, which reaches twice as many points as the lattice either way. */
  private get width(): number {
    return this.cells.half * 4 + 1;
  }
}

/**
 * Hand `visit` every integer point whose unit square the segment between two integer points
 * touches, column by column, until it answers false. A square the segment only grazes at a corner
 * or along a side counts as touched.
 */
function cover(u0: number, v0: number, u1: number, v1: number, visit: (i: number, j: number) => boolean): boolean {
  const slack = 1e-9;
  if (u0 === u1) {
    for (let j = Math.min(v0, v1); j <= Math.max(v0, v1); j++) if (!visit(u0, j)) return false;
    return true;
  }
  const du = u1 - u0;
  const dv = v1 - v0;
  const lo = Math.min(u0, u1);
  const hi = Math.max(u0, u1);
  for (let i = lo; i <= hi; i++) {
    const ua = Math.max(lo, i - 0.5);
    const ub = Math.min(hi, i + 0.5);
    const va = v0 + (dv * (ua - u0)) / du;
    const vb = v0 + (dv * (ub - u0)) / du;
    for (let j = Math.ceil(Math.min(va, vb) - 0.5 - slack); j <= Math.floor(Math.max(va, vb) + 0.5 + slack); j++) if (!visit(i, j)) return false;
  }
  return true;
}

/** A growable set of small non-negative integers. */
class Flags {
  private bits = new Uint8Array(256);

  has(i: number): boolean {
    return i < this.bits.length && this.bits[i] === 1;
  }

  add(i: number): void {
    if (i >= this.bits.length) {
      const grown = new Uint8Array(Math.max(i + 1, this.bits.length * 2));
      grown.set(this.bits);
      this.bits = grown;
    }
    this.bits[i] = 1;
  }

  delete(i: number): void {
    if (i < this.bits.length) this.bits[i] = 0;
  }
}

/** A binary min-heap keyed by cost. Small, and the search settles thousands of nodes. */
class MinHeap {
  private readonly ids: number[] = [];
  private readonly costs: number[] = [];

  get size(): number {
    return this.ids.length;
  }

  push(id: number, cost: number): void {
    const { ids, costs } = this;
    ids.push(id);
    costs.push(cost);
    let i = ids.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (costs[parent]! <= costs[i]!) break;
      this.swap(parent, i);
      i = parent;
    }
  }

  pop(): number | undefined {
    const { ids, costs } = this;
    if (!ids.length) return undefined;
    const top = ids[0]!;
    const lastId = ids.pop()!;
    const lastCost = costs.pop()!;
    if (ids.length > 0) {
      ids[0] = lastId;
      costs[0] = lastCost;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let small = i;
        if (l < ids.length && costs[l]! < costs[small]!) small = l;
        if (r < ids.length && costs[r]! < costs[small]!) small = r;
        if (small === i) break;
        this.swap(small, i);
        i = small;
      }
    }
    return top;
  }

  private swap(a: number, b: number): void {
    const { ids, costs } = this;
    const id = ids[a]!;
    ids[a] = ids[b]!;
    ids[b] = id;
    const cost = costs[a]!;
    costs[a] = costs[b]!;
    costs[b] = cost;
  }
}
