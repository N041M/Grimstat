/**
 * The file a corpus of published lists is kept in.
 *
 * One JSON document, one list per entry, each with the write-up it came from. The CLI writes it and
 * the web app reads it — or the web app reads the saved write-ups directly and never needs the file.
 * Either way the same lists end up in the same shape, deduplicated the same way.
 */

import { z } from "zod";
import type { PublishedList, StoredPublishedList } from "./types";

export const PUBLISHED_LISTS_FORMAT = "grimstat-published-lists";
export const PUBLISHED_LISTS_VERSION = 1;

const Source = z.object({
  url: z.string().optional(),
  title: z.string().optional(),
  published: z.string().optional(),
  publication: z.string().optional(),
});

const Entry = z.object({
  heading: z.string().min(1),
  player: z.string().optional(),
  faction: z.string().optional(),
  detachments: z.array(z.string()).default([]),
  forceDisposition: z.string().optional(),
  placing: z.number().int().positive().optional(),
  listName: z.string().optional(),
  listText: z.string().min(1),
  source: Source.default({}),
  importedAt: z.string().default(""),
});

export const PublishedListsFile = z.object({
  format: z.literal(PUBLISHED_LISTS_FORMAT),
  version: z.literal(PUBLISHED_LISTS_VERSION),
  importedAt: z.string().optional(),
  lists: z.array(Entry),
});
export type PublishedListsFile = z.infer<typeof PublishedListsFile>;

export class PublishedListsError extends Error {}

/** Read a corpus file: JSON text or an already-parsed document. Throws `PublishedListsError` when it is not one. */
export function parsePublishedListsFile(input: unknown): StoredPublishedList[] {
  let doc: unknown = input;
  if (typeof input === "string") {
    try {
      doc = JSON.parse(input);
    } catch (e) {
      throw new PublishedListsError(`Not JSON: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  const parsed = PublishedListsFile.safeParse(doc);
  if (!parsed.success) throw new PublishedListsError(`Not a published-lists file: ${parsed.error.issues[0]?.message ?? "invalid"}`);
  return parsed.data.lists.map((l) => strip(l));
}

/** Drop the keys the schema defaulted to nothing, so a stored list carries only what was said. */
function strip(l: z.infer<typeof Entry>): StoredPublishedList {
  return {
    heading: l.heading,
    ...(l.player ? { player: l.player } : {}),
    ...(l.faction ? { faction: l.faction } : {}),
    detachments: l.detachments,
    ...(l.forceDisposition ? { forceDisposition: l.forceDisposition } : {}),
    ...(l.placing ? { placing: l.placing } : {}),
    ...(l.listName ? { listName: l.listName } : {}),
    listText: l.listText,
    source: l.source,
    importedAt: l.importedAt,
  };
}

export function stringifyPublishedListsFile(lists: readonly StoredPublishedList[], importedAt = new Date().toISOString()): string {
  return `${JSON.stringify({ format: PUBLISHED_LISTS_FORMAT, version: PUBLISHED_LISTS_VERSION, importedAt, lists }, null, 2)}\n`;
}

/**
 * The same list, published twice, is one list.
 *
 * Keyed on the player, the placing and the list text rather than on the article, because write-ups
 * run in parts and a bonus round often reprints what an earlier part already carried.
 */
export const publishedListKey = (l: PublishedList): string => `${l.player ?? ""}|${l.placing ?? ""}|${l.listText.replace(/\s+/g, " ").trim()}`;

/** Later entries win, so a re-import refreshes what it repeats. */
export function dedupePublishedLists<T extends PublishedList>(lists: readonly T[]): T[] {
  const seen = new Map<string, T>();
  for (const l of lists) seen.set(publishedListKey(l), l);
  return [...seen.values()];
}
