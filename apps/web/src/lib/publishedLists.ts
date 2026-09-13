/**
 * Published tournament lists on the user's own machine.
 *
 * Lists arrive in three ways and are stored as one kind of record. The CLI writes a corpus file; a write-up
 * page saved from the browser is read here with the same parser, so the CLI is optional; and a
 * single list can be pasted in along with where it was seen. A saved copy of the write-ups feed
 * comes in the same way and becomes a checklist of which write-ups exist and which are already
 * stored. Every list keeps its source, since the lists belong to other players.
 */

import { PublishedListsError, dedupePublishedLists, feedSource, parseArticle, parseFeed, parsePublishedListsFile, pastedList, sourceOf, type FeedEntry, type PastedListInput, type StoredPublishedList } from "@grimstat/adapters";
import { db, notifyStoreChanged, publishedListId, type PublishedListRecord } from "../db";

/** The record id, declared beside the table it keys. */
export { publishedListId };

export interface PublishedImport {
  /** Lists added that were not stored before. */
  readonly added: number;
  /** Lists in the file or page, duplicates included. */
  readonly found: number;
  readonly warnings: readonly string[];
}

export type PublishedTextKind = "corpus" | "feed" | "page";

/** The first character of `body` at or after `from` that is not whitespace. */
const skipSpace = (body: string, from: number): number => {
  let i = from;
  while (i < body.length && /\s/.test(body[i]!)) i++;
  return i;
};

/**
 * Whether the document's first element is `<rss>` or `<feed>`, past an XML declaration and any
 * comments in front of it.
 *
 * The prologue is stepped over one piece at a time rather than matched by one pattern. A pattern
 * that allows a run of comments has to try every way of dividing that run up when what follows is
 * not a feed's opening tag, and the number of ways doubles with every comment, so a file of a few
 * hundred bytes can take hours to turn down. Every step here moves forward and never goes back, so
 * the work is proportional to the length of the text.
 */
function startsWithFeedTag(body: string): boolean {
  let i = 0;
  if (/^<\?xml/i.test(body)) {
    // The declaration runs to the first ">", which has to be the one closing "?>".
    const close = body.indexOf(">", 5);
    if (close < 0 || body[close - 1] !== "?") return false;
    i = skipSpace(body, close + 1);
  }
  while (body.startsWith("<!--", i)) {
    const end = body.indexOf("-->", i + 4);
    if (end < 0) return false;
    i = skipSpace(body, end + 3);
  }
  return /^<(?:rss|feed)\b/i.test(body.slice(i, i + 6));
}

/**
 * What a file the user handed over is, decided on content rather than the name — a page saved as
 * "article.txt" is still a page, and a feed saved as "feed.html" is still a feed.
 */
export function classifyPublishedText(text: string): PublishedTextKind | undefined {
  const body = text.replace(/^\uFEFF/, "").trimStart();
  if (body.startsWith("{")) return "corpus";
  if (startsWithFeedTag(body)) return "feed";
  if (/<(?:html|article|h[1-4]|div|p)\b/i.test(body)) return "page";
  return undefined;
}

/**
 * Read one file the user handed over: a corpus JSON, or a saved write-up.
 *
 * The name is kept as the write-up's title when the page has no better one to offer. A feed is
 * refused here rather than misread as a page, since it goes through `readPublishedFeed`.
 */
export function readPublishedFile(name: string, text: string): { lists: StoredPublishedList[]; warnings: string[] } {
  const body = text.replace(/^\uFEFF/, "").trimStart();
  const kind = classifyPublishedText(body);
  if (kind === "corpus") return { lists: parsePublishedListsFile(body), warnings: [] };
  if (kind === "feed") throw new PublishedListsError(`${name}: a feed, not a write-up — load it as a feed.`);
  if (kind !== "page") throw new PublishedListsError(`${name}: neither a published-lists file nor a saved page.`);
  const importedAt = new Date().toISOString();
  const article = parseArticle(body, sourceOf(body, name.replace(/\.[a-z]+$/i, "")));
  return { lists: article.lists.map((l) => ({ ...l, source: article.source, importedAt })), warnings: [...article.warnings] };
}

