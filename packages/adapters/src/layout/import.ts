/**
 * Reading a layout file.
 *
 * The line this importer draws is between *sloppy* and *broken*.
 *
 * Sloppy is forgiven and reported: a ring wound clockwise, a ring that repeats its first point to
 * close itself, a trait this build has never heard of, a duplicated floor, a deployment zone that is
 * not a polygon. None of these can produce a wrong answer from a board query — the worst case is a
 * layout missing a decoration — so the file imports and the user gets a warning.
 *
 * Broken is refused outright: a footprint with fewer than three points or no area, a negative height,
 * a floor hanging above its own roof, a piece off the side of the table, two pieces sharing an id.
 * Each of those *silently* corrupts play rather than failing loudly — a zero-area ruin blocks no
 * sight line, an off-table piece is unreachable, a duplicate id makes "which piece is this" ambiguous
 * forever after. A layout editor would rather be told at import than have a player discover it in
 * game, so these throw with the full list of problems rather than importing a plausible-looking board.
 */

import type { BoardSize, Objective, TerrainLayout, TerrainPiece, TerrainTrait, Vec2, Zone } from "@grimstat/board";
import { BREACHERS, EPS, layoutIssues, signedArea, terrain } from "@grimstat/board";
import type { z } from "zod";
import type { LayoutEntry, LayoutFile, LayoutPiece, LayoutPoint, LayoutProvenance, LayoutUnits, LayoutZone } from "./schema";
import { LayoutFile as LayoutFileSchema, MM_PER_INCH, isTerrainTrait } from "./schema";

/**
 * A layout as it comes out of a file.
 *
 * `TerrainLayout` has room for deployment zones but none for provenance — the board package models
 * the table, not where the table's description came from — so the importer widens it by that one
 * field. The result is still a plain `TerrainLayout` to every geometry query, and provenance
 * survives an export.
 */
export interface ImportedLayout extends TerrainLayout {
  /** Absent when neither the layout nor the envelope said anything. Fields nobody set stay absent rather than being invented. */
  readonly provenance?: LayoutProvenance;
}

export interface LayoutImportResult {
  readonly layouts: ImportedLayout[];
  /** Everything that was silently repaired, in the words a layout editor would show. */
  readonly warnings: string[];
}

/**
 * A file that would have produced an unplayable board.
 *
 * The list is kept separate from the message because a layout editor wants to show the problems one
 * per line beside the file, and `Error.message` is also expected to stand alone in a log.
 */
export class LayoutImportError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`Could not import the layout file:\n- ${issues.join("\n- ")}`);
    this.name = "LayoutImportError";
    this.issues = issues;
  }
}

/**
 * Converts one length into inches.
 *
 * Dividing by 25.4 rather than multiplying by its reciprocal is not pedantry: a 1117.6 mm table is
 * exactly 44" under division and 43.99999999999999" under multiplication, and the second form turns
 * a board that fits into one that reports pieces hanging off its edge.
 */
type ToInches = (value: number) => number;

const converter = (units: LayoutUnits): ToInches => (units === "mm" ? (v) => v / MM_PER_INCH : (v) => v);

/**
 * Parse a layout file.
 *
 * Accepts either the JSON text or an already-parsed value: a layout file is an object at the top
 * level, so a string input is never ambiguous, and callers holding a `File`'s text should not have to
 * remember which of the two this wants.
 */
export function parseLayoutFile(json: unknown): LayoutImportResult {
  const file = readFile(json);
  const warnings: string[] = [];
  const toInches = converter(file.units);
  if (file.units === "mm") warnings.push("File is in millimetres; every length was converted to inches.");
  if (file.layouts.length === 0) warnings.push("File contains no layouts.");

  const issues: string[] = [];
  const layouts: ImportedLayout[] = [];
  const seenLayoutIds = new Set<string>();

  for (const entry of file.layouts) {
    if (seenLayoutIds.has(entry.id)) {
      issues.push(`${entry.id}: duplicate layout id`);
      continue;
    }
    seenLayoutIds.add(entry.id);
    const layout = readLayout(entry, file, toInches, warnings, issues);
    if (layout) layouts.push(layout);
  }

  if (issues.length > 0) throw new LayoutImportError(issues);
  return { layouts, warnings };
}

