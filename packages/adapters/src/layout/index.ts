/**
 * `@grimstat/adapters` — terrain layout interchange.
 *
 * A versioned JSON envelope for battle-board terrain layouts, with provenance on every layout because
 * this project imports other people's arrangements onto the user's machine and never ships them.
 */

export { parseLayoutFile, LayoutImportError } from "./import";
export type { ImportedLayout, LayoutImportResult } from "./import";
export { toLayoutFile, stringifyLayoutFile } from "./export";
export type { LayoutFileMeta } from "./export";
export { LayoutFile, LayoutEntry, LayoutPiece, LayoutObjective, LayoutZone, LayoutPoint, LayoutProvenance, LayoutUnits, LAYOUT_FILE_VERSION, MM_PER_INCH, TERRAIN_TRAITS, isTerrainTrait } from "./schema";
export { FORTYKDC, convertFortykdc, fetchFortykdc, areaCentroid, convexHull, minimumRectangle, place, simplifyPlate, simplifyRing, titleOf } from "./fortykdc";
export type { FortykdcFiles, FortykdcConvertOptions, FortykdcResult, FortykdcFetch } from "./fortykdc";
