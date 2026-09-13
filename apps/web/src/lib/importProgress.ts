import type { SourceId } from "@grimstat/adapters";

/**
 * Pure model behind the Data page's "Fetch from community sources" panel: which sources a browser can
 * reach, the request sent to the import worker, the progress reducer fed by the worker's events, and
 * the error classification shown to the user. No DOM, no worker, no I/O — see importProgress.test.ts.
 */

/**
 * Sources a browser can reach.
 *
 * MFM YAML and BSData JSON come from raw.githubusercontent.com and api.github.com, which send CORS
 * headers. Wahapedia's own server does not, so it is reached through a mirror, which is a copy of its CSV
 * export in a dataset repository, served over raw.githubusercontent.com like the other two. Wahapedia
 * is the only source carrying stratagems, enhancements and rules text, so without a mirror an import
 * made here produces a snapshot with none of them.
 */
export type BrowserSourceId = Extract<SourceId, "mfm-yaml" | "bsdata-json" | "wahapedia-csv">;
export const BROWSER_SOURCES: readonly BrowserSourceId[] = ["mfm-yaml", "bsdata-json", "wahapedia-csv"];
/** The source that needs a mirror, and is left out of a run that has none configured. */
export const MIRRORED_SOURCE = "wahapedia-csv" satisfies BrowserSourceId;
/** MFM YAML and BSData JSON only carry 11th-edition data. */
export const BROWSER_GAME_SYSTEM_ID = "wh40k-11e";

/** Where the app looks for the mirror, and the setting the Data page keeps it in. */
export const WAHAPEDIA_MIRROR_SETTING = "data.fetch.wahapediaMirror";

/** The editions Wahapedia publishes an export for, and so the directories a mirror holds. */
export const WAHAPEDIA_EDITIONS = ["wh40k-11e", "wh40k-10e"] as const;

/**
 * The dev server's path for Wahapedia. It proxies the request, so the browser reads it from this
 * origin and the CORS question never arises. See the `server.proxy` block in `vite.config.ts`.
 */
export const WAHAPEDIA_DEV_PROXY = "/wahapedia/";

/**
 * Where a run looks for Wahapedia by default, which is somewhere on this origin either way.
 *
 * Running locally there is a server in front of the app and it proxies the request. A built site has
 * no server, so the Pages build copies Wahapedia's export in beside the app and it is read from
 * there. Both need no setup at all; the field is for pointing somewhere else, such as a mirror
 * somebody else published.
 */
export const DEFAULT_WAHAPEDIA_MIRROR = import.meta.env.DEV ? WAHAPEDIA_DEV_PROXY : `${import.meta.env.BASE_URL}wahapedia/`.replace(/\/{2,}/g, "/");

/**
 * The mirror's base for one edition, with one trailing slash. The relay writes a directory per game
 * system, so one dataset repository holds both editions.
 */
export function wahapediaMirrorBase(url: string, gameSystemId: string): string {
  const root = url.trim().replace(/\/+$/, "");
  return `${root}/${gameSystemId}/`;
}

/** Whether a mirror has been configured. A blank setting leaves Wahapedia out of the run. */
export const hasMirror = (url: string | undefined): boolean => !!url && url.trim().length > 0;

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
  /** Base URL of the Wahapedia mirror, already narrowed to this game system. */
  wahapediaMirror?: string;
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

/**
 * Selection → worker request. Sources keep the canonical order (points first, like the CLI).
 *
 * Wahapedia is dropped when no mirror is configured, so the button still runs and produces the
 * snapshot the other two sources can make between them.
 */
export function importRequestFor(sel: ImportSelection, now = new Date(), mirror?: string): ImportRequest {
  const sources = BROWSER_SOURCES.filter((id) => sel.sources[id] && (id !== MIRRORED_SOURCE || hasMirror(mirror)));
  const filter = sel.sources["bsdata-json"] && catalogueTerms(sel.factionFilter).length ? sel.factionFilter.trim() : undefined;
  const req: ImportRequest = { gameSystemId: BROWSER_GAME_SYSTEM_ID, sources, label: fetchedLabel(now, filter) };
  if (filter) req.catalogueFilter = filter;
  if (sources.includes(MIRRORED_SOURCE) && mirror) req.wahapediaMirror = wahapediaMirrorBase(mirror, BROWSER_GAME_SYSTEM_ID);
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
