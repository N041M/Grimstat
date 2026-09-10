import type { SourceId } from "@grimstat/adapters";

/**
 * Pure model behind the Data page's "Fetch from community sources" panel: which sources a browser can
 * reach, the request sent to the import worker, the progress reducer fed by the worker's events, and
 * the error classification shown to the user. No DOM, no worker, no I/O — see importProgress.test.ts.
 */

/** Sources whose hosts send CORS headers (raw.githubusercontent.com / api.github.com). Wahapedia does not. */
export type BrowserSourceId = Extract<SourceId, "mfm-yaml" | "bsdata-json">;
export const BROWSER_SOURCES: readonly BrowserSourceId[] = ["mfm-yaml", "bsdata-json"];
/** MFM YAML and BSData JSON only carry 11th-edition data. */
export const BROWSER_GAME_SYSTEM_ID = "wh40k-11e";

export interface ImportSelection {
  sources: Record<BrowserSourceId, boolean>;
  /** Free text; see `catalogueFilter`. */
  factionFilter: string;
}

/** What the main thread sends to the worker (structured-cloneable: the filter travels as text). */
export interface ImportRequest {
  gameSystemId: string;
  sources: BrowserSourceId[];
  /** Comma-separated catalogue name terms; absent = every catalogue. */
  catalogueFilter?: string;
  label: string;
}

/** Comma-separated, trimmed, lower-cased, empty terms dropped. */
export function catalogueTerms(text: string): string[] {
  return text
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);
}

/**
 * Predicate for `fetchSource(..., { filter })`: a BSData catalogue file is downloaded when its file name
 * contains any term (case-insensitive). `fetchSource` always keeps libraries and the game-system file.
 * Returns undefined for blank input so the fetch stays unfiltered.
 */
export function catalogueFilter(text: string): ((fileName: string) => boolean) | undefined {
  const terms = catalogueTerms(text);
  if (terms.length === 0) return undefined;
  return (fileName) => {
    const n = fileName.toLowerCase();
    return terms.some((term) => n.includes(term));
  };
}

export function fetchedLabel(now: Date, filter?: string): string {
  const base = `Fetched ${now.toISOString().slice(0, 10)}`;
  const terms = filter ? catalogueTerms(filter) : [];
  return terms.length ? `${base} · ${filter!.trim()}` : base;
}

/** Selection → worker request. Sources keep the canonical order (points first, like the CLI). */
export function importRequestFor(sel: ImportSelection, now = new Date()): ImportRequest {
  const sources = BROWSER_SOURCES.filter((id) => sel.sources[id]);
  const filter = sel.sources["bsdata-json"] && catalogueTerms(sel.factionFilter).length ? sel.factionFilter.trim() : undefined;
  const req: ImportRequest = { gameSystemId: BROWSER_GAME_SYSTEM_ID, sources, label: fetchedLabel(now, filter) };
  if (filter) req.catalogueFilter = filter;
  return req;
}

export interface SourceCounts {
  factions: number;
  datasheets: number;
  abilities: number;
  detachments: number;
  enhancements: number;
  stratagems: number;
  priceRules: number;
  wargearPrices: number;
}

/** Events the worker posts while it runs (via a Comlink-proxied callback). */
export type ImportEvent =
  | { type: "downloading"; source: BrowserSourceId; index: number; total: number }
  | { type: "parsing"; source: BrowserSourceId; files: number; ref?: string }
  | { type: "parsed"; source: BrowserSourceId; warnings: number; sample: string[]; counts: SourceCounts; ref?: string }
  | { type: "failed"; source: BrowserSourceId; message: string }
  | { type: "merging" }
  | { type: "merged"; conflicts: number; warnings: number; unmatched: number }
  | { type: "building" };

export interface ImportSummary {
  snapshotId: string;
  label: string | undefined;
  checksum: string;
  counts: SourceCounts;
  conflicts: number;
  sources: Array<{ adapter: string; ref?: string; url?: string }>;
  elapsedMs: number;
}

export type ImportErrorKind = "rate-limit" | "network" | "cancelled" | "other";

