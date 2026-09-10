/**
 * Geometry primitives for the battle board, in **inches**.
 *
 * The table is the `xy` plane and `z` is up — wargamers measure across a table, so the table gets
 * the familiar two axes. The renderer is the only place that maps this to its own convention.
 *
 * Everything here is pure, allocation-light and free of any rules knowledge.
 */

export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

export interface Vec3 extends Vec2 {
  readonly z: number;
}

/** A line segment on the table plane. Degenerate (a === b) segments are legal and behave as points. */
export interface Seg2 {
  readonly a: Vec2;
  readonly b: Vec2;
}

/** Axis-aligned bounding box on the table plane. */
export interface Aabb2 {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

export const v2 = (x: number, y: number): Vec2 => ({ x, y });
export const v3 = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
export const flat = (p: Vec2): Vec2 => ({ x: p.x, y: p.y });

export const add2 = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
export const sub2 = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const scale2 = (a: Vec2, k: number): Vec2 => ({ x: a.x * k, y: a.y * k });
export const dot2 = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;
/** Z component of the 3D cross product: positive when b turns left of a. */
export const cross2 = (a: Vec2, b: Vec2): number => a.x * b.y - a.y * b.x;
export const len2 = (a: Vec2): number => Math.hypot(a.x, a.y);
export const dist2 = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);
export const lerp2 = (a: Vec2, b: Vec2, t: number): Vec2 => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

/** Unit vector, or `{x:1,y:0}` for a zero-length input so callers never see NaN. */
export function norm2(a: Vec2): Vec2 {
  const l = len2(a);
  return l < EPS ? { x: 1, y: 0 } : { x: a.x / l, y: a.y / l };
}

/** Rotate 90° counter-clockwise. */
export const perp2 = (a: Vec2): Vec2 => ({ x: -a.y, y: a.x });

/** Direction of a facing angle in radians, counter-clockwise from +x. */
export const dir2 = (angle: number): Vec2 => ({ x: Math.cos(angle), y: Math.sin(angle) });

/**
 * Tolerance for "touching". Bases are placed by hand on a real table and by float arithmetic here;
 * a thousandth of an inch is far below anything a tape measure resolves, and keeps
 * `distance(a, b) === 0` true for models that are flush against one another.
 */
export const EPS = 1e-9;
/** What counts as the same position for snapping and de-duplication: a hundredth of an inch. */
export const TOUCH = 1e-2;

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/* ---- point / segment ------------------------------------------------------------------------ */

/** Parameter along `s` of the point closest to `p`, clamped to the segment. */
export function closestT(s: Seg2, p: Vec2): number {
  const d = sub2(s.b, s.a);
  const dd = dot2(d, d);
  if (dd < EPS) return 0;
  return clamp(dot2(sub2(p, s.a), d) / dd, 0, 1);
}

export function closestPointOnSeg(s: Seg2, p: Vec2): Vec2 {
  return lerp2(s.a, s.b, closestT(s, p));
}

export function pointSegDistance(p: Vec2, s: Seg2): number {
  return dist2(p, closestPointOnSeg(s, p));
}

/** True when the two segments cross or touch. Collinear overlap counts as an intersection. */
export function segsIntersect(s: Seg2, t: Seg2): boolean {
  return segSegDistance(s, t) < EPS;
}

/** Signed area of the triangle abc, doubled: positive when c lies left of a→b. */
const orient = (a: Vec2, b: Vec2, c: Vec2): number => cross2(sub2(b, a), sub2(c, a));

