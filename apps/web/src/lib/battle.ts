/**
 * The Battle page's state, kept as plain data and pure functions so the rules of the thing can be
 * tested without a browser, a canvas or a GPU.
 *
 * This is **planning mode**: legality is advisory and nothing is resolved. Phases, dice and casualty
 * allocation arrive with `packages/game`.
 *
 * Movement is per model, because in this game it is. A unit is not a token: it is a handful of
 * models each with its own Move allowance, which spread to screen, string out to reach an objective
 * and hug the edge of coherency to keep a charge off. Moving them as one block cannot express any of
 * that. Each model here carries where it started and what it has spent, so a model can be nudged,
 * nudged again, and still only ever travel its own Move in total — and coherency is reported rather
 * than enforced, because the rules only ask for it once the whole unit has finished moving.
 */

import type { CoherencyReport, ModelHull, ReachNode, TerrainLayout, Vec2, Vec3, Zone } from "@grimstat/board";
import { LAYOUTS, MOVE_RULES, TerrainIndex, canStand, chargeGeometry, circleBase, coherency, coverFor, edgeZones, heightForKeywords, inEngagementRange, inZone, onBoard, pointInPolygon, reachable, sight, unitDistance } from "@grimstat/board";

export type Side = "attacker" | "defender";
export type BattleTool = "deploy" | "select" | "measure" | "sight" | "terrain";

export interface BattleModel {
  readonly id: string;
  readonly hull: ModelHull;
  /**
   * Where this model stood when the current move began, and how far it has travelled since.
   *
   * Cumulative, not as-the-crow-flies: a model nudged out and back has spent the whole trip, which
   * is what stops a series of small drags adding up to more than the model's Move.
   */
  readonly from?: Vec3;
  readonly spent?: number;
  /** Move characteristic, when this model differs from the rest of its unit. */
  readonly move?: number;
  /**
   * The route of this model's latest move, start first — the path the movement search actually
   * found, so the table can animate the model round the corner it went round rather than through
   * the wall it did not.
   */
  readonly route?: readonly Vec3[];
}

export interface BattleUnit {
  readonly id: string;
  readonly side: Side;
  readonly name: string;
  /** Move characteristic, in inches. */
  readonly move: number;
  /** Objective Control per model. */
  readonly oc: number;
  readonly keywords: readonly string[];
  readonly models: readonly BattleModel[];
  /** Not on the table yet: waiting in reserve to be deployed. Its models' positions mean nothing. */
  readonly reserve?: boolean;
}

export interface BattleState {
  readonly layout: TerrainLayout;
  readonly zones: readonly [Zone, Zone];
  readonly units: readonly BattleUnit[];
}

/* ---- queries ----------------------------------------------------------------------------------- */

export const unitHulls = (unit: BattleUnit): ModelHull[] => unit.models.map((m) => m.hull);
export const unitsOf = (state: BattleState, side: Side): BattleUnit[] => state.units.filter((u) => u.side === side);
/** The units actually standing on the table: only they block, threaten or can be moved. */
export const deployedUnits = (state: BattleState): BattleUnit[] => state.units.filter((u) => !u.reserve);
export const enemyHulls = (state: BattleState, side: Side): ModelHull[] => deployedUnits(state).filter((u) => u.side !== side).flatMap(unitHulls);
export const otherHulls = (state: BattleState, unitId: string): ModelHull[] => deployedUnits(state).filter((u) => u.id !== unitId).flatMap(unitHulls);
export const findUnit = (state: BattleState, id: string | undefined): BattleUnit | undefined => state.units.find((u) => u.id === id);

/** The model a whole-unit move is measured from: the first. */
export const anchorOf = (unit: BattleUnit): ModelHull => unit.models[0]?.hull ?? { pos: { x: 0, y: 0, z: 0 }, facing: 0, foot: circleBase(32), height: 2 };

export const findModel = (unit: BattleUnit, id: string | undefined): BattleModel | undefined => unit.models.find((m) => m.id === id);

/** What this model may move, which is its unit's characteristic unless it says otherwise. */
export const moveOf = (unit: BattleUnit, model: BattleModel): number => model.move ?? unit.move;