/** Envelope validation, with zod's paths rewritten into something a person can act on. */
function readFile(json: unknown): LayoutFile {
  const raw: unknown = typeof json === "string" ? parseJsonText(json) : json;
  const result = LayoutFileSchema.safeParse(raw);
  if (result.success) return result.data;
  throw new LayoutImportError(formatZodIssues(result.error));
}

function parseJsonText(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new LayoutImportError([`Not valid JSON: ${e instanceof Error ? e.message : String(e)}`]);
  }
}

function formatZodIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.join(".");
    return path ? `${path}: ${issue.message}` : issue.message;
  });
}

/**
 * One layout. Returns `undefined` when it was rejected; problems are appended to `issues` rather
 * than thrown so that a file with three bad layouts reports all three in one pass.
 */
function readLayout(entry: LayoutEntry, file: LayoutFile, toInches: ToInches, warnings: string[], issues: string[]): ImportedLayout | undefined {
  const where = entry.id;
  const before = issues.length;

  const size: BoardSize = { width: toInches(entry.size.width), depth: toInches(entry.size.depth) };
  const pieces: TerrainPiece[] = [];
  for (const raw of entry.pieces) {
    const piece = readPiece(raw, where, toInches, warnings, issues);
    if (piece) pieces.push(piece);
  }

  const objectives: Objective[] = [];
  const seenObjectiveIds = new Set<string>();
  for (const raw of entry.objectives) {
    if (seenObjectiveIds.has(raw.id)) {
      issues.push(`${where}/${raw.id}: duplicate objective id`);
      continue;
    }
    seenObjectiveIds.add(raw.id);
    objectives.push({
      id: raw.id,
      at: point(raw.at, toInches),
      ...(raw.z === undefined ? {} : { z: toInches(raw.z) }),
      ...positiveOrDrop("markerRadius", raw.markerRadius, `${where}/${raw.id}`, toInches, warnings),
      ...positiveOrDrop("range", raw.range, `${where}/${raw.id}`, toInches, warnings),
    });
  }

  const zones = readZones(entry.zones, where, toInches, warnings);
  const provenance = readProvenance(entry, file);

  const layout: ImportedLayout = {
    id: entry.id,
    name: entry.name,
    size,
    pieces,
    objectives,
    ...(entry.note === undefined ? {} : { note: entry.note }),
    ...(zones === undefined ? {} : { zones }),
    ...(provenance === undefined ? {} : { provenance }),
  };

  // The board package already knows what makes a layout unplayable; asking it keeps one definition of
  // "off the table" instead of a second, subtly different one here.
  for (const issue of layoutIssues(layout)) issues.push(`${where}/${issue}`);
  return issues.length === before ? layout : undefined;
}

function readPiece(raw: LayoutPiece, where: string, toInches: ToInches, warnings: string[], issues: string[]): TerrainPiece | undefined {
  const at = `${where}/${raw.id}`;

  const polygon = ring(raw.polygon, toInches);
  if (polygon.length < 3) {
    issues.push(`${at}: footprint needs at least 3 distinct points, got ${polygon.length}`);
    return undefined;
  }
  // A collinear or repeated-point ring passes the count test and then blocks nothing, contains
  // nothing and measures as zero — exactly the kind of piece a player would swear was on the table.
  if (Math.abs(signedArea(polygon)) < EPS) {
    issues.push(`${at}: footprint encloses no area`);
    return undefined;
  }
  // `terrain()` clamps a negative height to zero, which would quietly turn a mistyped ruin into a
  // flat marker, so it is caught before normalisation rather than after.
  if (raw.height < 0) {
    issues.push(`${at}: height is negative (${raw.height})`);
    return undefined;
  }

  const traits: TerrainTrait[] = [];
  for (const t of raw.traits) {
    if (!isTerrainTrait(t)) {
      warnings.push(`${at}: dropped unknown terrain trait "${t}".`);
      continue;
    }
    if (!traits.includes(t)) traits.push(t);
  }

  const floors = readFloors(raw.floors, at, toInches, warnings);

  // A file written before breachable walls kept anyone out has ruins that name nobody. Read
  // literally that seals them against everyone, so the default list is assumed and said so.
  let passableBy = keywords(raw.passableBy);
  if (traits.includes("breachable") && passableBy.length === 0) {
    passableBy = [...BREACHERS];
    warnings.push(`${at}: breachable walls name nobody who may pass; assumed ${BREACHERS.join(", ")}.`);
  }

  return terrain({
    id: raw.id,
    polygon,
    base: toInches(raw.base),
    height: toInches(raw.height),
    traits,
    floors,
    passableBy,
    climbableBy: keywords(raw.climbableBy),
  });
}

