/**
 * The Battle page's state, kept as plain data and pure functions so the rules of the thing can be
 * tested without a browser, a canvas or a GPU.
 *
 * This is **planning mode**: units are dragged as a rigid block, legality is advisory, and nothing
 * is resolved. Model-by-model movement, phases and dice arrive with `packages/game`.
 */

import type { ModelHull, Objective, TerrainLayout, TerrainPiece, Vec2, Vec3, Zone } from "@grimstat/board";
import { BATTLE_SIZES, LAYOUTS, TerrainIndex, canStand, chargeGeometry, circleBase, coverFor, distance, edgeZones, heightForKeywords, inEngagementRange, onBoard, reachable, sight, unitDistance } from "@grimstat/board";

export type Side = "attacker" | "defender";
export type BattleTool = "select" | "measure" | "sight";

export interface BattleModel {
  readonly id: string;
  readonly hull: ModelHull;
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
}

export interface BattleState {
  readonly layout: TerrainLayout;
  readonly zones: readonly [Zone, Zone];
  readonly units: readonly BattleUnit[];
}

/* ---- queries ----------------------------------------------------------------------------------- */

export const unitHulls = (unit: BattleUnit): ModelHull[] => unit.models.map((m) => m.hull);
export const unitsOf = (state: BattleState, side: Side): BattleUnit[] => state.units.filter((u) => u.side === side);
export const enemyHulls = (state: BattleState, side: Side): ModelHull[] => state.units.filter((u) => u.side !== side).flatMap(unitHulls);
export const otherHulls = (state: BattleState, unitId: string): ModelHull[] => state.units.filter((u) => u.id !== unitId).flatMap(unitHulls);
export const findUnit = (state: BattleState, id: string | undefined): BattleUnit | undefined => state.units.find((u) => u.id === id);

/** The model a drag is anchored to: the first, which is also the one the reach overlay is drawn for. */
export const anchorOf = (unit: BattleUnit): ModelHull => unit.models[0]?.hull ?? { pos: { x: 0, y: 0, z: 0 }, facing: 0, foot: circleBase(32), height: 2 };

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

export interface DragVerdict {
  readonly ok: boolean;
  /** Inches the anchor model travels; `undefined` when no legal route reaches the spot. */
  readonly cost?: number;
  /** Why not, in the order a player would notice them. */
  readonly problems: readonly string[];
}

/**
 * Is this a legal place to put the unit, and what does getting there cost?
 *
 * Advisory, and honest about being an approximation: the cost is the anchor model's route, while the
 * rules move each model on its own. It is right for a unit that keeps its shape, which is what a
 * rigid drag produces, and it never silently blocks — it reports.
 */
export function dragVerdict(state: BattleState, unit: BattleUnit, to: Vec2, index = indexOf(state)): DragVerdict {
  const anchor = anchorOf(unit);
  const moved = translateUnit(unit, { x: to.x - anchor.pos.x, y: to.y - anchor.pos.y });
  const problems: string[] = [];

  for (const m of moved.models) {
    if (!onBoard(m.hull, state.layout.size)) {
      problems.push("battle.problem.offTable");
      break;
    }
  }
  const blockers = otherHulls(state, unit.id);
  for (const m of moved.models) {
    if (!canStand(m.hull, m.hull.pos, index, { keywords: unit.keywords, blockers })) {
      problems.push("battle.problem.blocked");
      break;
    }
  }
  const enemies = enemyHulls(state, unit.side);
  if (moved.models.some((m) => enemies.some((e) => inEngagementRange(m.hull, e)))) problems.push("battle.problem.engagement");

  const reach = reachable(anchor, unit.move, index, { keywords: unit.keywords, enemies, blockers, until: (at) => Math.hypot(at.x - to.x, at.y - to.y) < 0.26 });
  const landed = reach.stoppedAt;
  const cost = landed === undefined ? undefined : reach.nodes[landed]!.cost;
  if (cost === undefined) problems.push("battle.problem.tooFar");

  return { ok: problems.length === 0, cost, problems };
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

export const measure = (a: ModelHull, b: ModelHull): number => distance(a, b);

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
  const zones = edgeZones(layout.size);
  const { width, depth } = layout.size;
  const units: BattleUnit[] = [];
  for (let i = 0; i < SAMPLE.length; i++) {
    const x = ((i + 1) / (SAMPLE.length + 1)) * width;
    units.push(sampleUnit("attacker", i, { x, y: 6 }));
    units.push(sampleUnit("defender", i, { x: width - x, y: depth - 6 }));
  }
  return { layout, zones, units };
}

export const BATTLE_LAYOUTS = LAYOUTS;
export const BATTLE_SIZE_LIST = BATTLE_SIZES;
export type { TerrainLayout, TerrainPiece, Objective, Zone };
