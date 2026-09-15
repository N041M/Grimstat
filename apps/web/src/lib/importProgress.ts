import type { SourceId } from "@grimstat/adapters";
import type { MissingSource, SourceRef } from "@grimstat/schema";

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

/**
 * What a snapshot holds of the rules text export, which is the only source of stratagems,
 * enhancement text and detachment rules.
 *
 * Read from the snapshot rather than from the panel that fetched it, so a screen opened days later
 * gives the same answer as the run did: present, never asked for, or asked for and not answered.
 */
export type RulesTextState = { state: "present" } | { state: "absent" } | { state: "failed"; reason: string; url?: string };

export function rulesTextState(snapshot: { sources?: readonly { adapter: string }[]; missingSources?: readonly MissingSource[] } | undefined): RulesTextState {
  const failed = snapshot?.missingSources?.find((m) => m.adapter === MIRRORED_SOURCE);
  if (failed) return { state: "failed", reason: failed.reason, ...(failed.url ? { url: failed.url } : {}) };
  if (snapshot?.sources?.some((s) => s.adapter === MIRRORED_SOURCE)) return { state: "present" };
  return { state: "absent" };
}

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
  /**
   * The sources of the snapshot a single-source refresh updates.
   *
   * The run rebuilds the snapshot from all of them, so every field comes from the source that owns
   * it. The ones not being fetched are read back from the files kept on this machine, and are
   * downloaded again when those files are missing or came from a different download.
   */
  base?: SourceRef[];
}

/** Where a source's files came from and when, which is what a snapshot's source list records. */
export interface HeldFetch {
  url: string;
  ref?: string;
  fetchedAt: string;
}

/**
 * Whether files held on this machine are the ones a snapshot was built from. They are when they
 * agree on when the download happened and where it came from.
 */
export function isSameFetch(stored: SourceRef, held: HeldFetch): boolean {
  return held.fetchedAt === stored.fetchedAt && held.url === (stored.url ?? "") && (held.ref ?? "") === (stored.ref ?? "");
}

/**
 * Which sources a run has to download: the ones asked for, plus any other source of the snapshot
 * being refreshed whose files are not here to read back.
 *
 * Every source of the snapshot takes part in the merge, because a field only lands with the right
 * authority when every source that could supply it is present. That means downloading a source whose
 * files are missing, and one whose files came from a different download than the one that built the
 * snapshot.
 */
export function sourcesToFetch(request: ImportRequest, held: (id: BrowserSourceId) => HeldFetch | undefined): BrowserSourceId[] {
  const wanted = new Set<BrowserSourceId>(request.sources);
  for (const stored of request.base ?? []) {
    const id = stored.adapter as BrowserSourceId;
    if (!BROWSER_SOURCES.includes(id) || wanted.has(id)) continue;
    const have = held(id);
    if (!have || !isSameFetch(stored, have)) wanted.add(id);
  }
  return BROWSER_SOURCES.filter((id) => wanted.has(id));
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

/**
 * One source's own Fetch button: download that source and rebuild the snapshot in hand around it.
 * The label says which source moved, so the snapshot list reads as a history of what was updated
 * when.
 */
export function refreshRequestFor(id: BrowserSourceId, sel: ImportSelection, base: SourceRef[], now = new Date(), mirror?: string): ImportRequest {
  const filter = catalogueTerms(sel.factionFilter).length ? sel.factionFilter.trim() : undefined;
  const req: ImportRequest = { gameSystemId: BROWSER_GAME_SYSTEM_ID, sources: [id], label: `${SOURCE_LABEL[id]} ${now.toISOString().slice(0, 10)}`, base };
  if (filter) req.catalogueFilter = filter;
  // Any source can pull Wahapedia into the run, because a source whose files are not here is
  // downloaded alongside the one that was asked for.
  if (hasMirror(mirror)) req.wahapediaMirror = wahapediaMirrorBase(mirror!, BROWSER_GAME_SYSTEM_ID);
  return req;
}

/**
 * Rebuild the snapshot in hand from the files already on this machine.
 *
 * No source is asked for, so nothing is downloaded unless one of the snapshot's sources has no files
 * kept here. It is how a correction to the way sources are read — two names for one faction, say —
 * reaches a stored snapshot without fetching tens of megabytes again.
 */
export function rebuildRequestFor(base: SourceRef[], now = new Date()): ImportRequest {
  return { gameSystemId: BROWSER_GAME_SYSTEM_ID, sources: [], label: `Rebuilt ${now.toISOString().slice(0, 10)}`, base };
}

/**
 * The same run with the rules text export left out, for a mirror that will not answer. The other
 * sources are worth having on their own, so the run is offered again without the one that failed.
 */
export function withoutRulesText(req: ImportRequest): ImportRequest {
  const out: ImportRequest = { ...req, sources: req.sources.filter((id) => id !== MIRRORED_SOURCE) };
  delete out.wahapediaMirror;
  return out;
}

/** Short names for the snapshot label a single-source refresh writes. */
const SOURCE_LABEL: Record<BrowserSourceId, string> = { "mfm-yaml": "MFM updated", "bsdata-json": "BSData updated", "wahapedia-csv": "Rules text updated" };

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
  /** The sources this run downloads, which is settled once the worker has seen what is already here. */
  | { type: "planned"; sources: BrowserSourceId[] }
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
  /** Sources the run asked for and did not get. A run that got everything leaves this empty. */
  missingSources: MissingSource[];
  elapsedMs: number;
}

export type ImportErrorKind = "rate-limit" | "network" | "cancelled" | "mirror" | "other";

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
    case "planned":
      // A refresh downloads the sources whose files are not here as well as the one asked for. The
      // cards are settled here because that is the first point at which the list is known.
      return { ...p, sources: a.sources.map((id) => p.sources.find((s) => s.id === id) ?? freshSource(id)) };
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