/** Reducer input: worker events plus the main thread's own lifecycle actions. */
export type ImportAction =
  | ImportEvent
  | { type: "start"; sources: BrowserSourceId[] }
  | { type: "done"; summary: ImportSummary }
  | { type: "error"; message: string; kind: ImportErrorKind }
  | { type: "cancelled" }
  | { type: "reset" };

export type SourceStage = "pending" | "downloading" | "parsing" | "parsed" | "failed";

export interface SourceProgress {
  id: BrowserSourceId;
  stage: SourceStage;
  /** Files started / files to download (0/0 until the listing is known). */
  index: number;
  total: number;
  files: number;
  warnings: number;
  /** First few warnings, for a details toggle. */
  sample: string[];
  ref?: string;
  counts?: SourceCounts;
  message?: string;
}

export type ImportStage = "idle" | "fetching" | "merging" | "building" | "done" | "error" | "cancelled";

export interface ImportProgress {
  stage: ImportStage;
  sources: SourceProgress[];
  merge?: { conflicts: number; warnings: number; unmatched: number };
  error?: { message: string; kind: ImportErrorKind };
  summary?: ImportSummary;
}

export const IDLE_PROGRESS: ImportProgress = { stage: "idle", sources: [] };

const RUNNING: ReadonlySet<ImportStage> = new Set<ImportStage>(["fetching", "merging", "building"]);

export function isRunning(p: ImportProgress): boolean {
  return RUNNING.has(p.stage);
}

function freshSource(id: BrowserSourceId): SourceProgress {
  return { id, stage: "pending", index: 0, total: 0, files: 0, warnings: 0, sample: [] };
}

function patchSource(p: ImportProgress, id: BrowserSourceId, fn: (s: SourceProgress) => SourceProgress): ImportProgress {
  if (!p.sources.some((s) => s.id === id)) return p;
  return { ...p, sources: p.sources.map((s) => (s.id === id ? fn(s) : s)) };
}

/** Pure progress reducer. Worker events arriving outside a run (late messages) are ignored. */
export function reduceProgress(p: ImportProgress, a: ImportAction): ImportProgress {
  switch (a.type) {
    case "reset":
      return IDLE_PROGRESS;
    case "start":
      return { stage: "fetching", sources: a.sources.map(freshSource) };
    case "done":
      return { ...p, stage: "done", summary: a.summary };
    case "error":
      return { ...p, stage: "error", error: { message: a.message, kind: a.kind } };
    case "cancelled":
      // Nothing was stored; drop the half-finished rows so no "downloading" badge outlives the run.
      return { stage: "cancelled", sources: [] };
  }
  if (!isRunning(p)) return p;
  switch (a.type) {
    case "downloading":
      return patchSource(p, a.source, (s) => ({ ...s, stage: "downloading", index: a.index, total: a.total }));
    case "parsing":
      return patchSource(p, a.source, (s) => ({ ...s, stage: "parsing", index: s.total, files: a.files, ...(a.ref ? { ref: a.ref } : {}) }));
    case "parsed":
      return patchSource(p, a.source, (s) => ({ ...s, stage: "parsed", warnings: a.warnings, sample: a.sample, counts: a.counts, ...(a.ref ? { ref: a.ref } : {}) }));
    case "failed":
      return patchSource(p, a.source, (s) => ({ ...s, stage: "failed", message: a.message }));
    case "merging":
      return { ...p, stage: "merging" };
    case "merged":
      return { ...p, merge: { conflicts: a.conflicts, warnings: a.warnings, unmatched: a.unmatched } };
    case "building":
      return { ...p, stage: "building" };
  }
}

/** Map a thrown error to the hint the panel shows (GitHub API quota, connectivity, user cancel). */
export function classifyError(err: unknown): ImportErrorKind {
  const name = err instanceof Error ? err.name : "";
  const message = err instanceof Error ? err.message : String(err);
  if (name === "AbortError" || name === "ImportCancelledError") return "cancelled";
  if (/api\.github\.com/.test(message) && /HTTP 40[39]/.test(message)) return "rate-limit";
  if (/HTTP 429/.test(message)) return "rate-limit";
  if (/failed to fetch|networkerror|load failed|network request failed|HTTP 5\d\d/i.test(message)) return "network";
  return "other";
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
