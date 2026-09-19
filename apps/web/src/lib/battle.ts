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

import type { Aabb2, BoardSize, CoherencyReport, Footprint, ModelHull, ReachNode, ReachOptions, ReachResult, TerrainLayout, TerrainPiece, Vec2, Vec3, Zone } from "@grimstat/board";
import { COHERENCY_RANGE, LAYOUTS, MM_PER_INCH, MOVE_RULES, TOUCH, TerrainIndex, bounds, canStand, chargeGeometry, circleBase, coherency, coreSegment, coverFor, distance, edgeZones, footReach, heightForKeywords, horizontalGap, inBox, inEngagementRange, inZone, onBoard, ovalBase, pointInPolygon, reachable, segPolygonDistance, sight, unitDistance } from "@grimstat/board";
import type { ModelProfile, Roster, Snapshot } from "@grimstat/schema";
import { hullSizeOfModel } from "./hullSizes";
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
  /** Not on the board: standing on its side's muster table, waiting to be deployed. */
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

/** The terrain of a table, ready to be asked about. It is built from the layout's pieces alone. */
export const indexOfLayout = (layout: TerrainLayout): TerrainIndex => new TerrainIndex(layout.pieces);
export const indexOf = (state: BattleState): TerrainIndex => indexOfLayout(state.layout);

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

/**
 * How far apart the model centres of a unit stand when it is set down as a block.
 *
 * Measured from the base's longest half-extent, so an oval base has room along its length as well
 * as across it. The block is laid out on a square grid and the bases turn with the unit, so the
 * spacing has to hold whichever way they face.
 */
const blockSpacing = (unit: BattleUnit): number => Math.max(1.2, unit.models[0] ? footReach(unit.models[0].hull.foot) * 2 + 0.6 : 1.6);

/**
 * How much floor a unit takes up as a block, measured to the outside of the outermost bases.
 *
 * The muster table shelves by this, so it has to be the extent the block really has: an oval base
 * is as long as it is whatever way it is turned, which is `footReach` rather than the radius the
 * spacing is worked out from.
 */
export function blockSize(unit: BattleUnit): { readonly width: number; readonly depth: number } {
  const spacing = blockSpacing(unit);
  const count = Math.max(1, unit.models.length);
  const perRow = Math.max(1, Math.ceil(Math.sqrt(count)));
  const rows = Math.ceil(count / perRow);
  const reach = unit.models[0] ? footReach(unit.models[0].hull.foot) : 0.8;
  return { width: (perRow - 1) * spacing + 2 * reach, depth: (rows - 1) * spacing + 2 * reach };
}

