/**
 * Terrain as extruded polygons.
 *
 * A piece is a footprint polygon swept from `base` to `base + height`, plus trait flags and any
 * number of *floors* — horizontal surfaces at given heights that models can stand on. A ruin is one
 * prism with floors and breachable walls; a crater is a prism half an inch tall that grants cover; a
 * bastion is an impassable prism with a floor on its roof.
 *
 * Traits are data. Nothing in this module knows an edition's rules text; the game-system plugin maps
 * a layout's terrain to these flags, and every query below takes the flags at face value.
 */

import type { Aabb2, Vec2, Vec3 } from "./vec";
import { EPS, bounds, boxesOverlap, expand, pointInPolygon, segInPolygonSpans, segPolygonDistance, signedArea } from "./vec";

export type TerrainTrait =
  /** Blocks line of sight through the solid (ruins, dense woods, hills). */
  | "obscuring"
  /** Grants the benefit of cover. */
  | "light-cover"
  | "heavy-cover"
  /** Cannot be moved through or onto, except by the keywords in `passableBy`. */
  | "impassable"
  /** Costs extra to move through. */
  | "difficult"
  /**
   * The footprint is walls: only the keywords in `passableBy` may cross them or be inside (ruins).
   * Everyone else goes round — but, unlike `impassable`, those who may pass may also stand inside.
   */
  | "breachable"
  /** May be climbed to reach a floor. */
  | "scalable"
  /** Models wholly within gain a defensive benefit the plugin defines. */
  | "defensible"
  /** Present on the table but ignored by line of sight (area markers, low scatter). */
  | "transparent";

export interface TerrainPiece {
  readonly id: string;
  /** Footprint ring on the table plane, in inches. Winding is normalised on construction. */
  readonly polygon: readonly Vec2[];
  /** Elevation of the footprint. Usually 0; a gantry over a walkway is not. */
  readonly base: number;
  /** Height above `base`. Zero means a flat marker with a footprint but no solid. */
  readonly height: number;
  readonly traits: readonly TerrainTrait[];
  /** Walkable surface heights **relative to `base`**, ascending. `[0]` is the ground inside it. */
  readonly floors: readonly number[];
  /** Keywords allowed through the walls of an `impassable` or `breachable` piece. Empty means nobody. */
  readonly passableBy: readonly string[];
  /**
   * Keywords allowed onto this piece's upper floors. Empty means anyone who can reach them.
   *
   * This is what keeps a tank off the first floor of a ruin. It is a keyword list rather than a
   * hard-coded rule because which keywords may climb is an edition's business, not geometry's.
   */
  readonly climbableBy: readonly string[];
}

export type TerrainInput = Omit<TerrainPiece, "floors" | "passableBy" | "climbableBy" | "base" | "traits"> &
  Partial<Pick<TerrainPiece, "floors" | "passableBy" | "climbableBy" | "base" | "traits">>;

/** Normalise a piece: counter-clockwise ring, sorted floors, defaults filled in. */
export function terrain(input: TerrainInput): TerrainPiece {
  const polygon = signedArea(input.polygon) < 0 ? [...input.polygon].reverse() : [...input.polygon];
  return {
    id: input.id,
    polygon,
    base: input.base ?? 0,
    height: Math.max(0, input.height),
    traits: input.traits ?? [],
    floors: [...(input.floors ?? [])].sort((a, b) => a - b),
    passableBy: input.passableBy ?? [],
    climbableBy: input.climbableBy ?? [],
  };
}

export const hasTrait = (p: TerrainPiece, t: TerrainTrait): boolean => p.traits.includes(t);

/** The absolute height span of the solid. */
export const topOf = (p: TerrainPiece): number => p.base + p.height;

/** Does this piece stop a sight line? Any solid does, unless it is explicitly transparent. */
export const blocksSight = (p: TerrainPiece): boolean => p.height > EPS && !hasTrait(p, "transparent");

export const grantsCover = (p: TerrainPiece): boolean => hasTrait(p, "light-cover") || hasTrait(p, "heavy-cover");

/** Absolute heights of the surfaces a model could stand on, lowest first. */
export const floorHeights = (p: TerrainPiece): number[] => p.floors.map((f) => p.base + f);

/**
 * May a model with these keywords stand on this piece's upper floors?
 *
 * An empty `climbableBy` means anyone who can physically get up there. A non-empty one is how a
 * layout keeps tanks off the first floor of a ruin — a rules question, so it lives in the data.
 */
