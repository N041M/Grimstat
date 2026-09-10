/**
 * Measurement.
 *
 * Every distance in the game is "the shortest distance between the two closest points of the two
 * models" — a tape held taut, which in three dimensions is the hypotenuse of the horizontal gap and
 * the vertical gap. A model three inches up and four across is five inches away, and the rules that
 * split the two (engagement range: one inch across, five up) get to ask for them separately.
 */

import type { ModelHull } from "./shapes";
import { coreSegment, topZ } from "./shapes";
import type { Vec2, Vec3 } from "./vec";
import { intervalGap, segSegDistance } from "./vec";

/** Horizontal gap between two hulls' cross sections; 0 when the bases touch or overlap. */
export function horizontalGap(a: ModelHull, b: ModelHull): number {
  return Math.max(0, segSegDistance(coreSegment(a), coreSegment(b)) - a.foot.r - b.foot.r);
}

/** Vertical gap between two hulls' height spans; 0 when they overlap at any height. */
export function verticalGap(a: ModelHull, b: ModelHull): number {
  return intervalGap(a.pos.z, topZ(a), b.pos.z, topZ(b));
}

/** True shortest distance between two models, in inches. */
export function distance(a: ModelHull, b: ModelHull): number {
  return Math.hypot(horizontalGap(a, b), verticalGap(a, b));
}

export const within = (a: ModelHull, b: ModelHull, inches: number): boolean => distance(a, b) <= inches;

/** Shortest distance from a hull to a point in space. */
export function distanceToPoint(h: ModelHull, p: Vec3): number {
  const flat: Vec2 = { x: p.x, y: p.y };
  const hGap = Math.max(0, segSegDistance(coreSegment(h), { a: flat, b: flat }) - h.foot.r);
  return Math.hypot(hGap, intervalGap(h.pos.z, topZ(h), p.z, p.z));
}

/**
 * Engagement range: within 1" horizontally **and** 5" vertically. The split test is why the kernel
 * keeps the two gaps rather than only their hypotenuse.
 */
export const ENGAGEMENT_HORIZONTAL = 1;
export const ENGAGEMENT_VERTICAL = 5;

export function inEngagementRange(a: ModelHull, b: ModelHull): boolean {
  return horizontalGap(a, b) <= ENGAGEMENT_HORIZONTAL && verticalGap(a, b) <= ENGAGEMENT_VERTICAL;
}

/* ---- unit-level measurement ------------------------------------------------------------------ */

/** Closest approach between two groups of models. `Infinity` when either side is empty. */
export function unitDistance(a: readonly ModelHull[], b: readonly ModelHull[]): number {
  let best = Infinity;
  for (const x of a) for (const y of b) best = Math.min(best, distance(x, y));
  return best;
}

export function unitsEngaged(a: readonly ModelHull[], b: readonly ModelHull[]): boolean {
  for (const x of a) for (const y of b) if (inEngagementRange(x, y)) return true;
  return false;
}

/* ---- coherency ------------------------------------------------------------------------------- */

/** Coherency distance, and the size at which a unit needs two neighbours rather than one. */
export const COHERENCY_RANGE = 2;
export const COHERENCY_TWO_AT = 6;

export interface CoherencyReport {
  readonly ok: boolean;
  /** Models with too few neighbours within range. */
  readonly lonely: readonly number[];
  /** True when the unit splits into more than one connected group. */
  readonly split: boolean;
  /** Neighbours required per model for this unit size. */
  readonly required: number;
}

/**
 * Unit coherency: every model within 2" of another (two others once the unit is 6+ strong), and the
 * unit in one connected group. The two conditions are distinct — a unit can satisfy the neighbour
 * count in two separate huddles — so both are reported.
 */
export function coherency(models: readonly ModelHull[]): CoherencyReport {
  const n = models.length;
  const required = n >= COHERENCY_TWO_AT ? 2 : 1;
  if (n <= 1) return { ok: true, lonely: [], split: false, required };

  const adjacency: number[][] = models.map(() => []);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (distance(models[i]!, models[j]!) <= COHERENCY_RANGE) {
        adjacency[i]!.push(j);
        adjacency[j]!.push(i);
      }
    }
  }

  const lonely: number[] = [];
  for (let i = 0; i < n; i++) if (adjacency[i]!.length < Math.min(required, n - 1)) lonely.push(i);

  const seen = new Set<number>([0]);
  const queue = [0];
  while (queue.length) {
    for (const next of adjacency[queue.pop()!]!) {
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  const split = seen.size < n;

  return { ok: lonely.length === 0 && !split, lonely, split, required };
}
