/**
 * The published corpus, fetched onto this machine.
 *
 * The same policy as the terrain layouts: nothing ships in the app, the user fetches the dataset a
 * relay publishes, and the result records where it came from. The dataset's index names monthly
 * files, each an ordinary published-lists file, which are stored through the same path a dropped
 * file takes. A refresh replaces what the same source gave before, so a tournament the relay
 * re-read comes back as the relay now has it.
 */

import { CORPUS_INDEX_FILE, parseCorpusIndex, parsePublishedListsFile, type CorpusIndex, type StoredPublishedList } from "@grimstat/adapters";
import { replacePublishedLists } from "./publishedLists";

/** Where the relay publishes the corpus. A setting can point elsewhere, for a relay of your own. */
export const DEFAULT_CORPUS_URL = "https://raw.githubusercontent.com/N041M/grimstat-corpus/main/";
export const CORPUS_URL_SETTING = "data.published.corpusUrl";
export const CORPUS_SETTING = "data.published.corpus";

/** What the last fetch brought, kept so the panel can say so. */
export interface CorpusRecord {
  readonly url: string;
  readonly generatedAt: string;
  readonly fetchedAt: string;
  readonly lists: number;
  readonly tournaments: number;
  readonly sourceName: string;
  readonly sourceUrl: string;
  readonly publication: string;
  readonly attribution: string;
  readonly months: readonly string[];
}

export type FetchText = (url: string) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

/** The directory the index lives in, with one trailing slash, whether the user typed the index file or not. */
export function corpusBase(url: string): string {
  const trimmed = url.trim().replace(new RegExp(`/?${CORPUS_INDEX_FILE.replace(".", "\\.")}$`), "");
  return trimmed.replace(/\/+$/, "") + "/";
}

export interface CorpusRead {
  readonly index: CorpusIndex;
  readonly lists: readonly StoredPublishedList[];
  readonly warnings: readonly string[];
}

/** Thrown when the signal a caller passed in is aborted while the fetch is running. */
export const CANCELLED = "cancelled";

export interface CorpusFetchOptions {
  /** Aborting it stops the fetch before the next file and before anything is stored. */
  readonly signal?: AbortSignal;
  /** Monthly files read so far, of the number the index names. Called once with 0 when the total becomes known. */
  readonly onProgress?: (done: number, total: number) => void;
}

/** The index and every monthly file it names. A file that fails costs a warning rather than the fetch. */
export async function readCorpus(base: string, fetchImpl: FetchText, opts: CorpusFetchOptions = {}): Promise<CorpusRead> {
  const { signal, onProgress } = opts;
  if (signal?.aborted) throw new Error(CANCELLED);
  const indexUrl = `${base}${CORPUS_INDEX_FILE}`;
  const res = await fetchImpl(indexUrl);
  if (!res.ok) throw new Error(`GET ${indexUrl} -> HTTP ${res.status}`);
  const index = parseCorpusIndex(await res.text());
  const lists: StoredPublishedList[] = [];
  const warnings: string[] = [];
  const total = index.files.length;
  let done = 0;
  onProgress?.(done, total);
  for (const file of index.files) {
    if (signal?.aborted) throw new Error(CANCELLED);
    const url = `${base}${file.name}`;
    try {
      const r = await fetchImpl(url);
      if (!r.ok) {
        warnings.push(`${file.name}: HTTP ${r.status}`);
        continue;
      }
      lists.push(...parsePublishedListsFile(await r.text()));
    } catch (e) {
      // A cancelled fetch ends the run; anything else costs this file a warning.
      if (signal?.aborted) throw e;
      warnings.push(`${file.name}: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      done += 1;
      onProgress?.(done, total);
    }
  }
  return { index, lists, warnings };
}

export interface CorpusFetch {
  readonly record: CorpusRecord;
  readonly added: number;
  readonly found: number;
  readonly warnings: readonly string[];
}

export async function fetchPublishedCorpus(url: string = DEFAULT_CORPUS_URL, opts: CorpusFetchOptions = {}, fetchImpl: FetchText = (u) => fetch(u, { headers: { Accept: "application/json, text/plain, */*" }, ...(opts.signal ? { signal: opts.signal } : {}) })): Promise<CorpusFetch> {
  const base = corpusBase(url);
  const { index, lists, warnings } = await readCorpus(base, fetchImpl, opts);
  if (opts.signal?.aborted) throw new Error(CANCELLED);
  const { added } = await replacePublishedLists(index.source.publication, lists);
  const record: CorpusRecord = {
    url: base,
    generatedAt: index.generatedAt,
    fetchedAt: new Date().toISOString(),
    lists: lists.length,
    tournaments: index.tournaments.length,
    sourceName: index.source.name,
    sourceUrl: index.source.url,
    publication: index.source.publication,
    attribution: index.source.attribution,
    months: index.files.map((f) => f.month),
  };
  return { record, added, found: lists.length, warnings };
}

/** The stored record, if what is in the settings store still has the shape of one; null is "none". */
export function parseCorpusRecord(raw: unknown): CorpusRecord | null | undefined {
  if (raw === null) return null;
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const str = (k: string): string | undefined => (typeof r[k] === "string" ? (r[k] as string) : undefined);
  const num = (k: string): number | undefined => (typeof r[k] === "number" ? (r[k] as number) : undefined);
  const url = str("url");
  const generatedAt = str("generatedAt");
  const fetchedAt = str("fetchedAt");
  const lists = num("lists");
  const tournaments = num("tournaments");
  if (!url || !generatedAt || !fetchedAt || lists === undefined || tournaments === undefined) return undefined;
  return {
    url,
    generatedAt,
    fetchedAt,
    lists,
    tournaments,
    sourceName: str("sourceName") ?? "",
    sourceUrl: str("sourceUrl") ?? "",
    publication: str("publication") ?? "",
    attribution: str("attribution") ?? "",
    months: Array.isArray(r["months"]) ? (r["months"] as unknown[]).filter((m): m is string => typeof m === "string") : [],
  };
}