/** What this model has left of its move. */
export const remainingMove = (unit: BattleUnit, model: BattleModel): number => Math.max(0, moveOf(unit, model) - (model.spent ?? 0));

/** Has any model of this unit moved since the move began? */
export const hasMoved = (unit: BattleUnit): boolean => unit.models.some((m) => (m.spent ?? 0) > 0);

/** Coherency of the unit as it currently stands. Reported, never enforced mid-move. */
export const unitCoherency = (unit: BattleUnit): CoherencyReport => coherency(unitHulls(unit));

/** Ids of the models that are out of coherency, for the table to ring in red. */
export function incoherentModels(unit: BattleUnit): string[] {
  const report = unitCoherency(unit);
  if (report.ok) return [];
  const lonely = new Set(report.lonely);
  // A split unit has no single model at fault, so the whole of the smaller group is the problem.
  return unit.models.filter((_, i) => lonely.has(i) || report.split).map((m) => m.id);
}

/** Put every model back where this move started and give back what it spent. */
export function resetMove(unit: BattleUnit): BattleUnit {
  return { ...unit, models: unit.models.map((m) => (m.from ? { ...m, hull: { ...m.hull, pos: m.from }, route: [m.hull.pos, m.from], from: undefined, spent: 0 } : m)) };
}

/** Lock the move in: this is where the models started from now. */
export function endMove(unit: BattleUnit): BattleUnit {
  return { ...unit, models: unit.models.map((m) => ({ ...m, from: undefined, spent: 0 })) };
}

export const indexOf = (state: BattleState): TerrainIndex => new TerrainIndex(state.layout.pieces);

/* ---- placement --------------------------------------------------------------------------------- */

/**
 * Offsets for a block of `count` models around a centre, at `spacing` between base centres.
 *
 * Rows of about √n, which is how a unit actually gets put on a table, and close enough that the
 * result is coherent without having to search for a legal arrangement.
 */
export function formation(count: number, spacing: number): Vec2[] {
  const perRow = Math.max(1, Math.ceil(Math.sqrt(count)));
  const rows = Math.ceil(count / perRow);
  const out: Vec2[] = [];
  for (let i = 0; i < count; i++) {
    const row = Math.floor(i / perRow);
    const col = i % perRow;
    const wide = Math.min(perRow, count - row * perRow);
    out.push({ x: (col - (wide - 1) / 2) * spacing, y: (row - (rows - 1) / 2) * spacing });
  }
  return out;
}

/** Put a unit's models in a block centred on `at`, keeping each model's height and base. */
export function placeUnit(unit: BattleUnit, at: Vec2, z = 0): BattleUnit {
  const spacing = Math.max(1.2, unit.models[0] ? unit.models[0].hull.foot.r * 2 + 0.6 : 1.6);
  const offsets = formation(unit.models.length, spacing);
  return {
    ...unit,
    models: unit.models.map((m, i) => {
      const o = offsets[i] ?? { x: 0, y: 0 };
      return { ...m, hull: { ...m.hull, pos: { x: at.x + o.x, y: at.y + o.y, z } } };
    }),
  };
}

/** Move every model of a unit by the same offset — a rigid drag. */
export function translateUnit(unit: BattleUnit, by: Vec2, z?: number): BattleUnit {
  return {
    ...unit,
    models: unit.models.map((m) => ({ ...m, hull: { ...m.hull, pos: { x: m.hull.pos.x + by.x, y: m.hull.pos.y + by.y, z: z ?? m.hull.pos.z } } })),
  };
}

export const replaceUnit = (state: BattleState, unit: BattleUnit): BattleState => ({ ...state, units: state.units.map((u) => (u.id === unit.id ? unit : u)) });

/* ---- legality ---------------------------------------------------------------------------------- */

export interface MoveVerdict {
  readonly ok: boolean;
  /**
   * Where it would actually end up — the nearest position the movement search can reach, which is
   * not quite where the pointer was. Move it here, not to the raw click, or the distance travelled
   * stops matching the distance it was charged for.
   */
  readonly at?: Vec3;
  /** Inches travelled by this move alone. */
  readonly cost?: number;
  /** The route the search found, start first, when it found one. */
  readonly path?: readonly Vec3[];
  /** Why not, in the order a player would notice them. */
  readonly problems: readonly string[];
}