/**
 * The address to link a write-up at, or nothing when it is not one a browser opens.
 *
 * Addresses arrive with imported data — a fetched corpus, a saved page, a pasted list — so one that
 * is not an ordinary web address is shown as plain text instead of as a link.
 */
export function webHref(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const parsed = new URL(url.trim());
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.href : undefined;
  } catch {
    return undefined;
  }
}

/** Where a stored list came from, which decides whether a corpus refresh may replace it. */
export type PublishedOrigin = NonNullable<PublishedListRecord["origin"]>;

export async function storePublishedLists(lists: readonly StoredPublishedList[], origin: PublishedOrigin = "hand"): Promise<{ added: number }> {
  const records = dedupePublishedLists(lists).map((l) => ({ ...l, id: publishedListId(l) }));
  const existing = new Map((await db.publishedLists.bulkGet(records.map((r) => r.id))).filter((r): r is PublishedListRecord => !!r).map((r) => [r.id, r] as const));
  // A list the user imported by hand stays theirs when a corpus turns out to carry the same one, so
  // a later refresh that has dropped it does not take their copy with it.
  const stored = records.map((r) => ({ ...r, origin: origin === "corpus" && existing.get(r.id)?.origin === "hand" ? ("hand" as const) : origin }));
  await db.publishedLists.bulkPut(stored);
  notifyStoreChanged("publishedLists");
  return { added: stored.filter((r) => !existing.has(r.id)).length };
}

/**
 * Store what one publication's corpus now says, in place of what it said before.
 *
 * A list this corpus put here before and no longer carries is removed, so a fetched corpus follows
 * its relay. Lists the user imported by hand are left where they are, and so are lists from any
 * other publication.
 */
export async function replacePublishedLists(publication: string, lists: readonly StoredPublishedList[]): Promise<{ added: number; removed: number }> {
  const keep = new Set(dedupePublishedLists(lists).map((l) => publishedListId(l)));
  const gone = await db.publishedLists.filter((r) => r.origin === "corpus" && r.source.publication === publication && !keep.has(r.id)).primaryKeys();
  if (gone.length) {
    await db.publishedLists.bulkDelete(gone);
    await db.publishedResolved.where("recordId").anyOf(gone).delete();
  }
  const { added } = lists.length ? await storePublishedLists(lists, "corpus") : { added: 0 };
  if (gone.length && !lists.length) notifyStoreChanged("publishedLists");
  return { added, removed: gone.length };
}

/** Import one file, whichever kind it is. Throws `PublishedListsError` when it is neither. */
export async function importPublishedFile(name: string, text: string): Promise<PublishedImport> {
  const { lists, warnings } = readPublishedFile(name, text);
  const { added } = lists.length ? await storePublishedLists(lists) : { added: 0 };
  return { added, found: lists.length, warnings };
}

/** Store a list the user pasted, with what they said about it. Nothing when the text held no list. */
export async function importPastedList(input: PastedListInput): Promise<{ list: StoredPublishedList; added: number } | undefined> {
  const list = pastedList(input);
  if (!list) return undefined;
  const stored: StoredPublishedList = { ...list, importedAt: new Date().toISOString() };
  const { added } = await storePublishedLists([stored]);
  return { list: stored, added };
}

/** Every stored list, most recently imported first. */
export async function listPublishedLists(): Promise<PublishedListRecord[]> {
  return db.publishedLists.orderBy("importedAt").reverse().toArray();
}

