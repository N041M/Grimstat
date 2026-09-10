/// <reference lib="webworker" />
import * as Comlink from "comlink";
import type { Snapshot } from "@grimstat/schema";
import { SOURCES, fetchSource, type AdapterOutput, type FetchLike, type ParseOptions } from "@grimstat/adapters";
import { buildSnapshot, mergeSources, pruneFactionsWithoutDatasheets } from "@grimstat/snapshot";
import { catalogueFilter, type BrowserSourceId, type ImportEvent, type ImportRequest, type ImportSummary, type SourceCounts } from "../lib/importProgress";

/**
 * Browser-side counterpart of `apps/cli/src/commands/import.ts`: fetch every selected source straight from
 * GitHub (CORS-enabled hosts only), parse per source, merge, build a checksummed Snapshot. Runs in a
 * Web Worker so the multi-megabyte parse/merge never blocks the UI; progress goes back through a
 * Comlink-proxied callback. Overrides are not applied here — the app applies them when it reads a snapshot.
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

async function fetchAndParse(id: BrowserSourceId, request: ImportRequest, fetchedAt: string, signal: AbortSignal, emit: (e: ImportEvent) => void): Promise<AdapterOutput> {
  const fetchImpl: FetchLike = (url, init) => fetch(url, { ...(init ?? {}), signal });
  const filter = id === "bsdata-json" ? catalogueFilter(request.catalogueFilter ?? "") : undefined;
  let fetched: Awaited<ReturnType<typeof fetchSource>>;
  try {
    fetched = await fetchSource(id, fetchImpl, {
      onProgress: ({ index, total }) => emit({ type: "downloading", source: id, index, total }),
      ...(filter ? { filter } : {}),
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
  return out;
}

const api: ImportWorkerApi = {
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
      const parts = await Promise.all(request.sources.map((id) => fetchAndParse(id, request, fetchedAt, ctl.signal, emit))).catch((e: unknown) => {
        ctl.abort(); // stop the other source's downloads too
        throw e;
      });
      if (ctl.signal.aborted) throw abortError();
      emit({ type: "merging" });
      const merge = mergeSources(parts);
      // a catalogue filter limits the structure source; drop the factions the points source added on its own
      if ((request.catalogueFilter ?? "").trim()) {
        const pruned = pruneFactionsWithoutDatasheets(merge.data);
        merge.data = pruned.data;
        if (pruned.removedFactions.length) merge.warnings.push(`Pruned ${pruned.removedFactions.length} factions without datasheets (catalogue filter).`);
      }
      emit({ type: "merged", conflicts: merge.conflicts.length, warnings: merge.warnings.length, unmatched: merge.unmatched.length });
      emit({ type: "building" });
      const snapshot = await buildSnapshot({ data: merge.data, sources: parts.map((p) => p.sourceRef), conflicts: merge.conflicts, label: request.label });
      const summary: ImportSummary = {
        snapshotId: snapshot.id,
        label: snapshot.label,
        checksum: snapshot.checksum,
        counts: countsOf(snapshot.data),
        conflicts: snapshot.conflicts.length,
        sources: snapshot.sources.map((s) => ({ adapter: s.adapter, ...(s.ref ? { ref: s.ref } : {}), ...(s.url ? { url: s.url } : {}) })),
        elapsedMs: performance.now() - t0,
      };
      return { snapshot, summary };
    } catch (e) {
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
