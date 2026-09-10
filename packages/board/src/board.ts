/**
 * The table: its size, the deployment zones on it and the objectives to be held.
 *
 * Zones and objectives are geometry with an owner attached; which zone a mission uses and what
 * holding one is worth are the mission's business, not this module's.
 */

import type { ModelHull } from "./shapes";
import { coreSegment, footReach } from "./shapes";
import { distance } from "./distance";
import type { Vec2, Vec3 } from "./vec";
import { EPS, bounds, edges, pointInPolygon, segPolygonDistance, segSegDistance } from "./vec";

export interface BoardSize {
  /** Along +x, in inches. */
  readonly width: number;
  /** Along +y, in inches. */
  readonly depth: number;
}

/** Table sizes by battle size. The origin is a corner, so the table spans `[0, w] × [0, d]`. */
export const BATTLE_SIZES = {
  incursion: { width: 44, depth: 30 },
  strikeForce: { width: 60, depth: 44 },
  onslaught: { width: 90, depth: 44 },
} as const satisfies Record<string, BoardSize>;

export type BattleSizeId = keyof typeof BATTLE_SIZES;

/** Which side of the table a region belongs to. */
export type Side = "attacker" | "defender";

export interface Zone {
  readonly id: string;
  readonly owner: Side;
  /** Footprint on the table plane; zones reach to any height. */
  readonly polygon: readonly Vec2[];
}

export interface Objective {
  readonly id: string;
  /** Centre of the marker on the table. */
  readonly at: Vec2;
  /** Height of the surface it sits on. Objectives on an upper floor are legal and are measured to. */
  readonly z?: number;
  /** Radius of the marker itself. A 40 mm marker is the default. */
  readonly markerRadius?: number;
  /** Control range from the marker's edge. */
  readonly range?: number;
}

/** Objective marker defaults, in inches. */
export const OBJECTIVE_MARKER_RADIUS = 40 / 25.4 / 2;
export const OBJECTIVE_RANGE = 3;

export function onBoard(h: ModelHull, size: BoardSize): boolean {
  const core = coreSegment(h);
  const box = bounds([core.a, core.b]);
  const r = h.foot.r;
  return box.minX - r >= 0 && box.minY - r >= 0 && box.maxX + r <= size.width && box.maxY + r <= size.depth;
}

/** Is the model's whole base inside the zone? Deployment asks for wholly within. */
export function inZone(h: ModelHull, zone: Zone): boolean {
  const core = coreSegment(h);
  if (!pointInPolygon(core.a, zone.polygon) || !pointInPolygon(core.b, zone.polygon)) return false;
  let toEdge = Infinity;
  for (const e of edges(zone.polygon)) toEdge = Math.min(toEdge, segSegDistance(core, e));
  return toEdge >= h.foot.r - EPS;
}

/** Any part of the base inside the zone. */
export function touchesZone(h: ModelHull, zone: Zone): boolean {
  return segPolygonDistance(coreSegment(h), zone.polygon) <= h.foot.r;
}

/**
 * Is the model within range of the objective? Measured in three dimensions, so a model on a gantry
 * above a marker holds it and one on the far side of a tall ruin does not.
 */
export function withinObjective(h: ModelHull, o: Objective): boolean {
  const marker = objectiveHull(o);
  return distance(h, marker) <= (o.range ?? OBJECTIVE_RANGE);
}

/** The objective marker expressed as a hull, so it measures like everything else on the table. */
export function objectiveHull(o: Objective): ModelHull {
  const pos: Vec3 = { x: o.at.x, y: o.at.y, z: o.z ?? 0 };
  return { pos, facing: 0, foot: { kind: "circle", r: o.markerRadius ?? OBJECTIVE_MARKER_RADIUS }, height: 0 };
}

export interface ControlInput {
  readonly side: Side;
  readonly hull: ModelHull;
  /** Objective Control characteristic of this model. */
  readonly oc: number;
}

export interface ControlResult {
  readonly controlledBy?: Side;
  readonly totals: Readonly<Record<Side, number>>;
  /** Models contributing, by side, as indices into the input. */
  readonly contributors: readonly number[];
}

/**
 * Who controls an objective: the higher total Objective Control within range wins, and a tie leaves
 * it uncontrolled. Sticky objectives and mission-specific overrides belong to the mission, which can
 * take this total and decide differently.
 */
export function control(o: Objective, models: readonly ControlInput[]): ControlResult {
  const totals: Record<Side, number> = { attacker: 0, defender: 0 };
  const contributors: number[] = [];
  for (let i = 0; i < models.length; i++) {
    const m = models[i]!;
    if (m.oc <= 0 || !withinObjective(m.hull, o)) continue;
    totals[m.side] += m.oc;
    contributors.push(i);
  }
  const controlledBy = totals.attacker > totals.defender ? "attacker" : totals.defender > totals.attacker ? "defender" : undefined;
  return { controlledBy, totals, contributors };
}

/** A rectangular zone, the shape most deployment maps are made of. */
export function rectZone(id: string, owner: Side, minX: number, minY: number, maxX: number, maxY: number): Zone {
  return { id, owner, polygon: [{ x: minX, y: minY }, { x: maxX, y: minY }, { x: maxX, y: maxY }, { x: minX, y: maxY }] };
}

/** Smallest circle that encloses a model's base — handy for broad-phase work in callers. */
export const enclosingRadius = (h: ModelHull): number => footReach(h.foot);
