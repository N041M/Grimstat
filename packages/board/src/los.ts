/**
 * Line of sight under the 11th edition terrain rules, and the cover that follows from it.
 *
 * The base rule is "if any part of a model can be seen from any part of the observer". Rays are
 * cast between sample points on the two hulls, and one clear ray is enough. What a ray may cross
 * depends on the terrain it meets, and the edition's terrain rules are the whole of it:
 *
 * - An **obscuring** terrain area blocks every line that crosses its footprint, at any height, so a
 *   low wall hides a tank and a model on an upper floor alike. The one exception is a model within
 *   the area: it sees out and is seen in, and two models within the same area see each other.
 * - A model is **within** an area when any part of its base is, so toeing in counts.
 * - A dense feature is **solid** below three inches. A line cannot pass through its walls at that
 *   height, which keeps a ground-floor model inside a ruin out of sight of the ground outside and
 *   stops it shooting out. Above three inches the walls are windows, so upper floors see out and
 *   are seen from above. A piece nobody can be inside is solid to its full height.
 * - Terrain that is not obscuring blocks only where its solid actually is, which is true line of
 *   sight: a crater rim hides nobody and an exposed bank hides a trooper but not a tank.
 *
 * The rays are kept, because a rendered ray explains a verdict where a boolean only asserts it.
 */

import type { ModelHull } from "./shapes";
import { coreSegment, footReach, silhouettePoints, topZ } from "./shapes";
import type { TerrainPiece , TerrainIndex} from "./terrain";
import { blocksSight, grantsCover, hasTrait, segmentHitsPrism, topOf } from "./terrain";
import { horizontalGap } from "./distance";
import type { Vec2, Vec3 } from "./vec";
import { EPS, bounds, expand, intervalGap, segInPolygonSpans, segPolygonDistance } from "./vec";

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
   * Apply the rule for a model within a terrain area: the area does not obscure that pair, and only
   * its solid walls below `SOLID_BAND` block. Set false to test raw geometry, where every solid is a
   * prism and nothing is exempt.
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

/**
 * How far up a dense feature's walls are solid, in inches. Below it a line of sight cannot pass
 * through the walls even at a door or a window. Above it the walls are windows.
 */
export const SOLID_BAND = 3;

/** Does this piece make its terrain area obscuring? Any light or dense feature does, unless it is transparent. */
export const obscures = (p: TerrainPiece): boolean => hasTrait(p, "obscuring") && !hasTrait(p, "transparent");

/**
 * The height to which a piece's walls are solid to a line of sight. A piece models can be inside
 * has windows above the band. A piece nobody can be inside, a bunker or a container, is solid to
 * its top.
 */
export const solidTo = (p: TerrainPiece): number => (hasTrait(p, "breachable") ? p.base + Math.min(p.height, SOLID_BAND) : topOf(p));

/** Is any part of the model's base within the piece's footprint? Toeing in counts, on any floor. */
export const baseWithin = (p: TerrainPiece, h: ModelHull): boolean => segPolygonDistance(coreSegment(h), p.polygon) <= h.foot.r + EPS;

/** Is the model within an obscuring terrain area? The geometry of the Hidden rule; keywords and shooting are the caller's. */
export const withinObscuringArea = (h: ModelHull, index: TerrainIndex): boolean => index.near({ x: h.pos.x, y: h.pos.y }, footReach(h.foot), obscures).some((p) => baseWithin(p, h));

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
 * A unit is hidden when no enemy model within `range` can see any of its models. This is the shape
 * of the Hidden rule, whose detection range is normally 15", and of Lone Operative. The range is
 * the caller's, since it comes from the rules rather than from geometry, and so are the other
 * conditions of Hidden: the model's keywords, whether it is within an obscuring area (see
 * `withinObscuringArea`) and whether its unit shot this turn or last.
 */