/**
 * How far a destination may be from the nearest cell of the movement search and still count as that
 * cell: half a cell's diagonal, which is the furthest any point can be from all of them.
 *
 * Getting this wrong is not a rounding detail. A tighter figure leaves gaps between the cells where
 * a perfectly ordinary move is reported as out of range.
 */
const SNAP = (MOVE_RULES.resolution * Math.SQRT2) / 2 + 1e-6;

/** Everything a move has to get past, whichever models are making it. */
function obstacles(state: BattleState, unit: BattleUnit): { enemies: ModelHull[]; blockers: ModelHull[] } {
  return { enemies: enemyHulls(state, unit.side), blockers: otherHulls(state, unit.id) };
}

/** Where one model of a unit can go with what it has left. */
export function modelReach(state: BattleState, unit: BattleUnit, model: BattleModel, index = indexOf(state)): readonly ReachNode[] {
  const { enemies, blockers } = obstacles(state, unit);
  return reachable(model.hull, remainingMove(unit, model), index, { keywords: unit.keywords, enemies, blockers: [...blockers, ...unitHulls(unit).filter((h) => h !== model.hull)], board: state.layout.size }).nodes;
}

/**
 * Can this one model go here, and what does it cost?
 *
 * Coherency is deliberately **not** a problem. The rules ask for it once the unit has finished
 * moving, and a unit that moves one model at a time is out of coherency for most of that — refusing
 * the first model's move would make moving models individually impossible, which is the whole point.
 * The panel reports coherency for the unit instead.
 */
export function modelMoveVerdict(state: BattleState, unit: BattleUnit, model: BattleModel, to: Vec2, index = indexOf(state)): MoveVerdict {
  const { enemies, blockers } = obstacles(state, unit);
  const others = unitHulls(unit).filter((h) => h !== model.hull);
  const problems: string[] = [];

  const reach = reachable(model.hull, remainingMove(unit, model), index, {
    keywords: unit.keywords,
    enemies,
    blockers: [...blockers, ...others],
    board: state.layout.size,
    until: (at) => Math.hypot(at.x - to.x, at.y - to.y) <= SNAP,
  });
  const landed = reach.stoppedAt === undefined ? undefined : reach.nodes[reach.stoppedAt];
  if (!landed) problems.push("battle.problem.tooFar");

  const at: Vec3 = landed ? landed.at : { x: to.x, y: to.y, z: model.hull.pos.z };
  const moved: ModelHull = { ...model.hull, pos: at };
  if (!onBoard(moved, state.layout.size)) problems.push("battle.problem.offTable");
  if (!canStand(moved, at, index, { keywords: unit.keywords, blockers: [...blockers, ...others] })) problems.push("battle.problem.blocked");
  if (enemies.some((e) => inEngagementRange(moved, e))) problems.push("battle.problem.engagement");

  return { ok: problems.length === 0, at: landed ? at : undefined, cost: landed?.cost, path: landed ? reach.pathTo(reach.stoppedAt!) : undefined, problems };
}

/** Apply a model's move, remembering where it started, what it spent, and the way it went. */
export function applyModelMove(unit: BattleUnit, modelId: string, to: Vec3, cost: number, path?: readonly Vec3[]): BattleUnit {
  return {
    ...unit,
    models: unit.models.map((m) => (m.id === modelId ? { ...m, hull: { ...m.hull, pos: to }, route: path ?? [m.hull.pos, to], from: m.from ?? m.hull.pos, spent: (m.spent ?? 0) + cost } : m)),
  };
}

/**
 * Can the whole unit move here as a body?
 *
 * A convenience for putting a unit down, not a substitute for moving models: it keeps the formation
 * and charges every model the lead model's route. Fine for deployment and for a unit crossing open
 * ground; useless for screening, which is what the per-model move is for.
 */
