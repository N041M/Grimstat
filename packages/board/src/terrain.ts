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

import type { Aabb2, Seg2, Vec2, Vec3 } from "./vec";
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
  /** Walls may be moved through by INFANTRY and the like (ruins). */
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
  /** Keywords allowed through walls and up floors regardless of `impassable`. */
  readonly passableBy: readonly string[];
}

export type TerrainInput = Omit<TerrainPiece, "floors" | "passableBy" | "base" | "traits"> &
  Partial<Pick<TerrainPiece, "floors" | "passableBy" | "base" | "traits">>;

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

export const containsPoint = (p: TerrainPiece, at: Vec2): boolean => pointInPolygon(at, p.polygon);

/**
 * A broad-phase index over the pieces.
 *
 * Bounding boxes over a few dozen pieces are enough for a 60 × 44 inch table, and every query goes
 * through `candidates`, so a uniform grid can replace the scan later without touching a caller.
 */
export class TerrainIndex {
  readonly pieces: readonly TerrainPiece[];
  private readonly boxes: Aabb2[];

  constructor(pieces: readonly TerrainPiece[]) {
    this.pieces = pieces;
    this.boxes = pieces.map((p) => bounds(p.polygon));
  }

  box(i: number): Aabb2 {
    return this.boxes[i] ?? { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  }

  /** Pieces whose footprint could touch `region`, optionally filtered. */
  candidates(region: Aabb2, keep?: (p: TerrainPiece) => boolean): TerrainPiece[] {
    const out: TerrainPiece[] = [];
    for (let i = 0; i < this.pieces.length; i++) {
      const p = this.pieces[i]!;
      if (!boxesOverlap(region, this.box(i))) continue;
      if (keep && !keep(p)) continue;
      out.push(p);
    }
    return out;
  }

  /** Pieces whose footprint contains `at`. */
  at(at: Vec2, keep?: (p: TerrainPiece) => boolean): TerrainPiece[] {
    return this.candidates({ minX: at.x, minY: at.y, maxX: at.x, maxY: at.y }, keep).filter((p) => containsPoint(p, at));
  }

  /** Pieces whose footprint comes within `radius` of `at`. */
  near(at: Vec2, radius: number, keep?: (p: TerrainPiece) => boolean): TerrainPiece[] {
    const region = expand({ minX: at.x, minY: at.y, maxX: at.x, maxY: at.y }, radius);
    return this.candidates(region, keep).filter((p) => segPolygonDistance({ a: at, b: at }, p.polygon) <= radius + EPS);
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
  if (p.height <= EPS) return false;
  const zSpan = slabSpan(from.z, to.z, p.base, topOf(p));
  if (!zSpan) return false;
  const flatSeg: Seg2 = { a: { x: from.x, y: from.y }, b: { x: to.x, y: to.y } };
  for (const [t0, t1] of segInPolygonSpans(flatSeg, p.polygon)) {
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
