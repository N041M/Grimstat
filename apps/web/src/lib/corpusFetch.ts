/**
 * The published corpus, fetched onto this machine.
 *
 * The same policy as the terrain layouts: nothing ships in the app, the user fetches the dataset a
 * relay publishes, and the result records where it came from. The dataset's index names monthly
 * files, each an ordinary published-lists file, which are stored through the same path a dropped
 * file takes. A refresh replaces what the same source gave before, so a tournament the relay
 * re-read comes back as the relay now has it. A fetch that came back short of what its index named
 * replaces nothing, because a half-read corpus is indistinguishable from a corpus that has shrunk.
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

/**
 * How much one fetch will read. The index names one file per month, so 240 of them is twenty years
 * of tournaments, and a month of lists runs to a few hundred kilobytes. A relay that asks for more
 * than this is not publishing a corpus, and reading it would tie the browser up for as long as it
 * cared to keep going.
 */
export const MAX_CORPUS_FILES = 240;
export const MAX_CORPUS_CHARS = 8_000_000;

const INDEX_FILE_AT_END = new RegExp(`/?${CORPUS_INDEX_FILE.replace(/\./g, "\\.")}$`);

/** The directory the index lives in, with one trailing slash, whether the user typed the index file or not. */
export function corpusBase(url: string): string {
  // Trailing slashes come off first. A link copied from a browser's address bar can end
  // "index.json/", and the file has to sit at the end of the text to be taken off.
  const trimmed = url.trim().replace(/\/+$/, "").replace(INDEX_FILE_AT_END, "");
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

/** A body that came back longer than the cap, which is read no further. */
function tooLong(what: string, text: string): string {
  return `${what}: ${text.length} characters, more than the ${MAX_CORPUS_CHARS} this reads.`;
}

/** The index and every monthly file it names. A file that fails costs a warning rather than the fetch. */
export async function readCorpus(base: string, fetchImpl: FetchText, opts: CorpusFetchOptions = {}): Promise<CorpusRead> {
  const { signal, onProgress } = opts;
  if (signal?.aborted) throw new Error(CANCELLED);
  const indexUrl = `${base}${CORPUS_INDEX_FILE}`;
  const res = await fetchImpl(indexUrl);
  if (!res.ok) throw new Error(`GET ${indexUrl} -> HTTP ${res.status}`);
  const indexText = await res.text();
  if (indexText.length > MAX_CORPUS_CHARS) throw new Error(tooLong(CORPUS_INDEX_FILE, indexText));
  const index = parseCorpusIndex(indexText);
  if (index.files.length > MAX_CORPUS_FILES) throw new Error(`${CORPUS_INDEX_FILE} names ${index.files.length} files, more than the ${MAX_CORPUS_FILES} this reads.`);
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
      const text = await r.text();
      if (text.length > MAX_CORPUS_CHARS) {
        warnings.push(tooLong(file.name, text));
        continue;
      }
      lists.push(...parsePublishedListsFile(text));
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

/**
 * What a read did not bring back, measured against the index that named it. There is a line for
 * every file that failed and a line for lists that never arrived. An empty result means everything
 * the index named is here.
 */
export function corpusShortfall({ index, lists, warnings }: CorpusRead): string[] {
  const promised = index.files.reduce((n, f) => n + f.lists, 0);
  const short = promised - lists.length;
  return [...warnings, ...(short > 0 ? [`${short} of ${promised} lists did not arrive.`] : [])];
}

/** Thrown when a fetch came back short of what the index named. Nothing is stored when it does. */
export class CorpusIncomplete extends Error {
  readonly details: readonly string[];
  constructor(details: readonly string[]) {
    super(`The corpus came back short. ${details.join(" ")}`);
    this.name = "CorpusIncomplete";
    this.details = details;
  }
}

export interface CorpusFetch {
  readonly record: CorpusRecord;
  readonly added: number;
  readonly found: number;
  /** Lists this corpus carried before and no longer does, which the refresh took out. */
  readonly removed: number;
}

export async function fetchPublishedCorpus(url: string = DEFAULT_CORPUS_URL, opts: CorpusFetchOptions = {}, fetchImpl: FetchText = (u) => fetch(u, { headers: { Accept: "application/json, text/plain, */*" }, ...(opts.signal ? { signal: opts.signal } : {}) })): Promise<CorpusFetch> {
  const base = corpusBase(url);
  const read = await readCorpus(base, fetchImpl, opts);
  const { index, lists } = read;
  if (opts.signal?.aborted) throw new Error(CANCELLED);
  // A half-read corpus looks exactly like a corpus that has dropped everything that failed to
  // arrive, and storing it would take those lists off this machine. Nothing is stored unless the
  // whole of what the index names came back.
  const missing = corpusShortfall(read);
  if (missing.length) throw new CorpusIncomplete(missing);
  const { added, removed } = await replacePublishedLists(index.source.publication, lists);
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
  return { record, added, found: lists.length, removed };
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