export async function clearPublishedLists(): Promise<void> {
  await db.publishedLists.clear();
  await db.publishedResolved.clear();
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
  let unnamed = 0;
  for (const r of records) {
    // A write-up with neither a link nor a title cannot be told from another one, so each gets a
    // row of its own rather than every anonymous list piling into a single "?".
    const key = r.source.url ?? r.source.title ?? `?${(unnamed += 1)}`;
    const row = rows.get(key) ?? { title: r.source.title ?? r.source.url ?? "?", publication: r.source.publication, url: r.source.url, published: r.source.published, lists: 0, factions: new Set<string>() };
    row.lists++;
    if (r.faction) row.factions.add(r.faction);
    rows.set(key, row);
  }
  return [...rows.entries()].map(([key, r]) => ({ key, title: r.title, ...(r.publication ? { publication: r.publication } : {}), ...(r.url ? { url: r.url } : {}), ...(r.published ? { published: r.published } : {}), lists: r.lists, factions: [...r.factions].sort() }));
}

/* ---- the write-ups feed ---------------------------------------------------------------------- */

/**
 * A write-ups feed the user saved and loaded, with what it listed and when. It is kept in the settings
 * store so the checklist survives a reload, and the next feed loaded replaces it whole.
 */
export interface PublishedFeed {
  readonly title?: string;
  readonly url?: string;
  readonly loadedAt: string;
  readonly entries: readonly FeedEntry[];
}

export function readPublishedFeed(text: string, loadedAt = new Date().toISOString()): PublishedFeed {
  return { ...feedSource(text), loadedAt, entries: parseFeed(text) };
}

/** The stored feed, if what is in the settings store still has the shape of one; null is "none". */
export function parsePublishedFeed(raw: unknown): PublishedFeed | null | undefined {
  if (raw === null) return null;
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  if (typeof r["loadedAt"] !== "string" || !Array.isArray(r["entries"])) return undefined;
  const entries: FeedEntry[] = [];
  for (const e of r["entries"]) {
    if (!e || typeof e !== "object") continue;
    const it = e as Record<string, unknown>;
    if (typeof it["title"] !== "string" || typeof it["url"] !== "string") continue;
    entries.push({ title: it["title"], url: it["url"], ...(typeof it["published"] === "string" ? { published: it["published"] } : {}), isWarhammer40k: it["isWarhammer40k"] === true });
  }
  return { ...(typeof r["title"] === "string" ? { title: r["title"] } : {}), ...(typeof r["url"] === "string" ? { url: r["url"] } : {}), loadedAt: r["loadedAt"], entries };
}

export interface FeedRow {
  readonly entry: FeedEntry;
  /** Lists stored from this write-up. */
  readonly lists: number;
}

/** The path of a link, which still identifies the write-up after a publication moves domains. */
const pathOf = (url: string | undefined): string | undefined => {
  if (!url) return undefined;
  const path = (/^(?:[a-z][a-z0-9+.-]*:\/\/)?[^/?#]*([^?#]*)/i.exec(url.trim())?.[1] ?? "").replace(/\/+$/, "").toLowerCase();
  return path || undefined;
};

/** A title with the game tag a feed prefixes it with — "[40k]" — taken off, so it matches the page's own. */
const titleKey = (title: string | undefined): string | undefined => title?.replace(/^\s*\[[^\]]*\]\s*/, "").trim().toLowerCase() || undefined;

/**
 * Each Warhammer 40,000 write-up in the feed, with how many of its lists are stored. Matched by the
 * link's path, or, failing that, by title; the other games' write-ups are the caller's to count.
 */
export function feedChecklist(feed: PublishedFeed, records: readonly PublishedListRecord[]): FeedRow[] {
  const byPath = new Map<string, number>();
  const byTitle = new Map<string, number>();
  for (const r of records) {
    const p = pathOf(r.source.url);
    if (p) byPath.set(p, (byPath.get(p) ?? 0) + 1);
    const k = titleKey(r.source.title);
    if (k) byTitle.set(k, (byTitle.get(k) ?? 0) + 1);
  }
  return feed.entries
    .filter((e) => e.isWarhammer40k)
    .map((entry) => {
      const p = pathOf(entry.url);
      const k = titleKey(entry.title);
      return { entry, lists: (p && byPath.get(p)) || (k && byTitle.get(k)) || 0 };
    });
}