export function dragVerdict(state: BattleState, unit: BattleUnit, to: Vec2, index = indexOf(state)): MoveVerdict {
  const anchor = anchorOf(unit);
  const lead = unit.models[0];
  const { enemies, blockers } = obstacles(state, unit);
  const problems: string[] = [];

  const budget = lead ? remainingMove(unit, lead) : unit.move;
  const reach = reachable(anchor, budget, index, {
    keywords: unit.keywords,
    enemies,
    blockers,
    board: state.layout.size,
    until: (at) => Math.hypot(at.x - to.x, at.y - to.y) <= SNAP,
  });
  const landed = reach.stoppedAt === undefined ? undefined : reach.nodes[reach.stoppedAt];
  const at: Vec2 = landed ? { x: landed.at.x, y: landed.at.y } : to;
  if (!landed) problems.push("battle.problem.tooFar");

  const moved = translateUnit(unit, { x: at.x - anchor.pos.x, y: at.y - anchor.pos.y }, landed?.at.z);
  if (moved.models.some((m) => !onBoard(m.hull, state.layout.size))) problems.push("battle.problem.offTable");
  if (moved.models.some((m) => !canStand(m.hull, m.hull.pos, index, { keywords: unit.keywords, blockers }))) problems.push("battle.problem.blocked");
  if (moved.models.some((m) => enemies.some((e) => inEngagementRange(m.hull, e)))) problems.push("battle.problem.engagement");

  return { ok: problems.length === 0, at: landed ? landed.at : undefined, cost: landed?.cost, path: landed ? reach.pathTo(reach.stoppedAt!) : undefined, problems };
}

/**
 * Apply a whole-unit move: every model travels the same offset and is charged the same distance,
 * and each takes the lead model's route shifted to where it stands in the formation.
 */
export function applyUnitMove(unit: BattleUnit, to: Vec3, cost: number, path?: readonly Vec3[]): BattleUnit {
  const anchor = anchorOf(unit);
  const by = { x: to.x - anchor.pos.x, y: to.y - anchor.pos.y };
  return {
    ...unit,
    models: unit.models.map((m) => {
      const pos = { x: m.hull.pos.x + by.x, y: m.hull.pos.y + by.y, z: to.z };
      const offset = { x: m.hull.pos.x - anchor.pos.x, y: m.hull.pos.y - anchor.pos.y };
      const route = path ? path.map((p) => ({ x: p.x + offset.x, y: p.y + offset.y, z: p.z })) : [m.hull.pos, pos];
      return { ...m, hull: { ...m.hull, pos }, route, from: m.from ?? m.hull.pos, spent: (m.spent ?? 0) + cost };
    }),
  };
}

/* ---- deployment -------------------------------------------------------------------------------- */

/** The zone a side deploys into. */
export const zoneOf = (state: BattleState, side: Side): Zone => state.zones.find((z) => z.owner === side) ?? state.zones[side === "attacker" ? 0 : 1];

/**
 * May this unit be set down here, as a block centred on `at`?
 *
 * Deployment asks more of a position than a move does — every base wholly within the side's zone —
 * and less: nothing is spent, so there is no route to search. Only the ground has to take them.
 */
export function deployVerdict(state: BattleState, unit: BattleUnit, at: Vec2, index = indexOf(state)): MoveVerdict {
  const placed = placeUnit(unit, at);
  const zone = zoneOf(state, unit.side);
  const { enemies, blockers } = obstacles(state, unit);
  const problems: string[] = [];
  if (placed.models.some((m) => !onBoard(m.hull, state.layout.size))) problems.push("battle.problem.offTable");
  else if (placed.models.some((m) => !inZone(m.hull, zone))) problems.push("battle.problem.outsideZone");
  if (placed.models.some((m) => !canStand(m.hull, m.hull.pos, index, { keywords: unit.keywords, blockers }))) problems.push("battle.problem.blocked");
  if (placed.models.some((m) => enemies.some((e) => inEngagementRange(m.hull, e)))) problems.push("battle.problem.engagement");
  return { ok: problems.length === 0, at: { x: at.x, y: at.y, z: 0 }, cost: 0, problems };
}

