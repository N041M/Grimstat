/**
 * Models as solids.
 *
 * A model is its **base swept upwards**: a circle or an oval, extruded from the surface it stands on
 * to the top of the model. Round bases, oval bases and vehicle hull footprints all reduce to a
 * circle-or-capsule cross section, which keeps every distance query closed-form and every
 * ray-versus-model test cheap.
 *
 * This is an abstraction, not the miniature. It is deliberately generous in the same way a tape
 * measure held against a real model is: nothing here pretends to know where a banner pole is.
 */

import type { Aabb2, Seg2, Vec2, Vec3 } from "./vec";
import { EPS, bounds, dir2, expand, perp2, scale2, add2, sub2 } from "./vec";

export const MM_PER_INCH = 25.4;
export const inches = (mm: number): number => mm / MM_PER_INCH;

/**
 * Base cross section. A capsule is a stadium: a core segment of length `2 * half` with radius `r`
 * around it, so a 60 × 35 mm oval is `{ r: 0.689, half: 0.492 }`.
 */
export type Footprint = { readonly kind: "circle"; readonly r: number } | { readonly kind: "capsule"; readonly r: number; readonly half: number };

/** A model placed on the table: base centre, facing, cross section and height. */
export interface ModelHull {
  /** Base centre. `z` is the surface the model stands on — the table, a floor, a hill top. */
  readonly pos: Vec3;
  /** Radians counter-clockwise from +x. Irrelevant for circular bases. */
  readonly facing: number;
  readonly foot: Footprint;
  /** Feet to the highest point, in inches. An assumption unless the datasheet says otherwise. */
  readonly height: number;
}

/** Round base diameters used by the game, in millimetres. */
export const ROUND_BASES_MM = [25, 28.5, 32, 40, 50, 55, 60, 65, 80, 90, 100, 130, 160] as const;
/** Oval base sizes used by the game, `[length, width]` in millimetres. */
export const OVAL_BASES_MM = [
  [60, 35],
  [75, 42],
  [90, 52],
  [105, 70],
  [120, 92],
  [170, 105],
] as const;

export const circleBase = (diameterMm: number): Footprint => ({ kind: "circle", r: inches(diameterMm) / 2 });

export function ovalBase(lengthMm: number, widthMm: number): Footprint {
  const r = inches(widthMm) / 2;
  return { kind: "capsule", r, half: Math.max(0, inches(lengthMm) / 2 - r) };
}

/**
 * Default model heights by keyword, in inches — a stand-in for a fact the datasheet does not carry.
 *
 * These are *assumptions* and the UI must say so wherever a height changes an answer. Overriding
 * them per datasheet or per model works like every other override in the project.
 */
export const DEFAULT_HEIGHTS_IN: Readonly<Record<string, number>> = {
  INFANTRY: 2,
  CHARACTER: 2.5,
  SWARM: 1,
  BEAST: 2,
  CAVALRY: 3,
  BIKE: 2,
  MOUNTED: 3,
  WALKER: 4,
  MONSTER: 4,
  VEHICLE: 3.5,
  AIRCRAFT: 5,
  TITANIC: 7,
  FORTIFICATION: 6,
};

/** Height fallback when nothing at all is known: a standing infantry model. */
export const FALLBACK_HEIGHT_IN = 2;

/** The tallest default among a model's keywords — TITANIC beats INFANTRY when both are present. */
export function heightForKeywords(keywords: readonly string[]): number {
  let best = 0;
  for (const k of keywords) best = Math.max(best, DEFAULT_HEIGHTS_IN[k.toUpperCase()] ?? 0);
  return best || FALLBACK_HEIGHT_IN;
}

/* ---- derived geometry ------------------------------------------------------------------------ */

export const footRadius = (f: Footprint): number => f.r;

/** Longest half-extent of the cross section: the radius of the smallest enclosing circle. */
export const footReach = (f: Footprint): number => (f.kind === "circle" ? f.r : f.r + f.half);

/**
 * The core segment of a hull's cross section in table coordinates. A circle's core is the degenerate
 * segment at its centre, so callers only ever handle one case.
 */
export function coreSegment(h: ModelHull): Seg2 {
  if (h.foot.kind === "circle") {
    const p = { x: h.pos.x, y: h.pos.y };
    return { a: p, b: p };
  }
  const d = scale2(dir2(h.facing), h.foot.half);
  const c = { x: h.pos.x, y: h.pos.y };
  return { a: sub2(c, d), b: add2(c, d) };
}

/** Top of the model in absolute table height. */
export const topZ = (h: ModelHull): number => h.pos.z + h.height;

export function hullBounds(h: ModelHull): Aabb2 {
  const s = coreSegment(h);
  return expand(bounds([s.a, s.b]), h.foot.r);
}

/**
 * The silhouette of a hull as seen from `viewer`: the near point and the two tangent points where
 * the cross section's outline turns away.
 *
 * These three lateral positions are what decide whether a model can be seen past a corner — the
 * extremes of the shape do the work, so sampling them beats sampling the whole rim.
 */
export function silhouettePoints(h: ModelHull, viewer: Vec2): Vec2[] {
  const core = coreSegment(h);
  const centre = { x: h.pos.x, y: h.pos.y };
  const away = sub2(centre, viewer);
  const dLen = Math.hypot(away.x, away.y);
  // Viewer on top of the model: any lateral offset is as good as another.
  const toward = dLen < EPS ? { x: 1, y: 0 } : { x: away.x / dLen, y: away.y / dLen };
  const side = perp2(toward);

  const near = nearestOnCore(core, viewer);
  const out: Vec2[] = [add2(near, scale2(toward, -h.foot.r)), centre];
  for (const sign of [1, -1]) {
    const anchor = h.foot.kind === "circle" ? centre : farthestAlong(core, scale2(side, sign));
    out.push(add2(anchor, scale2(side, sign * h.foot.r)));
  }
  return out;
}

function nearestOnCore(core: Seg2, p: Vec2): Vec2 {
  const dx = core.b.x - core.a.x;
  const dy = core.b.y - core.a.y;
  const dd = dx * dx + dy * dy;
  if (dd < EPS) return core.a;
  const t = Math.max(0, Math.min(1, ((p.x - core.a.x) * dx + (p.y - core.a.y) * dy) / dd));
  return { x: core.a.x + dx * t, y: core.a.y + dy * t };
}

function farthestAlong(core: Seg2, d: Vec2): Vec2 {
  return core.a.x * d.x + core.a.y * d.y >= core.b.x * d.x + core.b.y * d.y ? core.a : core.b;
}