/** Absent means an ordinary ground-level piece; `[]` means deliberately nothing to stand on. */
function readFloors(raw: readonly number[] | undefined, at: string, toInches: ToInches, warnings: string[]): number[] {
  if (raw === undefined) return [0];
  const out: number[] = [];
  for (const f of raw) {
    const h = toInches(f);
    if (out.some((existing) => Math.abs(existing - h) < EPS)) {
      warnings.push(`${at}: dropped a duplicate floor at ${h}".`);
      continue;
    }
    out.push(h);
  }
  return out;
}

/**
 * Deployment zones are decoration as far as the geometry kernel is concerned — nothing measures
 * against one unless a mission asks it to. A malformed zone is therefore dropped without failing the layout.
 */
function readZones(raw: readonly LayoutZone[] | undefined, where: string, toInches: ToInches, warnings: string[]): readonly Zone[] | undefined {
  if (raw === undefined) return undefined;
  const zones: Zone[] = [];
  const seen = new Set<string>();
  for (const z of raw) {
    if (seen.has(z.id)) {
      warnings.push(`${where}: dropped a second deployment zone with id "${z.id}".`);
      continue;
    }
    const polygon = ring(z.polygon, toInches);
    if (polygon.length < 3 || Math.abs(signedArea(polygon)) < EPS) {
      warnings.push(`${where}: dropped deployment zone "${z.id}" — its outline is not a polygon.`);
      continue;
    }
    seen.add(z.id);
    zones.push({ id: z.id, owner: z.owner, polygon });
  }
  return zones;
}

/**
 * A layout inherits anything the envelope says and it does not; an empty result stays absent.
 *
 * An empty string counts as "not said", the same as on export — so a layout whose `author` is `""`
 * still takes the envelope's author rather than ending up with none.
 */
function readProvenance(entry: LayoutProvenance, file: LayoutProvenance): LayoutProvenance | undefined {
  const merged: Record<string, string> = {};
  for (const field of ["source", "author", "licence", "importedFrom"] as const) {
    const value = entry[field] || file[field];
    if (value) merged[field] = value;
  }
  return Object.keys(merged).length > 0 ? merged : undefined;
}

const point = (p: LayoutPoint, toInches: ToInches): Vec2 => ({ x: toInches(p[0]), y: toInches(p[1]) });

/**
 * Points to a ring, dropping consecutive duplicates and the wrap-around repeat.
 *
 * GeoJSON and most GIS-derived exports close a ring by repeating its first point; `@grimstat/board`
 * closes implicitly. Removing a repeat never changes the shape, so it is not worth a warning —
 * unlike anything that would leave too few points, which the caller then rejects.
 */
function ring(points: readonly LayoutPoint[], toInches: ToInches): Vec2[] {
  const out: Vec2[] = [];
  for (const p of points) {
    const v = point(p, toInches);
    const last = out[out.length - 1];
    if (last && Math.abs(last.x - v.x) < EPS && Math.abs(last.y - v.y) < EPS) continue;
    out.push(v);
  }
  const first = out[0];
  const last = out[out.length - 1];
  if (out.length > 1 && first && last && Math.abs(first.x - last.x) < EPS && Math.abs(first.y - last.y) < EPS) out.pop();
  return out;
}

/** `mayClimb` matches upper-case keywords, so a file written in mixed case still keeps tanks down. */
function keywords(raw: readonly string[]): string[] {
  const out: string[] = [];
  for (const k of raw) {
    const key = k.trim().toUpperCase();
    if (key && !out.includes(key)) out.push(key);
  }
  return out;
}

/**
 * A radius or a range of zero or less is not a smaller objective, it is an objective nobody can ever
 * hold. Dropping the field falls back to the board's documented default, which is what the file
 * almost certainly meant.
 */
function positiveOrDrop(field: "markerRadius" | "range", value: number | undefined, at: string, toInches: ToInches, warnings: string[]): Partial<Pick<Objective, "markerRadius" | "range">> {
  if (value === undefined) return {};
  if (value <= 0) {
    warnings.push(`${at}: ignored ${field} of ${value} — it must be greater than zero.`);
    return {};
  }
  return { [field]: toInches(value) };
}