export function mayClimb(p: TerrainPiece, keywords: Iterable<string>): boolean {
  if (p.climbableBy.length === 0) return true;
  // Both sides are normalised. Upper-casing only the piece's keyword would make the caller's set
  // quietly case-sensitive, and a caller that passes "Infantry" would be refused for no visible reason.
  const have = new Set<string>();
  for (const k of keywords) have.add(k.toUpperCase());
  return p.climbableBy.some((k) => have.has(k.toUpperCase()));
}

export const containsPoint = (p: TerrainPiece, at: Vec2): boolean => pointInPolygon(at, p.polygon);

/**
 * A broad-phase index over the pieces.
 *
 * Each piece's bounding box is filed in a uniform grid of square cells, so a query reads the few
 * cells its region covers rather than every piece on the table. The cell is sized so that a cell
 * holds about one piece on average. Every query answers in the order the pieces are listed, which
 * callers rely on: line of sight names the first piece that blocks a ray.
 */
export class TerrainIndex {
  readonly pieces: readonly TerrainPiece[];
  private readonly boxes: Aabb2[];
  /** The grid's origin, cell size and width in cells. */
  private readonly gx: number;
  private readonly gy: number;
  private readonly cell: number;
  private readonly cols: number;
  private readonly rows: number;
  /** Piece indices per cell, ascending. */
  private readonly grid: number[][];
  /** Per-query marks, so a piece filed in several cells is reported once. */
  private readonly seen: Uint32Array;
  private stamp = 0;

  constructor(pieces: readonly TerrainPiece[]) {
    this.pieces = pieces;
    this.boxes = pieces.map((p) => bounds(p.polygon));
    this.seen = new Uint32Array(pieces.length);
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const b of this.boxes) {
      if (!(b.minX <= b.maxX && b.minY <= b.maxY)) continue;
      minX = Math.min(minX, b.minX);
      minY = Math.min(minY, b.minY);
      maxX = Math.max(maxX, b.maxX);
      maxY = Math.max(maxY, b.maxY);
    }
    if (!Number.isFinite(minX) || !Number.isFinite(maxX) || !Number.isFinite(minY) || !Number.isFinite(maxY)) {
      this.gx = this.gy = 0;
      this.cell = 1;
      this.cols = this.rows = 0;
      this.grid = [];
      return;
    }
    const w = Math.max(maxX - minX, EPS);
    const h = Math.max(maxY - minY, EPS);
    // About one piece per cell, with no more than 2^16 cells whatever the pieces are.
    const cell = Math.max(Math.sqrt((w * h) / Math.max(1, pieces.length)), Math.sqrt((w * h) / 65536), 1e-3);
    this.gx = minX;
    this.gy = minY;
    this.cell = cell;
    this.cols = Math.max(1, Math.ceil(w / cell));
    this.rows = Math.max(1, Math.ceil(h / cell));
    this.grid = Array.from({ length: this.cols * this.rows }, () => []);
    this.boxes.forEach((b, i) => {
      if (!(b.minX <= b.maxX && b.minY <= b.maxY)) return;
      const [c0, c1, r0, r1] = this.span(b);
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) this.grid[r * this.cols + c]!.push(i);
    });
  }

  box(i: number): Aabb2 {
    return this.boxes[i] ?? { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  }

  /** The cells a box covers, clamped to the grid, as `[firstCol, lastCol, firstRow, lastRow]`. */
  private span(b: Aabb2): [number, number, number, number] {
    return [this.col(b.minX), this.col(b.maxX), this.row(b.minY), this.row(b.maxY)];
  }

  private col(x: number): number {
    return Math.min(this.cols - 1, Math.max(0, Math.floor((x - this.gx) / this.cell)));
  }

  private row(y: number): number {
    return Math.min(this.rows - 1, Math.max(0, Math.floor((y - this.gy) / this.cell)));
  }

  /** Pieces whose footprint could touch `region`, optionally filtered. */
  candidates(region: Aabb2, keep?: (p: TerrainPiece) => boolean): TerrainPiece[] {
    const out: TerrainPiece[] = [];
    if (!this.grid.length) return out;
    if (!(region.minX <= region.maxX && region.minY <= region.maxY)) {
      // An inverted region has no cells. The overlap test still decides it, so it reads every piece.
      for (let i = 0; i < this.pieces.length; i++) this.keepIf(i, region, keep, out);
      return out;
    }
    // A region wholly off the grid can overlap nothing filed in it.
    if (region.maxX < this.gx || region.maxY < this.gy || region.minX > this.gx + this.cols * this.cell || region.minY > this.gy + this.rows * this.cell) return out;
    const [c0, c1, r0, r1] = this.span(region);
    if (c0 === c1 && r0 === r1) {
      // One cell, whose list is already in order and holds each piece once.
      for (const i of this.grid[r0 * this.cols + c0]!) this.keepIf(i, region, keep, out);
      return out;
    }
    const stamp = this.nextStamp();
    const found: number[] = [];
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        for (const i of this.grid[r * this.cols + c]!) {
          if (this.seen[i] === stamp) continue;
          this.seen[i] = stamp;
          found.push(i);
        }
      }
    }
    found.sort((a, b) => a - b);
    for (const i of found) this.keepIf(i, region, keep, out);
    return out;
  }

  private keepIf(i: number, region: Aabb2, keep: ((p: TerrainPiece) => boolean) | undefined, out: TerrainPiece[]): void {
    const p = this.pieces[i]!;
    if (!boxesOverlap(region, this.box(i))) return;
    if (keep && !keep(p)) return;
    out.push(p);
  }

  private nextStamp(): number {
    if (++this.stamp === 0xffffffff) {
      this.seen.fill(0);
      this.stamp = 1;
    }
    return this.stamp;
  }

  /** Pieces whose footprint contains `at`. */
  at(at: Vec2, keep?: (p: TerrainPiece) => boolean): TerrainPiece[] {
    const out: TerrainPiece[] = [];
    for (const p of this.candidates({ minX: at.x, minY: at.y, maxX: at.x, maxY: at.y }, keep)) if (containsPoint(p, at)) out.push(p);
    return out;
  }

  /** Pieces whose footprint comes within `radius` of `at`. */
  near(at: Vec2, radius: number, keep?: (p: TerrainPiece) => boolean): TerrainPiece[] {
    const region = expand({ minX: at.x, minY: at.y, maxX: at.x, maxY: at.y }, radius);
    const point = { a: at, b: at };
    const out: TerrainPiece[] = [];
    for (const p of this.candidates(region, keep)) if (segPolygonDistance(point, p.polygon) <= radius + EPS) out.push(p);
    return out;
  }
}

