/**
 * The terrain layout interchange format.
 *
 * Grimstat ships four generic layouts and nothing else; every other arrangement a player wants comes
 * from somewhere — a club's terrain pack, a tournament organiser's PDF traced by hand, another app's
 * export. Those files land on the user's machine, not in this repo, so the format's first job is to
 * let a layout **say where it came from**: `source`, `author`, `licence` and `importedFrom` are part
 * of the envelope *and* of every layout, because a bundle of layouts from one place still routinely
 * contains one piece someone else drew.
 *
 * The shape here is deliberately a *file* format rather than a mirror of `TerrainLayout`:
 * - points are `[x, y]` pairs, not `{x, y}` objects, because a layout is mostly coordinates and the
 *   object form triples the size of a file a human may well end up reading in a diff;
 * - `traits` is `string[]`, not an enum, so that a file written against a later build of
 *   `@grimstat/board` still imports — the importer drops what it does not know and says so, which is
 *   the whole reason validation and import are separate steps here;
 * - lengths are declared once for the file via `units`, never guessed per value.
 *
 * This module only decides whether a document is *well formed*. Whether it describes a **playable**
 * board (pieces on the table, floors inside their piece, no duplicate ids) is `import.ts`'s job,
 * because those checks want `@grimstat/board`'s own geometry and produce prose a layout editor can
 * show next to the offending piece.
 */

import type { TerrainTrait } from "@grimstat/board";
import { z } from "zod";

/**
 * Bumped only for a change that would make an older importer read a newer file *wrongly*. Adding an
 * optional field does not qualify — unknown keys are stripped, so old files and new ones coexist.
 */
export const LAYOUT_FILE_VERSION = 1;

/**
 * Keyed by `TerrainTrait` rather than written as a plain array so that a trait added to (or removed
 * from) `@grimstat/board` breaks the build here instead of silently becoming a trait this importer
 * treats as unknown and throws away.
 */
const TRAIT_KEYS: Record<TerrainTrait, true> = {
  obscuring: true,
  "light-cover": true,
  "heavy-cover": true,
  impassable: true,
  difficult: true,
  breachable: true,
  scalable: true,
  defensible: true,
  transparent: true,
};

export const TERRAIN_TRAITS = Object.keys(TRAIT_KEYS) as readonly TerrainTrait[];

const TRAIT_LOOKUP = new Set<string>(TERRAIN_TRAITS);

/** Is this string a trait this build understands? Unknown ones are dropped with a warning on import. */
export const isTerrainTrait = (s: string): s is TerrainTrait => TRAIT_LOOKUP.has(s);

/**
 * `NaN` and `±Infinity` are rejected everywhere a length is expected. They survive `JSON.parse` of
 * nothing, but they arrive readily from other tools' exports via `null`-ish maths, and a single one
 * poisons every distance query on the board without ever throwing.
 */
const length = z.number().finite();

const positiveLength = length.positive();

/** A point on the table plane, `[x, y]`, in the file's declared units. */
export const LayoutPoint = z.tuple([length, length]);
export type LayoutPoint = z.infer<typeof LayoutPoint>;

/**
 * Where a layout came from. Present on the envelope as a default for the whole bundle and on each
 * layout for the common case of a bundle that is mostly one person's work plus a guest piece.
 */
export const LayoutProvenance = z.object({
  /** Human-readable origin: a club, an event, a book, a website. */
  source: z.string().optional(),
  /** Who drew the layout. */
  author: z.string().optional(),
  /** Terms the author released it under, verbatim — this project never relicenses anything. */
  licence: z.string().optional(),
  /** Machine origin: the URL or file name the user imported from. */
  importedFrom: z.string().optional(),
});
export type LayoutProvenance = z.infer<typeof LayoutProvenance>;

export const LayoutPiece = z.object({
  id: z.string().min(1),
  /** Footprint ring. Winding is irrelevant — the importer normalises it. */
  polygon: z.array(LayoutPoint),
  /** Elevation of the footprint; a gantry sits above the table, a sunken bunker below it. */
  base: length.default(0),
  height: length,
  traits: z.array(z.string()).default([]),
  /**
   * Walkable surfaces relative to `base`. Absent is *not* the same as `[]`: a hand-written file that
   * omits floors means "ordinary ground-level piece", whereas `[]` deliberately says nothing can
   * stand here. The importer fills the former with `[0]` and leaves the latter alone.
   */
  floors: z.array(length).optional(),
  passableBy: z.array(z.string()).default([]),
  climbableBy: z.array(z.string()).default([]),
});
export type LayoutPiece = z.infer<typeof LayoutPiece>;

export const LayoutObjective = z.object({
  id: z.string().min(1),
  at: LayoutPoint,
  /** Height of the surface it sits on; an objective on a ruin's first floor is legal. */
  z: length.optional(),
  markerRadius: length.optional(),
  range: length.optional(),
});
export type LayoutObjective = z.infer<typeof LayoutObjective>;

export const LayoutZone = z.object({
  id: z.string().min(1),
  owner: z.enum(["attacker", "defender"]),
  polygon: z.array(LayoutPoint),
});
export type LayoutZone = z.infer<typeof LayoutZone>;

export const LayoutEntry = LayoutProvenance.extend({
  id: z.string().min(1),
  name: z.string().min(1),
  size: z.object({ width: positiveLength, depth: positiveLength }),
  note: z.string().optional(),
  pieces: z.array(LayoutPiece).default([]),
  objectives: z.array(LayoutObjective).default([]),
  /** Deployment zones travel with the layout when the source had them; most sources do not. */
  zones: z.array(LayoutZone).optional(),
});
export type LayoutEntry = z.infer<typeof LayoutEntry>;

/**
 * Units for every length in the file. Defaulting to inches when absent is a decision, not an
 * oversight: the alternative is sniffing magnitudes, and a 60 × 44 board is indistinguishable from a
 * small board measured in centimetres. A file that means millimetres must say so.
 */
export const LayoutUnits = z.enum(["in", "mm"]);
export type LayoutUnits = z.infer<typeof LayoutUnits>;

export const LayoutFile = LayoutProvenance.extend({
  version: z.literal(LAYOUT_FILE_VERSION),
  units: LayoutUnits.default("in"),
  layouts: z.array(LayoutEntry),
});
export type LayoutFile = z.infer<typeof LayoutFile>;

/** Millimetres per inch — the only conversion the format needs, and it is exact by definition. */
export const MM_PER_INCH = 25.4;
