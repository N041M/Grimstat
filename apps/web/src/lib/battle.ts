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

import type { CoherencyReport, Footprint, ModelHull, ReachNode, ReachOptions, ReachResult, TerrainLayout, TerrainPiece, Vec2, Vec3, Zone } from "@grimstat/board";
import { COHERENCY_RANGE, LAYOUTS, MOVE_RULES, TOUCH, TerrainIndex, canStand, chargeGeometry, circleBase, coherency, coreSegment, coverFor, distance, edgeZones, footReach, heightForKeywords, horizontalGap, inEngagementRange, inZone, onBoard, ovalBase, pointInPolygon, reachable, segPolygonDistance, sight, unitDistance } from "@grimstat/board";
import type { ModelProfile, Roster, Snapshot } from "@grimstat/schema";
import { unitClassFor, type UnitClassId } from "./unitArt";

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

/** Coherency of the unit as it currently stands. It is reported and is not enforced mid-move. */
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
 * A convenience for putting a unit down rather than a substitute for moving models. It keeps the formation
 * and charges every model the lead model's route. Fine for deployment and for a unit crossing open
 * ground; useless for screening, which is what the per-model move is for.
 */
export function dragVerdict(state: BattleState, unit: BattleUnit, to: Vec2, index = indexOf(state)): MoveVerdict {
  const anchor = anchorOf(unit);
  const { enemies, blockers } = obstacles(state, unit);
  const problems: string[] = [];

  // Every model travels the lead model's distance and is charged it, so the drag is limited by
  // whichever model has the least left. Budgeting against the lead alone took a model that had
  // already moved on its own, or one carrying a lower Move, past its own allowance.
  const budget = unit.models.length ? Math.min(...unit.models.map((m) => remainingMove(unit, m))) : unit.move;
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

/* ---- groups ------------------------------------------------------------------------------------ */

/** One model of a selection that may span units. */
export interface GroupMember {
  readonly unitId: string;
  readonly modelId: string;
}

/** A member's share of a group move: where it lands, what it pays, the way it goes. */
export interface GroupMove extends GroupMember {
  readonly at: Vec3;
  readonly cost: number;
  readonly path?: readonly Vec3[];
}

/** What would become of a selection sent somewhere. */
export interface GroupVerdict {
  readonly ok: boolean;
  readonly moves: GroupMove[];
  readonly problems: string[];
  /** The selection could not cross as a body and was fitted into the ground instead. */
  readonly spaced?: boolean;
}

/**
 * Move several models together.
 *
 * A squad crossing open table goes as it stands: every model the same offset, keeping its place in
 * the formation. Sent into a ruin, a gateway or a crowd, the formation is what fails — one model in
 * five would land in a wall, and refusing the whole move on that account is not what anyone does
 * with real models. They put the squad down in the space that is there. So a body move that will
 * not go is followed by `fitGroup`, which looks for that space.
 *
 * A body move can also *succeed* and still be wrong. A ruin's footprint is its walls, and the
 * keywords that may cross them may also stand inside, so a squad sent up to a building has a
 * perfectly legal formation with its back rank standing in the ground floor and its front rank
 * halfway through the wall. Nobody moves models that way: they put the squad along the face of the
 * building. `aim` is where the player actually pointed, and a building they did not point into is
 * something the unit goes round — see `fitGroup`. Pointing into it is how a unit is sent inside.
 */
export function groupMoveVerdict(state: BattleState, members: readonly GroupMember[], by: Vec2, index = indexOf(state), aim?: Vec2): GroupVerdict {
  const body = slideGroup(state, members, by, index);
  if (members.length < 2) return body;
  const sentInto = aim ? new Set(index.at(aim, solid).map((p) => p.id)) : new Set<string>();
  if (body.ok && !body.moves.some((m) => standsInside(hullOf(state, m), index, sentInto))) return body;
  return fitGroup(state, members, by, index, sentInto) ?? body;
}

/**
 * A piece a unit walks round rather than over: one too tall to be stepped across.
 *
 * The threshold is the movement search's own, so a crater is ground and a building is a building,
 * with no second opinion about which is which.
 */
const solid = (piece: TerrainPiece): boolean => piece.height > MOVE_RULES.stepOver;

/** Where a move would put a model, as a hull the geometry can be asked about. */
function hullOf(state: BattleState, move: GroupMove): ModelHull | undefined {
  const unit = findUnit(state, move.unitId);
  const model = unit && findModel(unit, move.modelId);
  return model ? { ...model.hull, pos: move.at } : undefined;
}

/**
 * Is any part of this base inside one of these buildings?
 *
 * A base flush against a wall is not inside it. Standing against a building is how models take
 * cover, and a rule that pushed them a hundredth of an inch off it would be a nuisance rather than
 * a correction, so the test is overlap rather than contact.
 */
function overlaps(hull: ModelHull, pieces: readonly TerrainPiece[]): boolean {
  if (!pieces.length) return false;
  const core = coreSegment(hull);
  return pieces.some((p) => segPolygonDistance(core, p.polygon) < hull.foot.r - TOUCH);
}

/** Would this move leave the model standing in a building the unit was not sent into? */
function standsInside(hull: ModelHull | undefined, index: TerrainIndex, sentInto: ReadonlySet<string>): boolean {
  if (!hull) return false;
  return overlaps(hull, index.near({ x: hull.pos.x, y: hull.pos.y }, footReach(hull.foot), solid).filter((p) => !sentInto.has(p.id)));
}

/**
 * The body move: every member by the same offset, each judged on its own from where it stands.
 *
 * The companions are taken off the table while a member's route is searched, since they are moving
 * too and would otherwise block each other's starting and finishing spots, and the members are then
 * checked against each other where they land. The group goes only if every model can; the problems
 * are the union of theirs.
 */
function slideGroup(state: BattleState, members: readonly GroupMember[], by: Vec2, index: TerrainIndex): GroupVerdict {
  const ids = new Set(members.map((m) => m.modelId));
  const without = (except: string): BattleState => ({
    ...state,
    units: state.units.map((u) => ({ ...u, models: u.models.filter((m) => !ids.has(m.id) || m.id === except) })),
  });
  const moves: GroupMove[] = [];
  const landed: ModelHull[] = [];
  const problems: string[] = [];
  const note = (p: string) => {
    if (!problems.includes(p)) problems.push(p);
  };
  for (const member of members) {
    const world = without(member.modelId);
    const unit = findUnit(world, member.unitId);
    const model = unit && findModel(unit, member.modelId);
    if (!unit || !model) continue;
    const verdict = modelMoveVerdict(world, unit, model, { x: model.hull.pos.x + by.x, y: model.hull.pos.y + by.y }, index);
    if (verdict.ok && verdict.at && verdict.cost !== undefined) {
      moves.push({ ...member, at: verdict.at, cost: verdict.cost, path: verdict.path });
      landed.push({ ...model.hull, pos: verdict.at });
    }
    verdict.problems.forEach(note);
  }
  for (let i = 0; i < landed.length; i++) {
    for (let j = i + 1; j < landed.length; j++) {
      if (Math.abs(landed[i]!.pos.z - landed[j]!.pos.z) < 0.5 && horizontalGap(landed[i]!, landed[j]!) <= 0) note("battle.problem.blocked");
    }
  }
  return { ok: problems.length === 0 && moves.length === members.length, moves, problems };
}

/** Daylight a fitted squad keeps between two bases, in inches, so two models never read as one. */
const FIT_CLEARANCE = 0.1;

/**
 * How far short of where it was sent a unit may end up and still count as having gone there.
 *
 * This is about the order, not about the ground: a unit sent further than it can walk is told so
 * rather than quietly advancing as far as it can. What is *in the way* is a different matter —
 * a model that cannot reach its place in the formation because a building stands in it goes as far
 * round as it can get, however far short of the formation that leaves it.
 */
const FIT_SLACK = COHERENCY_RANGE;

/** One model looking for somewhere to stand, and everywhere it could. */
interface Mover {
  readonly member: GroupMember;
  readonly hull: ModelHull;
  /** Where the body move would have put it: the spot to stay as near to as the ground allows. */
  readonly want: Vec2;
  readonly reach: ReachResult;
  /** Buildings within its reach that it is meant to stay out of. */
  readonly walls: readonly TerrainPiece[];
}

/** A spot already spoken for by a member placed earlier. */
interface Taken {
  readonly unitId: string;
  readonly hull: ModelHull;
}

/**
 * Everywhere a model could end its move, remembered for as long as the table stands still.
 *
 * A drag asks this same question of the same models sixty times a second, and the answer does not
 * depend on where the hand is: only on the model, the table and who else is moving. `BattleState`
 * is immutable and is replaced whenever anything on the table changes, so a search made against one
 * state object is still the answer for every later frame that is handed the same object. The map is
 * weak, so a state nobody holds any more takes its searches with it. The `index` must be that
 * state's own, which is what `indexOf` gives every caller here.
 */
const searched = new WeakMap<BattleState, Map<string, ReachResult>>();

function everywhere(state: BattleState, model: BattleModel, budget: number, index: TerrainIndex, opts: ReachOptions, key: string): ReachResult {
  let byModel = searched.get(state);
  if (!byModel) searched.set(state, (byModel = new Map()));
  const id = `${model.id}|${key}`;
  let found = byModel.get(id);
  if (!found) byModel.set(id, (found = reachable(model.hull, budget, index, opts)));
  return found;
}

/**
 * Fit a group into the ground around where it was sent.
 *
 * Every member's reach is searched once — the companions are left out of the blockers, since they
 * are all moving — and the members then take their spots one at a time, each the position nearest
 * where the formation wanted it that nobody has claimed. They go in order of distance from the
 * middle of the group, so the centre of a squad claims its ground and the rest fit around it, which
 * is the order a handful of models actually goes through a gap in.
 *
 * A model that cannot reach its place in the formation takes the nearest place it can, which is how
 * a squad ends up strung along the face of a building rather than standing in it: each model gets as
 * far round as its own Move takes it. Two things are preferred over being near the formation, in
 * this order — staying out of a building the unit was not sent into, then keeping within coherency
 * of the unit's models that already have their spot. Both give way rather than fail: coherency is
 * advisory here, and a model with nowhere clear to stand is better placed somewhere than nowhere.
 *
 * Nothing here relaxes a rule. The spots come from the movement search, so each is within that
 * model's own remaining Move and clear of terrain, the table's edge, enemies and everyone else.
 * Undefined means some member had nowhere at all to go, and the body move stands in its place.
 */
function fitGroup(state: BattleState, members: readonly GroupMember[], by: Vec2, index: TerrainIndex, sentInto: ReadonlySet<string>): GroupVerdict | undefined {
  const ids = new Set(members.map((m) => m.modelId));
  const blockers = deployedUnits(state).flatMap((u) => u.models.filter((m) => !ids.has(m.id)).map((m) => m.hull));
  // What the searches below depend on, beyond the model and the state: who else is moving.
  const key = [...ids].sort().join(" ");

  // A route is at least as long as the straight line it covers, so a model whose Move cannot bring
  // it within the slack of its place in the formation cannot be fitted at all. Saying so here costs
  // nothing; finding it out by searching costs a flood fill per model, on every frame of a drag
  // that has simply gone too far — which is the commonest way for a move to fail.
  const straight = Math.hypot(by.x, by.y);

  const placed = new Map<string, GroupMove>();
  const taken: Taken[] = [];
  const movers: Mover[] = [];
  for (const member of members) {
    const unit = findUnit(state, member.unitId);
    const model = unit && findModel(unit, member.modelId);
    if (!unit || !model) return undefined;
    const budget = remainingMove(unit, model);
    if (budget + FIT_SLACK < straight) return undefined;
    const reach = everywhere(state, model, budget, index, { keywords: unit.keywords, enemies: enemyHulls(state, unit.side), blockers, board: state.layout.size }, key);
    // The buildings this model could reach, gathered once: the alternative is asking the index
    // about every one of a few hundred candidate spots.
    const walls = index.near({ x: model.hull.pos.x, y: model.hull.pos.y }, budget + footReach(model.hull.foot), solid).filter((p) => !sentInto.has(p.id));
    movers.push({ member, hull: model.hull, want: { x: model.hull.pos.x + by.x, y: model.hull.pos.y + by.y }, reach, walls });
  }
  const cx = movers.reduce((sum, m) => sum + m.want.x, 0) / movers.length;
  const cy = movers.reduce((sum, m) => sum + m.want.y, 0) / movers.length;
  const inOut = [...movers].sort((a, b) => Math.hypot(a.want.x - cx, a.want.y - cy) - Math.hypot(b.want.x - cx, b.want.y - cy));

  for (const mover of inOut) {
    const kin = taken.filter((t) => t.unitId === mover.member.unitId).map((t) => t.hull);
    // Clear of the buildings and in coherency; then clear of them; then in coherency; then anywhere.
    const spot = nearestSpot(mover, taken, kin, mover.walls) ?? nearestSpot(mover, taken, [], mover.walls) ?? nearestSpot(mover, taken, kin, []) ?? nearestSpot(mover, taken, [], []);
    if (!spot) return undefined;
    placed.set(mover.member.modelId, { ...mover.member, at: spot.at, cost: spot.cost, path: spot.path });
    taken.push({ unitId: mover.member.unitId, hull: { ...mover.hull, pos: spot.at } });
  }

  // Reported in the order they were asked for rather than the order they were fitted in.
  return { ok: true, moves: members.flatMap((m) => placed.get(m.modelId) ?? []), problems: [], spaced: true };
}

/**
 * The spot a mover takes: the reachable position nearest where the formation wanted it, clear of
 * everything already claimed, out of the buildings in `walls`, and — while `kin` is given — within
 * coherency of its own unit's models that already have theirs. Ties go to the shorter route.
 */
function nearestSpot(mover: Mover, taken: readonly Taken[], kin: readonly ModelHull[], walls: readonly TerrainPiece[]): { at: Vec3; cost: number; path: readonly Vec3[] } | undefined {
  const nodes = mover.reach.nodes;
  let best: number | undefined;
  let bestGap = Infinity;
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]!;
    const gap = Math.hypot(node.at.x - mover.want.x, node.at.y - mover.want.y);
    if (gap > bestGap) continue;
    if (best !== undefined && gap === bestGap && node.cost >= nodes[best]!.cost) continue;
    const hull: ModelHull = { ...mover.hull, pos: node.at };
    if (taken.some((t) => Math.abs(t.hull.pos.z - node.at.z) < 0.5 && horizontalGap(hull, t.hull) < FIT_CLEARANCE)) continue;
    if (kin.length && !kin.some((k) => distance(hull, k) <= COHERENCY_RANGE)) continue;
    if (overlaps(hull, walls)) continue;
    best = i;
    bestGap = gap;
  }
  if (best === undefined) return undefined;
  return { at: nodes[best]!.at, cost: nodes[best]!.cost, path: mover.reach.pathTo(best) };
}

