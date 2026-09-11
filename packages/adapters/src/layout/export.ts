/**
 * Writing a layout file.
 *
 * The contract is narrow on purpose: whatever comes out of here must go back through
 * `parseLayoutFile` unchanged, so this module never rounds, never re-orders and never omits a field
 * that carries meaning. `floors` in particular is always written explicitly — the importer treats an
 * absent `floors` as "ordinary ground-level piece", which would quietly grow a floor onto the sealed
 * bunkers in REDOUBT if the exporter left it off as a default.
 *
 * Output is always in inches even though the importer reads millimetres. Inches are what the geometry
 * kernel stores, and a millimetre round trip would divide and re-multiply by 25.4 in binary floating
 * point, so a file exported in millimetres could not be re-imported to the same board. The asymmetry
 * is the point: read what other tools write, write only what is exact.
 */

import type { Objective, TerrainLayout, TerrainPiece, Vec2, Zone } from "@grimstat/board";
import type { ImportedLayout } from "./import";
import type { LayoutEntry, LayoutFile, LayoutObjective, LayoutPiece, LayoutPoint, LayoutProvenance, LayoutZone } from "./schema";
import { LAYOUT_FILE_VERSION } from "./schema";

/** Envelope-level provenance: what the whole bundle came from, inherited by layouts that stay silent. */
export type LayoutFileMeta = LayoutProvenance;

/**
 * Serialise layouts to the interchange format.
 *
 * Accepts plain `TerrainLayout`s — a layout built in the app has no provenance and does not need any
 * — and carries it through when given an `ImportedLayout`. Deployment zones are part of
 * `TerrainLayout` itself and are written whenever the layout has them.
 */
export function toLayoutFile(layouts: readonly TerrainLayout[], meta: LayoutFileMeta = {}): LayoutFile {
  return {
    version: LAYOUT_FILE_VERSION,
    units: "in",
    ...provenance(meta),
    layouts: layouts.map(toEntry),
  };
}

/** Convenience for the common caller, which is writing a file to disk or to a download. */
export function stringifyLayoutFile(layouts: readonly TerrainLayout[], meta: LayoutFileMeta = {}): string {
  return JSON.stringify(toLayoutFile(layouts, meta), null, 2) + "\n";
}

function toEntry(layout: TerrainLayout): LayoutEntry {
  // Provenance is the one field `TerrainLayout` lacks; a plain layout simply has none.
  const { provenance: origin } = layout as ImportedLayout;
  return {
    id: layout.id,
    name: layout.name,
    size: { width: layout.size.width, depth: layout.size.depth },
    ...(layout.note === undefined ? {} : { note: layout.note }),
    ...provenance(origin ?? {}),
    pieces: layout.pieces.map(toPiece),
    objectives: layout.objectives.map(toObjective),
    ...(layout.zones === undefined ? {} : { zones: layout.zones.map(toZone) }),
  };
}

function toPiece(piece: TerrainPiece): LayoutPiece {
  return {
    id: piece.id,
    polygon: piece.polygon.map(toPoint),
    base: piece.base,
    height: piece.height,
    traits: [...piece.traits],
    floors: [...piece.floors],
    passableBy: [...piece.passableBy],
    climbableBy: [...piece.climbableBy],
  };
}

function toObjective(objective: Objective): LayoutObjective {
  return {
    id: objective.id,
    at: toPoint(objective.at),
    ...(objective.z === undefined ? {} : { z: objective.z }),
    ...(objective.markerRadius === undefined ? {} : { markerRadius: objective.markerRadius }),
    ...(objective.range === undefined ? {} : { range: objective.range }),
  };
}

function toZone(zone: Zone): LayoutZone {
  return { id: zone.id, owner: zone.owner, polygon: zone.polygon.map(toPoint) };
}

const toPoint = (p: Vec2): LayoutPoint => [p.x, p.y];

/** Only fields that were actually set are written; an empty string is treated as nothing said. */
function provenance(p: LayoutProvenance): LayoutProvenance {
  const out: Record<string, string> = {};
  for (const field of ["source", "author", "licence", "importedFrom"] as const) {
    const value = p[field];
    if (value !== undefined && value !== "") out[field] = value;
  }
  return out;
}
