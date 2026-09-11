/**
 * True line of sight, and the cover that follows from it.
 *
 * The rule is "if a model can see any part of the target". In three dimensions that is a real
 * question with a real answer: cast rays between the two solids and ask whether any of them clears
 * the terrain. No height classes, no look-up table of exceptions — a Rhino sees over a wall a
 * Guardsman cannot because it is taller, and that is the whole of it.
 *
 * The rays are kept, because a rendered ray *explains* a verdict where a boolean only asserts it.
 */

import type { ModelHull } from "./shapes";
import { silhouettePoints, topZ } from "./shapes";
import type { TerrainPiece , TerrainIndex} from "./terrain";
import { blocksSight, containsPoint, grantsCover, hasTrait, segmentHitsPrism, topOf } from "./terrain";
import type { Vec2, Vec3 } from "./vec";
import { EPS, bounds, expand, segInPolygonSpans } from "./vec";

export interface SightRay {
  readonly from: Vec3;
  readonly to: Vec3;
  /** Id of the first piece found to block it, or undefined when the ray is clear. */
  readonly blockedBy?: string;
}

export interface SightOptions {
  /**
   * Fractions of each model's height to sample, tried in the given order. The default samples the
   * top, the middle and the feet — the top first, because it is the part most likely to be seen.
   */
  readonly heights?: readonly number[];
  /** Test every candidate ray instead of stopping at the first clear one. Needed for `exposure`. */
  readonly exhaustive?: boolean;
  /** Hard cap on rays tested, as a guard for pathological sample sets. */
  readonly maxRays?: number;
  /**
   * Pieces containing either model do not block that pair — a model inside a ruin can see out of it,
   * and a model standing on a roof is not blocked by the building under its feet. Set false to test
   * raw geometry.
   */
  readonly selfExempt?: boolean;
  /** Additional pieces to ignore, by id. */
  readonly ignore?: (piece: TerrainPiece) => boolean;
}

export interface SightResult {
  readonly visible: boolean;
  readonly tested: number;
  readonly clear: number;
  /**
   * Share of tested rays that were clear, from 0 (hidden) to 1 (fully exposed). Only meaningful
   * with `exhaustive`, since otherwise testing stops at the first success.
   */
  readonly exposure: number;
  /** Ids of pieces that blocked at least one ray, most frequent first. */
  readonly blockers: readonly string[];
  readonly rays: readonly SightRay[];
}

/** Top, middle, feet: enough to settle almost every real table position. */
export const HEIGHT_SAMPLES = [1, 0.5, 0] as const;
/** A denser set for close calls and for the AI's exposure term. */
export const HEIGHT_SAMPLES_FINE = [1, 0.75, 0.5, 0.25, 0] as const;

/**
 * Points on a hull to sight from or to: the silhouette as seen from `viewer` (near point, centre and
 * the two tangents) at each sampled height. The extremes of the shape decide whether a model is seen
 * past a corner, so sampling them beats sampling the whole rim.
 */
export function sightPoints(h: ModelHull, viewer: Vec2, heights: readonly number[]): Vec3[] {
  const lateral = silhouettePoints(h, viewer);
  const out: Vec3[] = [];
  for (const f of heights) {
    const z = h.pos.z + h.height * f;
    for (const p of lateral) out.push({ x: p.x, y: p.y, z });
  }
  return out;
}

/**
 * Can `from` see `to`?
 *
 * Stops at the first clear ray unless `exhaustive` is set, so the common case — an unobstructed
 * firing lane — costs a single segment test against a handful of broad-phased pieces.
 */
export function sight(from: ModelHull, to: ModelHull, index: TerrainIndex, opts: SightOptions = {}): SightResult {
  const heights = opts.heights ?? HEIGHT_SAMPLES;
  const exhaustive = opts.exhaustive ?? false;
  const maxRays = opts.maxRays ?? 400;

  const eyes = sightPoints(from, { x: to.pos.x, y: to.pos.y }, heights);
  const marks = sightPoints(to, { x: from.pos.x, y: from.pos.y }, heights);
  const blockers = candidateBlockers(from, to, index, opts);

  const rays: SightRay[] = [];
  const hits = new Map<string, number>();
  let clear = 0;
  let tested = 0;

  for (const eye of eyes) {
    for (const mark of marks) {
      if (tested >= maxRays) break;
      tested++;
      const hit = firstBlocker(eye, mark, blockers);
      if (hit) {
        hits.set(hit.id, (hits.get(hit.id) ?? 0) + 1);
        rays.push({ from: eye, to: mark, blockedBy: hit.id });
      } else {
        clear++;
        rays.push({ from: eye, to: mark });
        if (!exhaustive) return done(true, tested, clear, hits, rays, exhaustive);
      }
    }
    if (tested >= maxRays) break;
  }

  return done(clear > 0, tested, clear, hits, rays, exhaustive);
}

/** `sight` reduced to a boolean, for the many callers that only need the verdict. */
export const canSee = (from: ModelHull, to: ModelHull, index: TerrainIndex, opts?: SightOptions): boolean => sight(from, to, index, opts).visible;