/** Set a unit down as a block centred on `at`, fresh: nothing moved, nothing spent. */
export function deployUnit(unit: BattleUnit, at: Vec2): BattleUnit {
  const placed = placeUnit(unit, at);
  return { ...placed, reserve: false, models: placed.models.map((m) => ({ ...m, from: undefined, spent: 0, route: undefined })) };
}

/** Take a unit off the table and back into reserve. */
export const withdrawUnit = (unit: BattleUnit): BattleUnit => ({ ...unit, reserve: true });

export const clearDeployment = (state: BattleState): BattleState => ({ ...state, units: state.units.map(withdrawUnit) });

/**
 * Put every reserve unit of a side somewhere legal in its zone.
 *
 * Back edge first and centre outwards, one inch at a time, first legal spot wins: the way a player
 * fills a zone when the terrain, not the plan, is deciding. Units that fit nowhere stay in reserve.
 */
export function autoDeploy(state: BattleState, side: Side, index = indexOf(state)): BattleState {
  let next = state;
  const zone = zoneOf(state, side);
  const xs = zone.polygon.map((p) => p.x);
  const ys = zone.polygon.map((p) => p.y);
  const box = { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
  const { width, depth } = state.layout.size;
  // The zone's far edge from the table's centre is the back edge: the row deployment starts on.
  const backFirst = (box.minY + box.maxY) / 2 < depth / 2;
  const rows: number[] = [];
  for (let y = Math.floor(box.minY) + 1; y <= box.maxY - 1; y++) rows.push(y);
  if (!backFirst) rows.reverse();
  const cols: number[] = [];
  for (let d = 0; d <= width / 2; d++) {
    for (const x of [width / 2 - d, width / 2 + d]) if (x >= box.minX && x <= box.maxX && !cols.includes(x)) cols.push(x);
  }

  for (const unit of state.units) {
    if (unit.side !== side || !unit.reserve) continue;
    let placed: BattleUnit | undefined;
    search: for (const y of rows) {
      for (const x of cols) {
        if (!pointInPolygon({ x, y }, zone.polygon)) continue;
        const verdict = deployVerdict(next, unit, { x, y }, index);
        if (verdict.ok) {
          placed = deployUnit(unit, { x, y });
          break search;
        }
      }
    }
    if (placed) next = replaceUnit(next, placed);
  }
  return next;
}

/* ---- the tools --------------------------------------------------------------------------------- */

export interface SightReadout {
  readonly visible: boolean;
  readonly exposure: number;
  readonly blockers: readonly string[];
  readonly cover: "none" | "light" | "heavy";
  readonly distance: number;
  /** Every ray the kernel tested, so the table can draw why. */
  readonly rays: readonly { from: Vec3; to: Vec3; blockedBy?: string }[];
}

/**
 * What one unit can see of another, and at what cost in cover — the readout behind the sight tool.
 *
 * Exhaustive on purpose: stopping at the first clear ray answers the boolean faster but tells the
 * player nothing about how exposed the target is, and the picture is the point.
 */
export function sightBetween(from: BattleUnit, to: BattleUnit, index: TerrainIndex): SightReadout {
  const eye = anchorOf(from);
  let best = sight(eye, anchorOf(to), index, { exhaustive: true });
  let mark = anchorOf(to);
  for (const model of to.models) {
    const result = sight(eye, model.hull, index, { exhaustive: true });
    if (result.exposure > best.exposure) {
      best = result;
      mark = model.hull;
    }
  }
  return {
    visible: best.visible,
    exposure: best.exposure,
    blockers: best.blockers,
    cover: coverFor(mark, eye, index).level,
    distance: unitDistance(unitHulls(from), unitHulls(to)),
    rays: best.rays,
  };
}

export interface ChargeReadout {
  readonly distance: number;
  readonly minimumRoll: number;
  readonly probability: number;
  readonly path: readonly Vec3[];
}

/** Ways for 2D6 to land on or above `n`, for `n` from 2 to 12. */
const WAYS_AT_LEAST = [36, 35, 33, 30, 26, 21, 15, 10, 6, 3, 1];
export const chargeOdds = (roll: number): number => (roll <= 2 ? 1 : roll > 12 ? 0 : (WAYS_AT_LEAST[roll - 2] ?? 0) / 36);

export function chargeBetween(from: BattleUnit, to: BattleUnit, state: BattleState, index = indexOf(state)): ChargeReadout {
  const result = chargeGeometry(unitHulls(from), unitHulls(to), index, { keywords: from.keywords, blockers: otherHulls(state, from.id) });
  return { distance: result.distance, minimumRoll: result.minimumRoll, probability: chargeOdds(result.minimumRoll), path: result.path };
}

/** What the tape reads between two marks: inches across the table, with no regard for terrain. */
export const tapeDistance = (a: Vec2, b: Vec2): number => Math.hypot(b.x - a.x, b.y - a.y);

/** A tape left on the table: two marks, and the line between them. */
export interface Tape {
  readonly id: string;
  readonly from: Vec3;
  readonly to: Vec3;
}

/**
 * What a mark does: with no tape in progress it starts one; with one in progress it finishes it.
 * A finished tape stays on the table — tapes are removed one at a time, by hand, never by the next
 * measurement — so the caller gets either a new pending mark or a new tape, not both.
 */
export function dropMark(pending: Vec3 | undefined, at: Vec3, id: string): { pending?: Vec3; tape?: Tape } {
  if (!pending) return { pending: at };
  if (tapeDistance(pending, at) < 1e-6) return { pending };
  return { tape: { id, from: pending, to: at } };
}

/* ---- a force to look at ------------------------------------------------------------------------ */

/**
 * A placeholder force, so the table has something on it before an army is loaded.
 *
 * Invented profiles and invented names: this project ships no Games Workshop data, and a
 * demonstration is no reason to start.
 */
const SAMPLE: readonly { name: string; move: number; oc: number; count: number; baseMm: number; keywords: string[] }[] = [
  { name: "battle.sample.lineInfantry", move: 6, oc: 2, count: 10, baseMm: 32, keywords: ["INFANTRY"] },
  { name: "battle.sample.heavyInfantry", move: 5, oc: 1, count: 5, baseMm: 40, keywords: ["INFANTRY"] },
  { name: "battle.sample.transport", move: 12, oc: 0, count: 1, baseMm: 100, keywords: ["VEHICLE"] },
  { name: "battle.sample.walker", move: 8, oc: 3, count: 1, baseMm: 90, keywords: ["MONSTER", "WALKER"] },
];

function sampleUnit(side: Side, i: number, at: Vec2): BattleUnit {
  const spec = SAMPLE[i % SAMPLE.length]!;
  const height = heightForKeywords(spec.keywords);
  const unit: BattleUnit = {
    id: `${side}-${i}`,
    side,
    name: spec.name,
    move: spec.move,
    oc: spec.oc,
    keywords: spec.keywords,
    models: Array.from({ length: spec.count }, (_, m) => ({ id: `${side}-${i}-${m}`, hull: { pos: { x: 0, y: 0, z: 0 }, facing: 0, foot: circleBase(spec.baseMm), height } })),
  };
  return placeUnit(unit, at);
}

/** A layout, its zones and a sample force per side, spread across each deployment zone. */
export function sampleBattle(layout: TerrainLayout = LAYOUTS[1] ?? LAYOUTS[0]!): BattleState {
  const zones = layout.zones?.length === 2 ? (layout.zones as [Zone, Zone]) : edgeZones(layout.size);
  const { width, depth } = layout.size;
  const units: BattleUnit[] = [];
  for (let i = 0; i < SAMPLE.length; i++) {
    const x = ((i + 1) / (SAMPLE.length + 1)) * width;
    units.push(sampleUnit("attacker", i, { x, y: 6 }));
    units.push(sampleUnit("defender", i, { x: width - x, y: depth - 6 }));
  }
  return { layout, zones, units };
}

/** Swap the layout under a battle, keeping the units where they stand. */
export function withLayout(state: BattleState, layout: TerrainLayout): BattleState {
  return { ...state, layout, zones: (layout.zones?.length === 2 ? (layout.zones as [Zone, Zone]) : undefined) ?? edgeZones(layout.size) };
}
