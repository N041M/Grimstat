/// <reference lib="webworker" />
import * as Comlink from "comlink";
import type { MissingSource, Snapshot } from "@grimstat/schema";
import { SOURCES, fetchSource, type AdapterOutput, type FetchLike, type ParseOptions } from "@grimstat/adapters";
import { buildSnapshot, mergeSources, pruneFactionsWithoutDatasheets } from "@grimstat/snapshot";
import { putSourceFiles, readSourceFiles, type SourceFilesRecord } from "../db";
import { BROWSER_SOURCES, MIRRORED_SOURCE, catalogueFilter, sourcesToFetch, type BrowserSourceId, type ImportEvent, type ImportRequest, type ImportSummary, type SourceCounts } from "../lib/importProgress";

/**
 * Browser-side counterpart of `apps/cli/src/commands/import.ts`: fetch every selected source straight from
 * GitHub (CORS-enabled hosts only), parse per source, merge, build a checksummed Snapshot. Runs in a
 * Web Worker so the multi-megabyte parse/merge never blocks the UI; progress goes back through a
 * Comlink-proxied callback. Overrides are not applied here — the app applies them when it reads a snapshot.
 *
 * Updating one source rebuilds the snapshot from every source it had. Laying the fresh part over the
 * stored snapshot cannot work, because a snapshot records which sources built it but not which of
 * them supplied each field, so the stale copy of the refreshed source is indistinguishable from the
 * fields another source still owns. Merging all the sources together is what a first import does,
 * and it gets every field from the source with authority over it. The files each source arrived as
 * are kept on this machine so the other two do not have to be downloaded again.
 */

export interface ImportResult {
  snapshot: Snapshot;
  summary: ImportSummary;
}

export interface ImportWorkerApi {
  run(request: ImportRequest, onEvent: (e: ImportEvent) => void): Promise<ImportResult>;
  /** Abort in-flight downloads; the pending `run` rejects with an AbortError. */
  cancel(): void;
}

const WARNING_SAMPLE = 5;
let controller: AbortController | undefined;

function countsOf(o: { factions?: unknown[]; datasheets?: unknown[]; abilities?: unknown[]; detachments?: unknown[]; enhancements?: unknown[]; stratagems?: unknown[]; priceRules?: unknown[]; wargearPrices?: unknown[] }): SourceCounts {
  const n = (x: unknown[] | undefined): number => x?.length ?? 0;
  return { factions: n(o.factions), datasheets: n(o.datasheets), abilities: n(o.abilities), detachments: n(o.detachments), enhancements: n(o.enhancements), stratagems: n(o.stratagems), priceRules: n(o.priceRules), wargearPrices: n(o.wargearPrices) };
}

function abortError(): Error {
  const e = new Error("Import cancelled");
  e.name = "AbortError";
  return e;
}

/**
 * A source the run had to download because the snapshot is built from it did not answer. The run
 * stops its other downloads, which would otherwise report the stop as the reason it ended.
 */
function missingSourceError(): Error {
  const e = new Error("This snapshot is built from a source that could not be fetched, so nothing was changed.");
  e.name = "MissingSourceError";
  return e;
}

/** Zod errors carry hundreds of issues; keep the first few readable lines. */
function tidy(err: unknown): Error {
  if (err instanceof Error && err.name === "AbortError") return err;
  const issues = (err as { issues?: Array<{ path: Array<string | number>; message: string }> })?.issues;
  if (Array.isArray(issues) && issues.length) {
    const lines = issues.slice(0, 3).map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
    return new Error(`Snapshot validation failed: ${lines.join("; ")}${issues.length > 3 ? ` (+${issues.length - 3} more)` : ""}`);
  }
  return err instanceof Error ? err : new Error(String(err));
}

/** A source that took part in the merge, and the files it was parsed from when they are newly downloaded. */
interface Part {
  out: AdapterOutput;
  files?: Record<string, string>;
}

