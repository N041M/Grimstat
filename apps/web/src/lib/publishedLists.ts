/**
 * Published tournament lists on the user's own machine.
 *
 * Two ways in, one shape stored: the corpus file the CLI writes, or a write-up page saved from the
 * browser and read here directly — the same parser, so the CLI is a convenience rather than a
 * requirement. Every list keeps where it came from; these are other people's lists.
 */

import { PublishedListsError, dedupePublishedLists, parseArticle, parsePublishedListsFile, publishedListKey, sourceOf, type StoredPublishedList } from "@grimstat/adapters";
import { db, notifyStoreChanged, type PublishedListRecord } from "../db";
import { fnv1a } from "./overrides";

/** The record id: a hash of what identifies a list, so importing it twice stores it once. */
export const publishedListId = (list: StoredPublishedList): string => `pl-${fnv1a(publishedListKey(list))}`;

export interface PublishedImport {
  /** Lists added that were not stored before. */
  readonly added: number;
  /** Lists in the file or page, duplicates included. */
  readonly found: number;
  readonly warnings: readonly string[];
}

/**
 * Read one file the user handed over: a corpus JSON, or a saved write-up.
 *
 * Decided on content rather than the name — a page saved as "article.txt" is still a page — with the
 * name kept as the write-up's title when the page has no better one to offer.
 */
export function readPublishedFile(name: string, text: string): { lists: StoredPublishedList[]; warnings: string[] } {
  const body = text.replace(/^\uFEFF/, "").trimStart();
  if (body.startsWith("{")) return { lists: parsePublishedListsFile(body), warnings: [] };
  if (!/<(?:html|article|h[1-4]|div|p)\b/i.test(body)) throw new PublishedListsError(`${name}: neither a published-lists file nor a saved page.`);
  const importedAt = new Date().toISOString();
  const article = parseArticle(body, sourceOf(body, name.replace(/\.[a-z]+$/i, "")));
  return { lists: article.lists.map((l) => ({ ...l, source: article.source, importedAt })), warnings: [...article.warnings] };
}

export async function storePublishedLists(lists: readonly StoredPublishedList[]): Promise<{ added: number }> {
  const records = dedupePublishedLists(lists).map((l) => ({ ...l, id: publishedListId(l) }));
  const existing = new Set((await db.publishedLists.bulkGet(records.map((r) => r.id))).filter(Boolean).map((r) => r!.id));
  await db.publishedLists.bulkPut(records);
  notifyStoreChanged("publishedLists");
  return { added: records.filter((r) => !existing.has(r.id)).length };
}

/** Import one file, whichever kind it is. Throws `PublishedListsError` when it is neither. */
export async function importPublishedFile(name: string, text: string): Promise<PublishedImport> {
  const { lists, warnings } = readPublishedFile(name, text);
  const { added } = lists.length ? await storePublishedLists(lists) : { added: 0 };
  return { added, found: lists.length, warnings };
}

/** Every stored list, most recently imported first. */
export async function listPublishedLists(): Promise<PublishedListRecord[]> {
  return db.publishedLists.orderBy("importedAt").reverse().toArray();
}

export async function clearPublishedLists(): Promise<void> {
  await db.publishedLists.clear();
  notifyStoreChanged("publishedLists");
}

/** The corpus grouped by the write-up it came from, for the Data page's table. */
export interface PublishedSourceRow {
  readonly key: string;
  readonly title: string;
  readonly publication?: string;
  readonly url?: string;
  readonly published?: string;
  readonly lists: number;
  readonly factions: readonly string[];
}

export function publishedSources(records: readonly PublishedListRecord[]): PublishedSourceRow[] {
  const rows = new Map<string, { title: string; publication?: string; url?: string; published?: string; lists: number; factions: Set<string> }>();
  for (const r of records) {
    const key = r.source.url ?? r.source.title ?? "?";
    const row = rows.get(key) ?? { title: r.source.title ?? r.source.url ?? "?", publication: r.source.publication, url: r.source.url, published: r.source.published, lists: 0, factions: new Set<string>() };
    row.lists++;
    if (r.faction) row.factions.add(r.faction);
    rows.set(key, row);
  }
  return [...rows.entries()].map(([key, r]) => ({ key, title: r.title, ...(r.publication ? { publication: r.publication } : {}), ...(r.url ? { url: r.url } : {}), ...(r.published ? { published: r.published } : {}), lists: r.lists, factions: [...r.factions].sort() }));
}