/** Do the two segments cross at an interior point of both? Touching endpoints are not a crossing. */
function properlyCross(s: Seg2, t: Seg2): boolean {
  const d1 = orient(t.a, t.b, s.a);
  const d2 = orient(t.a, t.b, s.b);
  const d3 = orient(s.a, s.b, t.a);
  const d4 = orient(s.a, s.b, t.b);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

/**
 * Shortest distance between two segments on the plane — the workhorse behind base-to-base
 * measurement, since every base cross section reduces to a segment plus a radius.
 *
 * On the plane, two segments that do not cross have their closest approach at an endpoint of one of
 * them, so the answer is a crossing test and four point-to-segment distances. That formulation costs
 * a handful of extra multiplies over solving the quadratic, and buys exactness: it is symmetric by
 * construction and needs no tolerance on a near-parallel pair, where the quadratic's determinant is
 * a squared area and no length tolerance is the right one.
 */
export function segSegDistance(s: Seg2, t: Seg2): number {
  if (properlyCross(s, t)) return 0;
  return Math.min(pointSegDistance(s.a, t), pointSegDistance(s.b, t), pointSegDistance(t.a, s), pointSegDistance(t.b, s));
}

/** Gap between two closed intervals; 0 when they overlap or touch. */
export function intervalGap(aLo: number, aHi: number, bLo: number, bHi: number): number {
  if (aHi < bLo) return bLo - aHi;
  if (bHi < aLo) return aLo - bHi;
  return 0;
}

/* ---- polygons ------------------------------------------------------------------------------- */

export function bounds(points: readonly Vec2[]): Aabb2 {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

export const expand = (box: Aabb2, by: number): Aabb2 => ({ minX: box.minX - by, minY: box.minY - by, maxX: box.maxX + by, maxY: box.maxY + by });

export const boxesOverlap = (a: Aabb2, b: Aabb2): boolean => a.minX <= b.maxX && b.minX <= a.maxX && a.minY <= b.maxY && b.minY <= a.maxY;

export const inBox = (p: Vec2, box: Aabb2): boolean => p.x >= box.minX && p.x <= box.maxX && p.y >= box.minY && p.y <= box.maxY;

/** Iterate a polygon's edges as segments, closing the ring. */
export function* edges(poly: readonly Vec2[]): Generator<Seg2> {
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % n];
    if (a && b) yield { a, b };
  }
}

/** Signed area; positive when the ring winds counter-clockwise. */
export function signedArea(poly: readonly Vec2[]): number {
  let acc = 0;
  for (const e of edges(poly)) acc += cross2(e.a, e.b);
  return acc / 2;
}

/**
 * Even-odd containment test. Points exactly on an edge are reported as inside, which is what the
 * rules want: a base touching the edge of a terrain footprint is "within" it.
 */
export function pointInPolygon(p: Vec2, poly: readonly Vec2[]): boolean {
  if (poly.length < 3) return false;
  let inside = false;
  for (const e of edges(poly)) {
    if (pointSegDistance(p, e) < EPS) return true;
    const { a, b } = e;
    if (a.y > p.y !== b.y > p.y) {
      const t = (p.y - a.y) / (b.y - a.y);
      if (p.x < a.x + t * (b.x - a.x)) inside = !inside;
    }
  }
  return inside;
}

/** Distance from a point to a polygon's boundary; 0 when the point is inside. */
export function pointPolygonDistance(p: Vec2, poly: readonly Vec2[]): number {
  if (pointInPolygon(p, poly)) return 0;
  let best = Infinity;
  for (const e of edges(poly)) best = Math.min(best, pointSegDistance(p, e));
  return best;
}

/** Distance from a segment to a polygon; 0 when they touch or the segment is inside. */
export function segPolygonDistance(s: Seg2, poly: readonly Vec2[]): number {
  let best = Infinity;
  for (const e of edges(poly)) best = Math.min(best, segSegDistance(s, e));
  if (best < EPS) return 0;
  return pointInPolygon(s.a, poly) ? 0 : best;
}

/**
 * The parameter intervals of `s` that lie inside `poly`, as `[t0, t1]` pairs in ascending order.
 *
 * Works for concave rings: collect every edge crossing, then classify each span between consecutive
 * crossings by testing its midpoint. This is what turns a 3D ray-versus-prism question into a
 * one-dimensional interval intersection.
 */
export function segInPolygonSpans(s: Seg2, poly: readonly Vec2[]): [number, number][] {
  const d = sub2(s.b, s.a);
  const dd = dot2(d, d);
  if (dd < EPS) return pointInPolygon(s.a, poly) ? [[0, 1]] : [];

  const cuts: number[] = [0, 1];
  for (const e of edges(poly)) {
    const ed = sub2(e.b, e.a);
    const den = cross2(d, ed);
    if (Math.abs(den) < EPS) continue; // parallel: the midpoint tests below cover collinear overlap
    const w = sub2(e.a, s.a);
    const t = cross2(w, ed) / den;
    const u = cross2(w, d) / den;
    if (t > 0 && t < 1 && u >= 0 && u <= 1) cuts.push(t);
  }
  cuts.sort((m, n) => m - n);

  const spans: [number, number][] = [];
  for (let i = 0; i + 1 < cuts.length; i++) {
    const t0 = cuts[i]!;
    const t1 = cuts[i + 1]!;
    if (t1 - t0 < EPS) continue;
    if (!pointInPolygon(lerp2(s.a, s.b, (t0 + t1) / 2), poly)) continue;
    const last = spans[spans.length - 1];
    if (last && t0 - last[1] < EPS) last[1] = t1; // merge spans that meet at a vertex
    else spans.push([t0, t1]);
  }
  return spans;
}