async function fetchAndParse(id: BrowserSourceId, request: ImportRequest, fetchedAt: string, signal: AbortSignal, emit: (e: ImportEvent) => void): Promise<Part> {
  const fetchImpl: FetchLike = (url, init) => fetch(url, { ...(init ?? {}), signal });
  const filter = id === "bsdata-json" ? catalogueFilter(request.catalogueFilter ?? "") : undefined;
  // Wahapedia's own server sends no CORS headers, so the browser reads a mirror of its export.
  const mirror = id === MIRRORED_SOURCE && request.wahapediaMirror ? [request.wahapediaMirror] : undefined;
  let fetched: Awaited<ReturnType<typeof fetchSource>>;
  try {
    fetched = await fetchSource(id, fetchImpl, {
      onProgress: ({ index, total }) => emit({ type: "downloading", source: id, index, total }),
      ...(filter ? { filter } : {}),
      ...(mirror ? { urls: mirror } : {}),
    });
  } catch (e) {
    if (!signal.aborted) emit({ type: "failed", source: id, message: e instanceof Error ? e.message : String(e) });
    throw e;
  }
  if (signal.aborted) throw abortError();
  const files = Object.keys(fetched.files).length;
  emit({ type: "parsing", source: id, files, ...(fetched.ref ? { ref: fetched.ref } : {}) });
  const parseOpts: ParseOptions = { gameSystemId: request.gameSystemId, fetchedAt, url: fetched.url };
  if (fetched.ref) parseOpts.ref = fetched.ref;
  const out = SOURCES[id].adapter.parse(fetched.files, parseOpts);
  emit({ type: "parsed", source: id, warnings: out.warnings.length, sample: out.warnings.slice(0, WARNING_SAMPLE), counts: countsOf(out), ...(out.sourceRef.ref ? { ref: out.sourceRef.ref } : {}) });
  return { out, files: fetched.files };
}

/**
 * The files each source of the snapshot being refreshed was last downloaded as, for the sources this
 * run is not fetching. A source with nothing kept here is left out, and the caller downloads it.
 */
async function heldFiles(request: ImportRequest): Promise<Map<BrowserSourceId, SourceFilesRecord>> {
  const held = new Map<BrowserSourceId, SourceFilesRecord>();
  const asked = new Set(request.sources);
  for (const stored of request.base ?? []) {
    const id = stored.adapter as BrowserSourceId;
    if (asked.has(id) || held.has(id) || !BROWSER_SOURCES.includes(id)) continue;
    try {
      const rec = await readSourceFiles(request.gameSystemId, id);
      if (rec) held.set(id, rec);
    } catch {
      // The store cannot be read, so the source is downloaded.
    }
  }
  return held;
}

/** Re-read a source from the files already here, stamped with the download they came from. */
function parseHeld(rec: SourceFilesRecord, gameSystemId: string): AdapterOutput {
  const opts: ParseOptions = { gameSystemId, fetchedAt: rec.fetchedAt, url: rec.url };
  if (rec.ref) opts.ref = rec.ref;
  return SOURCES[rec.adapter as BrowserSourceId].adapter.parse(rec.files, opts);
}

/**
 * Keep what a run downloaded, so the next fetch of one source can read the others back.
 *
 * By the time this is called the run has a finished snapshot to hand back, and the files only save
 * work on the next fetch. Nothing here is allowed to fail the run, so a browser that will not take
 * them costs the next fetch a download and nothing else.
 */
async function keepFiles(gameSystemId: string, parts: Part[]): Promise<void> {
  for (const p of parts) {
    if (!p.files) continue;
    try {
      await putSourceFiles({ gameSystemId, adapter: p.out.sourceRef.adapter, files: p.files, url: p.out.sourceRef.url ?? "", fetchedAt: p.out.sourceRef.fetchedAt, ...(p.out.sourceRef.ref ? { ref: p.out.sourceRef.ref } : {}) });
    } catch {
      // Nothing is kept for this source. The next fetch of it downloads what it needs.
    }
  }
}