/** Make a group move: every member travels its own route and pays for it. */
export function applyGroupMove(state: BattleState, moves: readonly GroupMove[]): BattleState {
  return { ...state, units: state.units.map((u) => moves.filter((m) => m.unitId === u.id).reduce((unit, m) => applyModelMove(unit, m.modelId, m.at, m.cost, m.path), u)) };
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

/** An angle brought back into (−π, π]. */
const wrapAngle = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

/** Whether a model is among `only`: one id, a set of ids, or every model when nothing is given. */
const among = (id: string, only?: string | ReadonlySet<string>): boolean => only === undefined || (typeof only === "string" ? id === only : only.has(id));

/** Turn one model, several, or every model of the unit, by `by` radians about its own base, in place. */
export function rotateUnit(unit: BattleUnit, by: number, only?: string | ReadonlySet<string>): BattleUnit {
  return { ...unit, models: unit.models.map((m) => (among(m.id, only) ? { ...m, hull: { ...m.hull, facing: wrapAngle(m.hull.facing + by) } } : m)) };
}

/**
 * Whether a turn is allowed, and the turned unit if so.
 *
 * A round base turns freely. An oval one sweeps a different footprint, and can swing off the table,
 * into a wall or another base, or into an enemy's engagement range — the same refusals as a move.
 */
export function rotateVerdict(state: BattleState, unit: BattleUnit, by: number, only?: string | ReadonlySet<string>, index = indexOf(state)): { ok: boolean; unit: BattleUnit; problems: string[] } {
  const turned = rotateUnit(unit, by, only);
  const { enemies, blockers } = obstacles(state, unit);
  const problems: string[] = [];
  if (turned.models.some((m) => !onBoard(m.hull, state.layout.size))) problems.push("battle.problem.offTable");
  if (turned.models.some((m) => !canStand(m.hull, m.hull.pos, index, { keywords: unit.keywords, blockers: [...blockers, ...turned.models.filter((o) => o !== m).map((o) => o.hull)] }))) problems.push("battle.problem.blocked");
  if (turned.models.some((m) => enemies.some((e) => inEngagementRange(m.hull, e)))) problems.push("battle.problem.engagement");
  return { ok: !problems.length, unit: turned, problems };
}

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
 * Exhaustive on purpose. Stopping at the first clear ray would answer the boolean faster but would
 * tell the player nothing about how exposed the target is, which is what the tool exists to show.
 */
export function sightBetween(from: BattleUnit, to: BattleUnit, index: TerrainIndex): SightReadout {
  // Every model of the firing unit, against every model of the target. A unit may shoot what any of
  // its models can see, so taking only the first one reported a blocked shot whenever the lead
  // model happened to be the one behind the wall.
  let eye = anchorOf(from);
  let mark = anchorOf(to);
  let best = sight(eye, mark, index, { exhaustive: true });
  search: for (const shooter of from.models) {
    for (const model of to.models) {
      const result = sight(shooter.hull, model.hull, index, { exhaustive: true });
      if (result.exposure > best.exposure) {
        best = result;
        eye = shooter.hull;
        mark = model.hull;
        if (best.exposure >= 1) break search;
      }
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
 * A finished tape stays on the table until it is removed by hand; the next measurement does not clear
 * it. The caller therefore gets either a new pending mark or a new tape, and not both at once.
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

function sampleUnit(side: Side, i: number): BattleUnit {
  const spec = SAMPLE[i % SAMPLE.length]!;
  const height = heightForKeywords(spec.keywords);
  return {
    id: `${side}-${i}`,
    side,
    name: spec.name,
    move: spec.move,
    oc: spec.oc,
    keywords: spec.keywords,
    models: Array.from({ length: spec.count }, (_, m) => ({ id: `${side}-${i}-${m}`, hull: { pos: { x: 0, y: 0, z: 0 }, facing: 0, foot: circleBase(spec.baseMm), height } })),
    reserve: true,
  };
}

/** The sample force for one side, in reserve. */
export const sampleForce = (side: Side): BattleUnit[] => SAMPLE.map((_, i) => sampleUnit(side, i));

/** A layout, its zones and the units given, as they are: nothing is placed. */
export function battleWith(layout: TerrainLayout, units: readonly BattleUnit[]): BattleState {
  const zones = layout.zones?.length === 2 ? (layout.zones as [Zone, Zone]) : edgeZones(layout.size);
  return { layout, zones, units };
}

/**
 * Every unit set down afresh, attacker and defender alike.
 *
 * Each side is spread in one row along its zone, evenly across the table's width. A unit that
 * cannot stand where the row puts it (terrain, a crowded row, a zone of another shape) is
 * auto-deployed instead, and stays in reserve if it fits nowhere. The units keep their identity,
 * so a force built from an army survives the reset.
 */
export function freshDeployment(state: BattleState): BattleState {
  const { width, depth } = state.layout.size;
  let next: BattleState = { ...state, units: state.units.map(withdrawUnit) };
  const index = indexOf(state);
  for (const side of ["attacker", "defender"] as const) {
    const mine = unitsOf(next, side);
    mine.forEach((unit, i) => {
      const x = ((i + 1) / (mine.length + 1)) * width;
      const at = side === "attacker" ? { x, y: 6 } : { x: width - x, y: depth - 6 };
      if (deployVerdict(next, unit, at, index).ok) next = replaceUnit(next, deployUnit(unit, at));
    });
    next = autoDeploy(next, side, index);
  }
  return next;
}

/** A layout, its zones and a sample force per side, spread across each deployment zone. */
export function sampleBattle(layout: TerrainLayout = LAYOUTS[1] ?? LAYOUTS[0]!): BattleState {
  const units: BattleUnit[] = [];
  for (let i = 0; i < SAMPLE.length; i++) units.push(sampleUnit("attacker", i), sampleUnit("defender", i));
  return freshDeployment(battleWith(layout, units));
}

/** Give one side a different force. The other side's units are untouched, and the new ones arrive in reserve. */
export function withForce(state: BattleState, side: Side, units: readonly BattleUnit[]): BattleState {
  return { ...state, units: [...state.units.filter((u) => u.side !== side), ...units.map((u) => ({ ...u, side, reserve: true }))] };
}

/* ---- a force from an army ---------------------------------------------------------------------- */

/**
 * A base size as a datasheet writes it: "32mm", "60 x 35mm", "120 x 92mm oval". Text that names no
 * size gives nothing, and the caller falls back on the unit's class.
 */
export function footprintFromBaseSize(text: string | undefined): Footprint | undefined {
  if (!text) return undefined;
  const oval = /(\d+(?:\.\d+)?)\s*(?:mm)?\s*[x×]\s*(\d+(?:\.\d+)?)/i.exec(text);
  if (oval) {
    const a = Number(oval[1]);
    const b = Number(oval[2]);
    return a > 0 && b > 0 ? ovalBase(Math.max(a, b), Math.min(a, b)) : undefined;
  }
  const round = /(\d+(?:\.\d+)?)\s*mm/i.exec(text);
  if (round) {
    const d = Number(round[1]);
    return d > 0 ? circleBase(d) : undefined;
  }
  return undefined;
}

/** The base a model of each class usually stands on, for a datasheet that names none. */
const CLASS_BASES: Readonly<Record<UnitClassId, () => Footprint>> = {
  infantry: () => circleBase(32),
  character: () => circleBase(40),
  vehicle: () => ovalBase(120, 92),
  transport: () => ovalBase(120, 92),
  walker: () => circleBase(60),
  monster: () => ovalBase(105, 70),
  beast: () => circleBase(50),
  swarm: () => circleBase(40),
  aircraft: () => circleBase(60),
  bike: () => ovalBase(75, 42),
  mounted: () => ovalBase(60, 35),
  titanic: () => circleBase(160),
  fortification: () => circleBase(152.4),
};

/** The Move a datasheet gives, in inches. `null` is a profile that does not move; nothing is unknown. */
const DEFAULT_MOVE = 6;
const profileMove = (p: ModelProfile | undefined): number | undefined => (p === undefined ? undefined : p.M === null ? 0 : p.M);

/**
 * The units of an army as battle units for one side, from the snapshot the army was built against.
 *
 * Model counts come from the army; base sizes and Move from each model's profile on the datasheet,
 * with the class of the unit (from its keywords) standing in where the datasheet names no base.
 * A unit whose datasheet is not in the snapshot is left out. Everything arrives in reserve, to be
 * deployed; a unit embarked in a transport or held in reserves is listed like any other, since the
 * table plans deployment rather than enforcing it.
 */
export function unitsFromRoster(roster: Roster, snapshot: Snapshot, side: Side): BattleUnit[] {
  const sheets = new Map(snapshot.data.datasheets.map((d) => [d.id, d] as const));
  const units: BattleUnit[] = [];
  for (const entry of roster.units) {
    const sheet = sheets.get(entry.datasheetId);
    if (!sheet) continue;
    const lead = sheet.models[0];
    const keywords = [...sheet.keywords];
    const height = heightForKeywords(keywords);
    const classBase = CLASS_BASES[unitClassFor(keywords)]();
    const unitMove = profileMove(lead) ?? DEFAULT_MOVE;
    const models: BattleModel[] = [];
    for (const group of entry.models) {
      const profile = sheet.models.find((m) => m.id === group.modelProfileId) ?? lead;
      const foot = footprintFromBaseSize(profile?.baseSize) ?? classBase;
      const move = profileMove(profile);
      for (let i = 0; i < group.count; i++) {
        models.push({ id: `${side}-${entry.id}-${models.length}`, hull: { pos: { x: 0, y: 0, z: 0 }, facing: 0, foot, height }, ...(move !== undefined && move !== unitMove ? { move } : {}) });
      }
    }
    if (!models.length) continue;
    units.push({ id: `${side}-${entry.id}`, side, name: entry.customName?.trim() || sheet.name, move: unitMove, oc: lead?.OC ?? 0, keywords, models, reserve: true });
  }
  return units;
}

/** Swap the layout under a battle, keeping the units where they stand. */
export function withLayout(state: BattleState, layout: TerrainLayout): BattleState {
  return { ...state, layout, zones: (layout.zones?.length === 2 ? (layout.zones as [Zone, Zone]) : undefined) ?? edgeZones(layout.size) };
}