/** Does any model of `from` see any model of `to`? Unit-level visibility for target selection. */
export function unitSight(from: readonly ModelHull[], to: readonly ModelHull[], index: TerrainIndex, opts?: SightOptions): boolean {
  for (const eye of from) for (const mark of to) if (canSee(eye, mark, index, opts)) return true;
  return false;
}

/**
 * The share of `to`'s models that any model of `from` can see — the AI's exposure term, and the
 * honest way to describe a unit that is half behind a ruin.
 */
export function visibleFraction(from: readonly ModelHull[], to: readonly ModelHull[], index: TerrainIndex, opts?: SightOptions): number {
  if (to.length === 0) return 0;
  let seen = 0;
  for (const mark of to) {
    for (const eye of from) {
      if (canSee(eye, mark, index, opts)) {
        seen++;
        break;
      }
    }
  }
  return seen / to.length;
}

/**
 * A unit is hidden when no enemy model within `range` can see any of its models — the shape of the
 * 11e HIDDEN rule and of Lone Operative, with the range left to the caller because it comes from
 * the rules rather than from geometry.
 */
export function hiddenFrom(unit: readonly ModelHull[], enemies: readonly ModelHull[], index: TerrainIndex, range: number, opts?: SightOptions): boolean {
  for (const enemy of enemies) {
    for (const model of unit) {
      if (Math.hypot(enemy.pos.x - model.pos.x, enemy.pos.y - model.pos.y) > range + model.foot.r + enemy.foot.r) continue;
      if (canSee(enemy, model, index, opts)) return false;
    }
  }
  return true;
}

/* ---- cover ------------------------------------------------------------------------------------ */

export type CoverLevel = "none" | "light" | "heavy";

export interface CoverResult {
  readonly level: CoverLevel;
  /** Id of the piece granting it. */
  readonly from?: string;
  readonly reason: "none" | "within" | "intervening";
}

/**
 * Benefit of cover for `target` against `attacker`.
 *
 * Two ways to have it, in the order the rules check them: the target is within a cover-granting
 * footprint, or such a footprint lies between the two models. A piece the attacker is also standing
 * in intervenes in nothing.
 */
export function coverFor(target: ModelHull, attacker: ModelHull, index: TerrainIndex): CoverResult {
  const here: Vec2 = { x: target.pos.x, y: target.pos.y };
  const there: Vec2 = { x: attacker.pos.x, y: attacker.pos.y };

  let best: CoverResult = { level: "none", reason: "none" };
  const better = (a: CoverLevel, b: CoverLevel): boolean => (a === "heavy" && b !== "heavy") || (a === "light" && b === "none");

  for (const piece of index.candidates(expand(bounds([here, there]), 0), grantsCover)) {
    const level: CoverLevel = hasTrait(piece, "heavy-cover") ? "heavy" : "light";
    if (!better(level, best.level)) continue;
    if (containsPoint(piece, here)) {
      best = { level, from: piece.id, reason: "within" };
      continue;
    }
    if (containsPoint(piece, there)) continue; // the attacker is inside it; it is not in the way
    const spans = segInPolygonSpans({ a: there, b: here }, piece.polygon);
    if (spans.some(([t0, t1]) => t1 - t0 > EPS)) best = { level, from: piece.id, reason: "intervening" };
  }
  return best;
}

/* ---- internals -------------------------------------------------------------------------------- */

function candidateBlockers(from: ModelHull, to: ModelHull, index: TerrainIndex, opts: SightOptions): TerrainPiece[] {
  const selfExempt = opts.selfExempt ?? true;
  const here: Vec2 = { x: from.pos.x, y: from.pos.y };
  const there: Vec2 = { x: to.pos.x, y: to.pos.y };
  const region = expand(bounds([here, there]), Math.max(from.foot.r, to.foot.r));
  const ceiling = Math.max(topZ(from), topZ(to));
  const floor = Math.min(from.pos.z, to.pos.z);

  return index.candidates(region, (p) => {
    if (!blocksSight(p)) return false;
    // A solid that starts above both models' heads, or ends below both their feet, is never between
    // them: every ray runs inside the two height spans.
    if (p.base > ceiling + EPS || topOf(p) < floor - EPS) return false;
    if (opts.ignore?.(p)) return false;
    if (selfExempt && (containsPoint(p, here) || containsPoint(p, there))) return false;
    return true;
  });
}

function firstBlocker(from: Vec3, to: Vec3, pieces: readonly TerrainPiece[]): TerrainPiece | undefined {
  for (const p of pieces) if (segmentHitsPrism(from, to, p)) return p;
  return undefined;
}

function done(visible: boolean, tested: number, clear: number, hits: Map<string, number>, rays: SightRay[], exhaustive: boolean): SightResult {
  return {
    visible,
    tested,
    clear,
    exposure: exhaustive && tested > 0 ? clear / tested : visible ? 1 : 0,
    blockers: [...hits.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id),
    rays,
  };
}