/** Put a unit's models in a block centred on `at`, keeping each model's height and base. */
export function placeUnit(unit: BattleUnit, at: Vec2, z = 0): BattleUnit {
  const spacing = blockSpacing(unit);
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
 * A model's base as the movement search sees it, as text.
 *
 * The facing is in here only for an oval base. A round one covers the same ground whichever way the
 * model is turned, which is why turning a squad of infantry cannot change where any of it can walk.
 */
const baseSignature = (h: ModelHull): string => `${h.pos.x} ${h.pos.y} ${h.pos.z} ${h.height} ` + (h.foot.kind === "circle" ? `c${h.foot.r}` : `o${h.foot.r} ${h.foot.half} ${h.facing}`);

/**
 * What a reach search would read off the table, as one string.
 *
 * The page searches again whenever the battle state changes, and while the turn ring is in hand that
 * is every frame. This is everything the search depends on apart from the terrain: the table's size,
 * whose reach is being asked for and what it has left, and where every model on the board stands. A
 * caller holding the last string and the last answer can tell that nothing has moved and keep the
 * answer it has. The terrain is left out because callers hold a `TerrainIndex` built from it, and
 * comparing that is cheaper than describing the pieces.
 */
export function reachSignature(state: BattleState, unit: BattleUnit, model?: BattleModel): string {
  const parts = [`${state.layout.size.width} ${state.layout.size.depth}`, `${unit.id} ${unit.side}`, model?.id ?? "", `${model ? remainingMove(unit, model) : unit.move}`, unit.keywords.join(",")];
  for (const u of deployedUnits(state)) {
    // Whose models these are decides whether the mover has to go round them or stay clear of them.
    parts.push(`${u.id} ${u.side}`);
    for (const m of u.models) parts.push(baseSignature(m.hull));
  }
  return parts.join("|");
}

/** The table a move is judged against, and everything on it the mover has to get past. */
interface Standing {
  readonly index: TerrainIndex;
  readonly board: BoardSize;
  readonly keywords: readonly string[];
  readonly blockers: readonly ModelHull[];
  readonly enemies: readonly ModelHull[];
}

/**
 * The verdict for a move whose search has already been made.
 *
 * `landed` is the node the model stops on, and nothing when the search never got within `SNAP` of
 * where the move was sent. A move that cannot be made is still judged against the spot it was aimed
 * at, so the player is told everything wrong with it rather than only that it is out of range.
 */
function landing(model: BattleModel, to: Vec2, reach: ReachResult, landed: number | undefined, world: Standing): MoveVerdict {
  const node = landed === undefined ? undefined : reach.nodes[landed];
  const problems: string[] = [];
  if (!node) problems.push("battle.problem.tooFar");

  const at: Vec3 = node ? node.at : { x: to.x, y: to.y, z: model.hull.pos.z };
  const moved: ModelHull = { ...model.hull, pos: at };
  if (!onBoard(moved, world.board)) problems.push("battle.problem.offTable");
  if (!canStand(moved, at, world.index, { keywords: world.keywords, blockers: world.blockers })) problems.push("battle.problem.blocked");
  if (world.enemies.some((e) => inEngagementRange(moved, e))) problems.push("battle.problem.engagement");

  return { ok: problems.length === 0, at: node ? at : undefined, cost: node?.cost, path: node ? reach.pathTo(landed!) : undefined, problems };
}

/**
 * Which node of a finished search a move sent to `to` stops on.
 *
 * The cheapest node within `SNAP` is the one a search told to stop at `to` would have stopped at,
 * since the search settles nodes in order of what they cost and stops at the first that qualifies.
 * So a search of everywhere the model can go answers for any destination, which is what lets a drag
 * search once and read the answer on every later frame.
 */
function stopAt(reach: ReachResult, to: Vec2): number | undefined {
  let best: number | undefined;
  for (let i = 0; i < reach.nodes.length; i++) {
    const node = reach.nodes[i]!;
    if (Math.hypot(node.at.x - to.x, node.at.y - to.y) > SNAP) continue;
    if (best === undefined || node.cost < reach.nodes[best]!.cost) best = i;
  }
  return best;
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
  const around = [...blockers, ...unitHulls(unit).filter((h) => h !== model.hull)];

  const reach = reachable(model.hull, remainingMove(unit, model), index, {
    keywords: unit.keywords,
    enemies,
    blockers: around,
    board: state.layout.size,
    until: (at) => Math.hypot(at.x - to.x, at.y - to.y) <= SNAP,
  });
  return landing(model, to, reach, reach.stoppedAt, { index, board: state.layout.size, keywords: unit.keywords, blockers: around, enemies });
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
 * The name a group's searches are remembered under, for one of the two searchers.
 *
 * Both look for everywhere a member can go with the whole group lifted off the table, and for a
 * group taken from one side whose units are all on the board they look for exactly the same ground,
 * so they share what they find. A selection reaching across both sides counts a different set of
 * models as enemies in each, and one taking in a unit still on its muster table counts a different
 * set as blockers, so those keep their answers apart.
 */
function searchKey(state: BattleState, members: readonly GroupMember[], ids: ReadonlySet<string>, searcher: "body" | "fit"): string {
  const units = [...new Set(members.map((m) => m.unitId))].map((id) => findUnit(state, id));
  const alike = units.every((u) => u && !u.reserve && u.side === units[0]!.side);
  return `${alike ? "group" : searcher} ${[...ids].sort().join(" ")}`;
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
 *
 * The searches go through `everywhere`, so a drag makes them on its first frame and reads the same
 * answers on all the rest. Each covers the model's whole remaining Move instead of stopping where
 * the pointer is, and `stopAt` reads the destination out of it.
 */
function slideGroup(state: BattleState, members: readonly GroupMember[], by: Vec2, index: TerrainIndex): GroupVerdict {
  const ids = new Set(members.map((m) => m.modelId));
  const key = searchKey(state, members, ids, "body");
  const stays = (u: BattleUnit): ModelHull[] => u.models.filter((m) => !ids.has(m.id)).map((m) => m.hull);
  const worlds = new Map<string, Standing>();
  /** The table as this member's unit sees it, with the whole group lifted off it. */
  const worldFor = (unit: BattleUnit): Standing => {
    let had = worlds.get(unit.id);
    if (!had) {
      const others = deployedUnits(state);
      had = {
        index,
        board: state.layout.size,
        keywords: unit.keywords,
        blockers: [...others.filter((u) => u.id !== unit.id).flatMap(stays), ...stays(unit)],
        enemies: others.filter((u) => u.side !== unit.side).flatMap(stays),
      };
      worlds.set(unit.id, had);
    }
    return had;
  };
  const moves: GroupMove[] = [];
  const landed: ModelHull[] = [];
  const problems: string[] = [];
  const note = (p: string) => {
    if (!problems.includes(p)) problems.push(p);
  };
  for (const member of members) {
    const unit = findUnit(state, member.unitId);
    const model = unit && findModel(unit, member.modelId);
    if (!unit || !model) continue;
    const world = worldFor(unit);
    const to = { x: model.hull.pos.x + by.x, y: model.hull.pos.y + by.y };
    const reach = everywhere(state, model, remainingMove(unit, model), index, { keywords: unit.keywords, enemies: world.enemies, blockers: world.blockers, board: state.layout.size }, key);
    const verdict = landing(model, to, reach, stopAt(reach, to), world);
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
  const key = searchKey(state, members, ids, "fit");

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

/* ---- the muster table -------------------------------------------------------------------------- */

/*
 * The ground beside the board where a side's units stand before they are deployed.
 *
 * A unit that is not on the board is still somewhere. On a real table it is on the shelf beside
 * you, in a case or on a tray, and deploying it means picking it up from there and putting it down
 * in your zone — it does not appear in the middle of the play area. So each side gets a table of
 * its own beyond its own board edge, every unit has a berth on it, and a unit withdrawn from the
 * board goes back to that berth.
 *
 * The muster table is not part of the play area and the geometry kernel is never asked about it. A
 * model standing there blocks nothing, sees nothing and threatens nobody: `deployedUnits` leaves
 * reserves out of every query, which is still all that `reserve` means. The only thing that has
 * changed is that a reserve unit now has somewhere to be.
 */

/** Clear floor between the play area and a muster table, in inches. */
const MUSTER_GAP = 4;
/** Space left around each block on the muster table, so neighbours can be told apart and picked up. */
const MUSTER_PAD = 1.5;
/** The shallowest a muster table is drawn, since a side with nothing waiting still has a table. */
const MUSTER_MIN_DEPTH = 10;

export interface Muster {
  readonly side: Side;
  /** The table's footprint in board inches. It lies wholly outside the play area. */
  readonly area: Aabb2;
  /** Where each of the side's units stands when it is off the board, by unit id. */
  readonly berths: ReadonlyMap<string, Vec2>;
}

/** Laid out once per state, since every drag over the table asks for it again. */
const musters = new WeakMap<BattleState, Map<Side, Muster>>();

/**
 * A side's muster table and the berth of every one of its units.
 *
 * Berths are shelved: blocks in army order, left to right, wrapping to a new row when the next one
 * would hang off the end, and the table ends up as deep as the rows it needed. It is laid out from
 * the whole force rather than from what happens to be off the board, so the table keeps its size as
 * units are deployed and a withdrawn unit goes back to the spot it left. The defender's berths run
 * the other way along x, since that player reads the table from the far edge.
 */
export function muster(state: BattleState, side: Side): Muster {
  let byside = musters.get(state);
  if (!byside) musters.set(state, (byside = new Map()));
  const had = byside.get(side);
  if (had) return had;
  const made = shelve(state, side);
  byside.set(side, made);
  return made;
}

/** A row of blocks on the muster table, filled left to right until the next one will not fit. */
interface Shelf {
  readonly blocks: { readonly unit: BattleUnit; readonly size: { readonly width: number; readonly depth: number } }[];
  width: number;
  depth: number;
}

function shelve(state: BattleState, side: Side): Muster {
  const { width, depth } = state.layout.size;
  const room = width - 2 * MUSTER_PAD;
  const shelves: Shelf[] = [];
  for (const unit of unitsOf(state, side)) {
    const size = blockSize(unit);
    let shelf = shelves[shelves.length - 1];
    if (!shelf || (shelf.blocks.length > 0 && shelf.width + MUSTER_PAD + size.width > room)) {
      shelf = { blocks: [], width: 0, depth: 0 };
      shelves.push(shelf);
    }
    shelf.width += (shelf.blocks.length > 0 ? MUSTER_PAD : 0) + size.width;
    shelf.depth = Math.max(shelf.depth, size.depth);
    shelf.blocks.push({ unit, size });
  }

  // Local coordinates: x across the table from the side's own left, y away from the board. Each row
  // is centred on the table, so a small force stands in the middle of its shelf rather than in a
  // corner of it.
  const berths = new Map<string, Vec2>();
  let y = MUSTER_PAD;
  for (const shelf of shelves) {
    let x = (width - shelf.width) / 2;
    for (const { unit, size } of shelf.blocks) {
      const local = { x: x + size.width / 2, y: y + shelf.depth / 2 };
      berths.set(unit.id, side === "attacker" ? { x: local.x, y: -MUSTER_GAP - local.y } : { x: width - local.x, y: depth + MUSTER_GAP + local.y });
      x += size.width + MUSTER_PAD;
    }
    y += shelf.depth + MUSTER_PAD;
  }

  const used = Math.max(MUSTER_MIN_DEPTH, y);
  const area =
    side === "attacker"
      ? { minX: 0, maxX: width, minY: -MUSTER_GAP - used, maxY: -MUSTER_GAP }
      : { minX: 0, maxX: width, minY: depth + MUSTER_GAP, maxY: depth + MUSTER_GAP + used };
  return { side, area, berths };
}

/** Where this unit stands when it is off the board. The middle of the table for a unit with no berth. */
export function berthOf(state: BattleState, unit: BattleUnit): Vec2 {
  const home = muster(state, unit.side);
  return home.berths.get(unit.id) ?? { x: (home.area.minX + home.area.maxX) / 2, y: (home.area.minY + home.area.maxY) / 2 };
}

/** The muster table a point on the floor belongs to, if it belongs to either. */
export function musterAt(state: BattleState, at: Vec2): Side | undefined {
  if (inBox(at, muster(state, "attacker").area)) return "attacker";
  if (inBox(at, muster(state, "defender").area)) return "defender";
  return undefined;
}

/** Everything there is to look at: the play area with both muster tables beside it. */
export function sceneFrame(state: BattleState): Aabb2 {
  const { width, depth } = state.layout.size;
  const near = muster(state, "attacker").area;
  const far = muster(state, "defender").area;
  return { minX: Math.min(0, near.minX, far.minX), maxX: Math.max(width, near.maxX, far.maxX), minY: Math.min(0, near.minY), maxY: Math.max(depth, far.maxY) };
}

/** Is the model's whole base inside this rectangle? */
function wholly(h: ModelHull, area: Aabb2): boolean {
  const core = coreSegment(h);
  const box = bounds([core.a, core.b]);
  const r = h.foot.r;
  return box.minX - r >= area.minX && box.minY - r >= area.minY && box.maxX + r <= area.maxX && box.maxY + r <= area.maxY;
}

/**
 * May this unit stand here on its muster table?
 *
 * Less is asked than of a deployment: there is no terrain off the board, nothing is in anyone's
 * engagement range and nothing is spent. The block has to fit on the table and not stand on top of
 * another unit waiting there.
 */
export function musterVerdict(state: BattleState, unit: BattleUnit, at: Vec2): MoveVerdict {
  const placed = placeUnit(unit, at);
  const area = muster(state, unit.side).area;
  const waiting = state.units.filter((u) => u.id !== unit.id && u.reserve && u.side === unit.side).flatMap(unitHulls);
  const problems: string[] = [];
  if (placed.models.some((m) => !wholly(m.hull, area))) problems.push("battle.problem.offMuster");
  if (placed.models.some((m) => waiting.some((other) => horizontalGap(m.hull, other) <= 0))) problems.push("battle.problem.musterTaken");
  return { ok: problems.length === 0, at: { x: at.x, y: at.y, z: 0 }, cost: 0, problems };
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

/** Stand a unit on its muster table as a block centred on `at`, fresh: nothing moved, nothing spent. */
export function musterUnit(unit: BattleUnit, at: Vec2): BattleUnit {
  const placed = placeUnit(unit, at);
  return { ...placed, reserve: true, models: placed.models.map((m) => ({ ...m, from: undefined, spent: 0, route: undefined })) };
}

/** Turn every model of a unit to the same facing, in place. */
export const faceUnit = (unit: BattleUnit, facing: number): BattleUnit => ({ ...unit, models: unit.models.map((m) => ({ ...m, hull: { ...m.hull, facing } })) });

/** The average of a polygon's corners, which is near enough to the middle of a deployment zone. */
const centreOf = (polygon: readonly Vec2[]): Vec2 => ({ x: polygon.reduce((s, p) => s + p.x, 0) / polygon.length, y: polygon.reduce((s, p) => s + p.y, 0) / polygon.length });

/**
 * The way a side's models face when they are first set down. It runs from the middle of the side's
 * own deployment zone towards the middle of the enemy's. With the usual pair of edge zones that is
 * straight up the table for the attacker and straight down it for the defender.
 */
export function enemyBearing(state: BattleState, side: Side): number {
  const own = centreOf(zoneOf(state, side).polygon);
  const foe = centreOf(zoneOf(state, side === "attacker" ? "defender" : "attacker").polygon);
  const dx = foe.x - own.x;
  const dy = foe.y - own.y;
  if (Math.hypot(dx, dy) < 1e-6) return side === "attacker" ? Math.PI / 2 : -Math.PI / 2;
  return Math.atan2(dy, dx);
}

/** Take a unit off the table and put it back in its berth on its side's muster table, facing the board. */
export const withdrawUnit = (state: BattleState, unit: BattleUnit): BattleUnit => musterUnit(faceUnit(unit, enemyBearing(state, unit.side)), berthOf(state, unit));

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

/** Take every unit off the board and back to its berth on its own muster table. */
export const clearDeployment = (state: BattleState): BattleState => ({ ...state, units: state.units.map((u) => withdrawUnit(state, u)) });

/**
 * Put every reserve unit of a side somewhere legal in its zone.
 *
 * Back edge first and centre outwards, one inch at a time, first legal spot wins: the way a player
 * fills a zone when the terrain, not the plan, is deciding. Units that fit nowhere stay in reserve.
 * Every unit set down is turned to face the enemy's zone.
 */
export function autoDeploy(state: BattleState, side: Side, index = indexOf(state)): BattleState {
  let next = state;
  const zone = zoneOf(state, side);
  const bearing = enemyBearing(state, side);
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

  for (const waiting of state.units) {
    if (waiting.side !== side || !waiting.reserve) continue;
    const unit = faceUnit(waiting, bearing);
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

/** The sample force for one side, off the board. */
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
 * auto-deployed instead, and stays on its muster table if it fits nowhere. The units keep their
 * identity, so a force built from an army survives being deployed and withdrawn again. Every model
 * is turned to face the enemy's zone.
 */
export function freshDeployment(state: BattleState): BattleState {
  const { width, depth } = state.layout.size;
  let next: BattleState = clearDeployment(state);
  const index = indexOf(state);
  for (const side of ["attacker", "defender"] as const) {
    const mine = unitsOf(next, side);
    const bearing = enemyBearing(next, side);
    mine.forEach((u, i) => {
      const unit = faceUnit(u, bearing);
      const x = ((i + 1) / (mine.length + 1)) * width;
      const at = side === "attacker" ? { x, y: 6 } : { x: width - x, y: depth - 6 };
      if (deployVerdict(next, unit, at, index).ok) next = replaceUnit(next, deployUnit(unit, at));
    });
    next = autoDeploy(next, side, index);
  }
  return next;
}

/** A layout, its zones and a sample force per side, standing on each side's muster table. */
export function sampleBattle(layout: TerrainLayout = LAYOUTS[1] ?? LAYOUTS[0]!): BattleState {
  const units: BattleUnit[] = [];
  for (let i = 0; i < SAMPLE.length; i++) units.push(sampleUnit("attacker", i), sampleUnit("defender", i));
  return clearDeployment(battleWith(layout, units));
}

/** Give one side a different force. The other side is untouched; the new units arrive on the muster table. */
export function withForce(state: BattleState, side: Side, units: readonly BattleUnit[]): BattleState {
  const next: BattleState = { ...state, units: [...state.units.filter((u) => u.side !== side), ...units.map((u) => ({ ...u, side, reserve: true }))] };
  return { ...next, units: next.units.map((u) => (u.side === side ? withdrawUnit(next, u) : u)) };
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

/** The classes whose models often come without a base and stand on their own hull instead. */
const HULL_CLASSES: ReadonlySet<UnitClassId> = new Set(["vehicle", "transport", "monster", "titanic", "walker", "aircraft"]);

/**
 * A footprint for a model whose datasheet names no base ("Use model"). The hull is sized from Wounds.
 *
 * This is an assumption, like the default heights. Among the vehicles that carry no base, length
 * grows with Wounds at about a third of an inch per wound. A ten-wound carrier comes out four and a
 * half inches long, a thirteen-wound battle tank close to six and a twenty-four-wound superheavy
 * nine and a half, which is near what the kits measure. Hulls are drawn two thirds as wide as they
 * are long. A walker stands on its feet rather than lying on tracks, so it gets a round footprint
 * as wide as such a hull would be.
 */
export function hullFromWounds(keywords: readonly string[], wounds: number): Footprint {
  const length = Math.min(12, Math.max(2, 4.5 + (wounds - 10) * 0.36));
  const width = length * 0.65;
  const walker = keywords.some((k) => k.toUpperCase() === "WALKER");
  return walker ? circleBase(width * MM_PER_INCH) : ovalBase(length * MM_PER_INCH, width * MM_PER_INCH);
}

/**
 * What a model stands on. The base its datasheet names comes first. A kit whose size is on record
 * gets that footprint. A vehicle or monster with neither gets a hull sized from its Wounds. Anything
 * else gets the base its class usually has.
 */
export function footprintFor(keywords: readonly string[], profile: ModelProfile | undefined, datasheetName?: string): Footprint {
  const named = footprintFromBaseSize(profile?.baseSize);
  if (named) return named;
  const kit = datasheetName ? hullSizeOfModel(datasheetName, profile?.name) : undefined;
  if (kit) return kit.round ? circleBase(kit.width) : ovalBase(kit.length, kit.width);
  const cls = unitClassFor(keywords);
  if (profile && HULL_CLASSES.has(cls)) return hullFromWounds(keywords, profile.W);
  return CLASS_BASES[cls]();
}

/** The Move a datasheet gives, in inches. `null` means the profile does not move, and is not used for an unknown Move. */
const DEFAULT_MOVE = 6;
const profileMove = (p: ModelProfile | undefined): number | undefined => (p === undefined ? undefined : p.M === null ? 0 : p.M);

/**
 * The units of an army as battle units for one side, from the snapshot the army was built against.
 *
 * Model counts come from the army; base sizes and Move from each model's profile on the datasheet.
 * Where the datasheet names no base, a kit on record gets its measured footprint, a vehicle or
 * monster gets a hull sized from its Wounds and anything else the base its class usually has. See
 * `footprintFor`. A kit on record also gets its measured height in place of the keyword default.
 * Both are looked up per model, by the model's own profile name before the datasheet's.
 * A unit whose datasheet is not in the snapshot is left out. Everything arrives off the board, to
 * be deployed from the muster table; a unit embarked in a transport or held in reserves is listed
 * like any other, since the table plans deployment rather than enforcing it.
 */
export function unitsFromRoster(roster: Roster, snapshot: Snapshot, side: Side): BattleUnit[] {
  const sheets = new Map(snapshot.data.datasheets.map((d) => [d.id, d] as const));
  const units: BattleUnit[] = [];
  for (const entry of roster.units) {
    const sheet = sheets.get(entry.datasheetId);
    if (!sheet) continue;
    const lead = sheet.models[0];
    const keywords = [...sheet.keywords];
    const unitHeight = heightForKeywords(keywords);
    const unitMove = profileMove(lead) ?? DEFAULT_MOVE;
    const models: BattleModel[] = [];
    for (const group of entry.models) {
      const profile = sheet.models.find((m) => m.id === group.modelProfileId) ?? lead;
      const foot = footprintFor(keywords, profile, sheet.name);
      const kit = hullSizeOfModel(sheet.name, profile?.name);
      const height = kit ? kit.height / MM_PER_INCH : unitHeight;
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