/* ---- ray versus prism ------------------------------------------------------------------------ */

/**
 * Does the 3D segment `from → to` pass through the piece's solid?
 *
 * The prism is `{ (x, y) inside polygon } × [base, base + height]`, so the test factors into two
 * one-dimensional problems: the parameter spans where the *projected* segment is inside the ring,
 * intersected with the span where `z` is inside the slab. Non-empty means blocked.
 */
export function segmentHitsPrism(from: Vec3, to: Vec3, p: TerrainPiece): boolean {
  const zSpan = prismSlab(from, to, p);
  return !!zSpan && meetsSlab(zSpan, segInPolygonSpans({ a: { x: from.x, y: from.y }, b: { x: to.x, y: to.y } }, p.polygon));
}

/**
 * The stretch of the segment, as parameters from 0 to 1, whose height lies within the piece's solid,
 * or null when there is none. With `meetsSlab` this is `segmentHitsPrism` for a caller that already
 * knows where the segment runs inside the footprint, which rays sharing a line in plan all do.
 */
export function prismSlab(from: Vec3, to: Vec3, p: TerrainPiece): [number, number] | null {
  if (p.height <= EPS) return null;
  return slabSpan(from.z, to.z, p.base, topOf(p));
}

/** Does the stretch `zSpan` overlap any of the stretches of the segment inside the footprint? */
export function meetsSlab(zSpan: readonly [number, number], spans: readonly (readonly [number, number])[]): boolean {
  for (const [t0, t1] of spans) {
    const lo = Math.max(t0, zSpan[0]);
    const hi = Math.min(t1, zSpan[1]);
    if (hi - lo > EPS) return true;
  }
  return false;
}

/** Parameter span of a segment whose `z` lies inside `[lo, hi]`, or null when it never does. */
function slabSpan(z0: number, z1: number, lo: number, hi: number): [number, number] | null {
  const dz = z1 - z0;
  if (Math.abs(dz) < EPS) return z0 >= lo - EPS && z0 <= hi + EPS ? [0, 1] : null;
  const ta = (lo - z0) / dz;
  const tb = (hi - z0) / dz;
  const t0 = Math.max(0, Math.min(ta, tb));
  const t1 = Math.min(1, Math.max(ta, tb));
  return t1 - t0 > EPS ? [t0, t1] : null;
}