export const api: ImportWorkerApi = {
  async run(request, onEvent) {
    if (controller) throw new Error("An import is already running");
    const t0 = performance.now();
    const ctl = new AbortController();
    controller = ctl;
    const emit = (e: ImportEvent): void => {
      if (!ctl.signal.aborted) void onEvent(e);
    };
    try {
      const fetchedAt = new Date().toISOString();
      // Sources the run does not have to download are read back from the files already here. One
      // whose files will not parse is added to the download list, so a damaged record costs a
      // download and nothing else.
      const held = await heldFiles(request);
      const download = new Set(sourcesToFetch(request, (id) => held.get(id)));
      const reused: Part[] = [];
      for (const [id, rec] of held) {
        if (download.has(id)) continue;
        try {
          reused.push({ out: parseHeld(rec, request.gameSystemId) });
        } catch {
          download.add(id);
        }
      }
      const downloading = BROWSER_SOURCES.filter((id) => download.has(id));
      emit({ type: "planned", sources: downloading });
      if (ctl.signal.aborted) throw abortError();
      // A mirror is something the user set up, and it can be missing or stale in ways the other two
      // sources are not. Wahapedia failing costs a first import its rules text. Failing the whole
      // run over it would cost that import the snapshot entirely, so the run goes on without it and
      // says which source did not answer.
      //
      // A source the run is downloading only because the snapshot needs it is different. Going on
      // without it writes a snapshot missing everything that source carried, over a snapshot that
      // had it. The run stops instead and the stored snapshot is left alone.
      const asked = new Set(request.sources);
      const missingSources: MissingSource[] = [];
      const settled = await Promise.all(
        downloading.map(async (id) => {
          try {
            return await fetchAndParse(id, request, fetchedAt, ctl.signal, emit);
          } catch (e) {
            if (id === MIRRORED_SOURCE && asked.has(id) && !ctl.signal.aborted) {
              // Written onto the snapshot, so a screen opened days later can still say why it has no
              // stratagems and where the address that failed was.
              missingSources.push({ adapter: id, reason: e instanceof Error ? e.message : String(e), ...(request.wahapediaMirror ? { url: request.wahapediaMirror } : {}) });
              return undefined;
            }
            const reason = !asked.has(id) && !ctl.signal.aborted ? missingSourceError() : e;
            ctl.abort(); // stop the other source's downloads too
            throw reason;
          }
        }),
      );
      if (ctl.signal.aborted) throw abortError();
      const fetchedParts = settled.filter((p): p is Part => p !== undefined);
      // Canonical order, so the snapshot's source list reads the same whichever source was fetched.
      const parts = [...fetchedParts, ...reused].sort((a, b) => BROWSER_SOURCES.indexOf(a.out.sourceRef.adapter as BrowserSourceId) - BROWSER_SOURCES.indexOf(b.out.sourceRef.adapter as BrowserSourceId));
      if (!parts.length) throw new Error("Every source failed, so there is nothing to merge.");
      emit({ type: "merging" });
      const merge = mergeSources(parts.map((p) => p.out));
      // A catalogue filter limits which catalogues are downloaded. The factions the points source
      // added on its own have no datasheets left, so they go.
      if ((request.catalogueFilter ?? "").trim()) {
        const pruned = pruneFactionsWithoutDatasheets(merge.data);
        merge.data = pruned.data;
        if (pruned.removedFactions.length) merge.warnings.push(`Pruned ${pruned.removedFactions.length} factions without datasheets (catalogue filter).`);
      }
      emit({ type: "merged", conflicts: merge.conflicts.length, warnings: merge.warnings.length, unmatched: merge.unmatched.length });
      emit({ type: "building" });
      const sources = parts.map((p) => p.out.sourceRef);
      const snapshot = await buildSnapshot({ data: merge.data, sources, conflicts: merge.conflicts, label: request.label, missingSources });
      await keepFiles(request.gameSystemId, fetchedParts);
      const summary: ImportSummary = {
        snapshotId: snapshot.id,
        label: snapshot.label,
        checksum: snapshot.checksum,
        counts: countsOf(snapshot.data),
        conflicts: snapshot.conflicts.length,
        sources: snapshot.sources.map((s) => ({ adapter: s.adapter, ...(s.ref ? { ref: s.ref } : {}), ...(s.url ? { url: s.url } : {}) })),
        missingSources,
        elapsedMs: performance.now() - t0,
      };
      return { snapshot, summary };
    } catch (e) {
      if (e instanceof Error && e.name === "MissingSourceError") throw e;
      throw ctl.signal.aborted ? abortError() : tidy(e);
    } finally {
      if (controller === ctl) controller = undefined;
      // The callback is a proxy to a main-thread function; let Comlink drop its listener.
      try {
        (onEvent as unknown as Comlink.Remote<(e: ImportEvent) => void>)[Comlink.releaseProxy]();
      } catch {
        /* already gone */
      }
    }
  },
  cancel() {
    controller?.abort();
  },
};

Comlink.expose(api);