export function hiddenFrom(unit: readonly ModelHull[], enemies: readonly ModelHull[], index: TerrainIndex, range: number, opts?: SightOptions): boolean {
  for (const enemy of enemies) {
    for (const model of unit) {
      // Base to base, the way the range is measured on the table. An oval base reaches further from
      // its centre than its radius, so measuring it as a circle skips an enemy that is genuinely
      // within range and reports the unit hidden.
      if (horizontalGap(enemy, model) > range) continue;
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
 *
 * Both models are measured as their bases. A model is within a footprint when any part of its base
 * is, which is what the rules ask and what a player reads off the table — a trooper with most of his
 * base in a crater is in the crater however his centre point falls.
 *
 * The footprint rule is a question about the table plane, but the piece still has to be at a height
 * where it matters. A model on a gantry twelve inches above a crater is not standing in the crater,
 * and a crater half an inch tall does not come between him and anyone shooting at him.
 */
export function coverFor(target: ModelHull, attacker: ModelHull, index: TerrainIndex): CoverResult {
  const here: Vec2 = { x: target.pos.x, y: target.pos.y };
  const there: Vec2 = { x: attacker.pos.x, y: attacker.pos.y };
  const mark = coreSegment(target);
  const eye = coreSegment(attacker);
  // Room for either base to overhang the line between the centres, so the broad phase keeps a piece
  // the target is standing half in.
  const region = expand(bounds([here, there]), Math.max(footReach(target.foot), footReach(attacker.foot)));

  let best: CoverResult = { level: "none", reason: "none" };
  const better = (a: CoverLevel, b: CoverLevel): boolean => (a === "heavy" && b !== "heavy") || (a === "light" && b === "none");

  for (const piece of index.candidates(region, grantsCover)) {
    const level: CoverLevel = hasTrait(piece, "heavy-cover") ? "heavy" : "light";
    if (!better(level, best.level)) continue;
    if (standsIn(piece, target) && segPolygonDistance(mark, piece.polygon) <= target.foot.r) {
      best = { level, from: piece.id, reason: "within" };
      continue;
    }
    if (standsIn(piece, attacker) && segPolygonDistance(eye, piece.polygon) <= attacker.foot.r) continue; // the attacker is inside it, so it is not in the way
    const spans = segInPolygonSpans({ a: there, b: here }, piece.polygon);
    if (spans.some(([t0, t1]) => t1 - t0 > EPS && risesIntoView(piece, attacker, target, t0, t1))) best = { level, from: piece.id, reason: "intervening" };
  }
  return best;
}

/**
 * Is the model at a height where the piece is around it? A model standing on the piece counts, and
 * so does one on a floor inside it.
 */
function standsIn(piece: TerrainPiece, h: ModelHull): boolean {
  return intervalGap(h.pos.z, topZ(h), piece.base, topOf(piece)) <= EPS;
}

/**
 * Does the piece rise into the space the sight lines run through, over the stretch of the line that
 * crosses its footprint?
 *
 * The lines between the two models fill a band. The lowest of them runs from one model's feet to the
 * other's, and the highest from one model's top to the other's. Both are straight, so the two ends of
 * the crossed stretch settle the whole of it.
 */
function risesIntoView(piece: TerrainPiece, attacker: ModelHull, target: ModelHull, t0: number, t1: number): boolean {
  const feet = (t: number): number => attacker.pos.z + (target.pos.z - attacker.pos.z) * t;
  const head = (t: number): number => topZ(attacker) + (topZ(target) - topZ(attacker)) * t;
  return piece.base <= Math.max(head(t0), head(t1)) + EPS && topOf(piece) >= Math.min(feet(t0), feet(t1)) - EPS;
}

/* ---- internals -------------------------------------------------------------------------------- */

/**
 * How a piece stands between a pair of models.
 *
 * `area`: an obscuring area neither model is within, which blocks any line crossing its footprint.
 * `walls`: an obscuring piece one of them is within, whose walls block up to `solidTo`.
 * `solid`: terrain that is not obscuring, which blocks only where its prism is.
 */
interface Blocker {
  readonly piece: TerrainPiece;
  readonly mode: "area" | "walls" | "solid";
}

function candidateBlockers(from: ModelHull, to: ModelHull, index: TerrainIndex, opts: SightOptions): Blocker[] {
  const selfExempt = opts.selfExempt ?? true;
  const here: Vec2 = { x: from.pos.x, y: from.pos.y };
  const there: Vec2 = { x: to.pos.x, y: to.pos.y };
  // The rays run out to the silhouettes, which reach `footReach` from a capsule's centre rather than
  // its radius. Sizing the box by the radius drops pieces the rays really do cross.
  const region = expand(bounds([here, there]), Math.max(footReach(from.foot), footReach(to.foot)));
  const ceiling = Math.max(topZ(from), topZ(to));
  const floor = Math.min(from.pos.z, to.pos.z);

  const out: Blocker[] = [];
  for (const p of index.candidates(region)) {
    if (opts.ignore?.(p)) continue;
    if (selfExempt && obscures(p)) {
      // An obscuring area blocks at any height, so no height test applies to it.
      out.push({ piece: p, mode: baseWithin(p, from) || baseWithin(p, to) ? "walls" : "area" });
      continue;
    }
    if (!blocksSight(p)) continue;
    // A solid that starts above both models' heads, or ends below both their feet, is never between
    // them: every ray runs inside the two height spans.
    if (p.base > ceiling + EPS || topOf(p) < floor - EPS) continue;
    // A model standing on a piece, or in a crater, is not blocked by the ground under its own feet.
    if (selfExempt && (baseWithin(p, from) || baseWithin(p, to))) continue;
    out.push({ piece: p, mode: "solid" });
  }
  return out;
}

function firstBlocker(from: Vec3, to: Vec3, blockers: readonly Blocker[]): TerrainPiece | undefined {
  for (const { piece, mode } of blockers) {
    if (mode === "solid" ? segmentHitsPrism(from, to, piece) : mode === "area" ? crossesFootprint(from, to, piece) : crossesWalls(from, to, piece)) return piece;
  }
  return undefined;
}

/** Does the line cross the piece's footprint at all? Height plays no part. */
function crossesFootprint(from: Vec3, to: Vec3, p: TerrainPiece): boolean {
  return segInPolygonSpans({ a: { x: from.x, y: from.y }, b: { x: to.x, y: to.y } }, p.polygon).some(([t0, t1]) => t1 - t0 > EPS);
}

/**
 * Does the line pass through the piece's walls where they are solid?
 *
 * The walls are the footprint's edges. Where the line enters or leaves the footprint it crosses a
 * wall, at a height read off the line there. A crossing between the piece's base and `solidTo`
 * blocks; one above it is through a window. A line that starts inside and stays inside crosses
 * nothing.
 */
function crossesWalls(from: Vec3, to: Vec3, p: TerrainPiece): boolean {
  const top = solidTo(p);
  const heightAt = (t: number): number => from.z + (to.z - from.z) * t;
  for (const [t0, t1] of segInPolygonSpans({ a: { x: from.x, y: from.y }, b: { x: to.x, y: to.y } }, p.polygon)) {
    if (t1 - t0 <= EPS) continue;
    for (const t of [t0, t1]) {
      if (t <= EPS || t >= 1 - EPS) continue;
      const z = heightAt(t);
      if (z >= p.base - EPS && z <= top + EPS) return true;
    }
  }
  return false;
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
