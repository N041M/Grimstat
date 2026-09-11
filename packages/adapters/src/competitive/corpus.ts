/**
 * The published corpus: a dataset of tournament lists, kept outside this repository and fetched
 * onto the user's machine like every other piece of game data.
 *
 * An index names the monthly files and the tournaments in them; each monthly file is an ordinary
 * published-lists file. The relay that builds it re-reads the index so a tournament is fetched once.
 */

import { z } from "zod";
import { PublishedListsError, dedupePublishedLists } from "./file";
import type { MinihqTournamentLists } from "./minihq";
import type { StoredPublishedList } from "./types";

export const CORPUS_FORMAT = "grimstat-corpus";
export const CORPUS_VERSION = 1;
export const CORPUS_INDEX_FILE = "index.json";

const CorpusSource = z.object({
  id: z.string(),
  name: z.string(),
  url: z.string(),
  publication: z.string(),
  attribution: z.string(),
  licence: z.string().optional(),
});

const CorpusFile = z.object({
  name: z.string(),
  /** YYYY-MM, the month the tournaments were played. */
  month: z.string(),
  lists: z.number().int().nonnegative(),
  tournaments: z.number().int().nonnegative(),
});

const CorpusTournament = z.object({
  slug: z.string(),
  name: z.string(),
  date: z.string(),
  url: z.string(),
  lists: z.number().int().nonnegative(),
  file: z.string(),
});

export const CorpusIndex = z.object({
  format: z.literal(CORPUS_FORMAT),
  version: z.literal(CORPUS_VERSION),
  generatedAt: z.string(),
  source: CorpusSource,
  files: z.array(CorpusFile),
  tournaments: z.array(CorpusTournament),
});
export type CorpusIndex = z.infer<typeof CorpusIndex>;
export type CorpusSource = z.infer<typeof CorpusSource>;

export function parseCorpusIndex(input: unknown): CorpusIndex {
  let doc: unknown = input;
  if (typeof input === "string") {
    try {
      doc = JSON.parse(input);
    } catch (e) {
      throw new PublishedListsError(`Not JSON: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  const parsed = CorpusIndex.safeParse(doc);
  if (!parsed.success) throw new PublishedListsError(`Not a corpus index: ${parsed.error.issues[0]?.message ?? "invalid"}`);
  return parsed.data;
}

export const stringifyCorpusIndex = (index: CorpusIndex): string => `${JSON.stringify(index, null, 2)}\n`;

export const corpusMonth = (date: string): string => date.slice(0, 7);
export const corpusFileName = (month: string): string => `lists-${month}.json`;

export function emptyCorpusIndex(source: CorpusSource, generatedAt = new Date().toISOString()): CorpusIndex {
  return { format: CORPUS_FORMAT, version: CORPUS_VERSION, generatedAt, source, files: [], tournaments: [] };
}

export interface CorpusUpdate {
  readonly index: CorpusIndex;
  /** Every monthly file's lists after the update, by file name; only touched files change. */
  readonly files: ReadonlyMap<string, readonly StoredPublishedList[]>;
  readonly touched: readonly string[];
}

/**
 * Fold a crawl's tournaments into the index and the monthly files.
 *
 * A tournament seen before is replaced, so a re-crawl refreshes it; its lists are deduplicated the
 * way every corpus is. The file summaries are recomputed from what is in the files afterwards.
 */
export function addToCorpus(index: CorpusIndex, files: ReadonlyMap<string, readonly StoredPublishedList[]>, batch: readonly MinihqTournamentLists[], generatedAt = new Date().toISOString()): CorpusUpdate {
  const next = new Map<string, StoredPublishedList[]>();
  for (const [name, lists] of files) next.set(name, [...lists]);
  const tournaments = new Map(index.tournaments.map((t) => [t.slug, t]));
  const touched = new Set<string>();

  for (const { tournament, lists } of batch) {
    const file = corpusFileName(corpusMonth(tournament.date));
    const url = lists[0]?.source.url ?? "";
    const previous = tournaments.get(tournament.slug);
    // A re-crawl replaces the tournament: its old lists go before the new ones come in.
    if (previous) {
      const old = next.get(previous.file) ?? [];
      next.set(
        previous.file,
        old.filter((l) => l.source.url !== url || l.source.title !== tournament.name),
      );
      touched.add(previous.file);
    }
    next.set(file, dedupePublishedLists([...(next.get(file) ?? []), ...lists]));
    touched.add(file);
    tournaments.set(tournament.slug, { slug: tournament.slug, name: tournament.name, date: tournament.date, url, lists: lists.length, file });
  }

  const sorted = [...tournaments.values()].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.slug.localeCompare(b.slug)));
  const perFile = new Map<string, number>();
  for (const t of sorted) perFile.set(t.file, (perFile.get(t.file) ?? 0) + 1);
  const summaries = [...next.entries()]
    .filter(([, lists]) => lists.length > 0)
    .map(([name, lists]) => ({ name, month: name.replace(/^lists-|\.json$/g, ""), lists: lists.length, tournaments: perFile.get(name) ?? 0 }))
    .sort((a, b) => (a.month < b.month ? 1 : a.month > b.month ? -1 : 0));

  return { index: { ...index, generatedAt, files: summaries, tournaments: sorted }, files: next, touched: [...touched].sort() };
}
