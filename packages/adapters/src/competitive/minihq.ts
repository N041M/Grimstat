/**
 * MiniHeadQuarters, a tournament platform whose pages a machine may read.
 *
 * The platform publishes each ended tournament's army lists and results as plain server-rendered
 * pages. Its robots.txt restricts nothing and its terms say nothing about automated access. This
 * module reads those pages with a named user agent, one request at a time, only for tournaments
 * that have ended, and only for the ones not fetched before. Player names are dropped unless the
 * caller asks to keep them, since the corpus this feeds is published.
 */

import { stripHtml } from "../util/html";
import type { FetchLike } from "../sources";
import { guessListHeader, pastedList } from "./pasted";
import type { StoredPublishedList } from "./types";

export const MINIHQ = {
  id: "minihq",
  name: "MiniHeadQuarters",
  site: "https://miniheadquarters.com",
  publication: "miniheadquarters.com",
  /** The platform's id for Warhammer 40,000 in its game-system filter. */
  gameSystem40k: "1",
  pageSize: 48,
  userAgent: "Grimstat/0.1 (local-first Warhammer 40,000 statistics tool; +https://github.com/N041M/Grimstat)",
  attribution: "Army lists published by their players and tournament organisers on MiniHeadQuarters (miniheadquarters.com)",
} as const;

export const minihqUrls = {
  index: (page: number, gameSystem: string = MINIHQ.gameSystem40k): string => `${MINIHQ.site}/tournaments/individual/?page=${page}&game_system=${gameSystem}&status=STATUS_ENDED&page_size=${MINIHQ.pageSize}`,
  details: (slug: string): string => `${MINIHQ.site}/tournaments/individual/details/${slug}`,
  lists: (slug: string): string => `${MINIHQ.site}/tournaments/individual/army-lists/${slug}`,
  results: (slug: string): string => `${MINIHQ.site}/tournaments/individual/results/${slug}`,
} as const;

export interface MinihqTournament {
  readonly slug: string;
  readonly name: string;
  /** ISO date, YYYY-MM-DD. */
  readonly date: string;
  readonly game: string;
  readonly registrations?: number;
}

export interface MinihqResult {
  readonly placing: number;
  readonly player: string;
  readonly faction?: string;
}

export interface MinihqList {
  readonly player: string;
  readonly faction?: string;
  /** The list as plain text, empty when the player uploaded a picture instead. */
  readonly text: string;
}

/* ---- parsing --------------------------------------------------------------------------------- */

const text = (html: string | undefined): string => stripHtml(html).replace(/\s+/g, " ").trim();

const MONTHS: Record<string, string> = { jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12" };

/** The platform writes dates as "Sept. 5, 2026" or "March 14, 2026"; ISO dates pass through. */
export function parsePlatformDate(s: string | undefined): string | undefined {
  if (!s) return undefined;
  const t = s.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const m = /^([A-Za-z]+)\.?\s+(\d{1,2}),\s+(\d{4})$/.exec(t);
  const month = m && MONTHS[m[1]!.slice(0, 3).toLowerCase()];
  if (!m || !month) return undefined;
  return `${m[3]}-${month}-${m[2]!.padStart(2, "0")}`;
}

const CARD = /<a\s+href="(?:https?:\/\/[^/"]+)?\/tournaments\/individual\/details\/([a-z0-9-]+)"[^>]*>([\s\S]*?)<\/a>/gi;

/** The tournaments an index page lists, in the page's order, which is newest first. */
export function parseTournamentIndex(html: string): MinihqTournament[] {
  const out: MinihqTournament[] = [];
  for (const m of html.matchAll(CARD)) {
    const slug = m[1]!;
    const body = m[2]!;
    const name = text(/<h3[^>]*>([\s\S]*?)<\/h3>/i.exec(body)?.[1]);
    const fields = new Map<string, string>();
    for (const f of body.matchAll(/<dt[^>]*>([\s\S]*?)<\/dt>\s*<dd[^>]*>([\s\S]*?)<\/dd>/gi)) fields.set(text(f[1]).toLowerCase(), text(f[2]));
    const date = parsePlatformDate(fields.get("date"));
    if (!name || !date) continue;
    const reg = /^(\d+)\s*\/\s*\d+/.exec(fields.get("registrations") ?? "");
    out.push({ slug, name, date, game: fields.get("game") ?? "", ...(reg ? { registrations: Number(reg[1]) } : {}) });
  }
  return out;
}

/** How many tournaments the index holds in total, from its "Showing 1 - 48 tournaments of 513 total" line. */
export function parseIndexTotal(html: string): number | undefined {
  const m = /Showing\s+\d+\s*-\s*\d+\s+tournaments\s+of\s+(\d+)\s+total/i.exec(html);
  return m ? Number(m[1]) : undefined;
}

const ARTICLE = /<article\b[\s\S]*?<\/article>/gi;

/** "Swarm - Verdant Swarm" names the faction last; a single segment is the faction itself. */
const factionOf = (line: string | undefined): string | undefined => {
  const parts = (line ?? "")
    .split(/\s+-\s+/)
    .map((p) => p.trim())
    .filter(Boolean);
  return parts.length ? parts[parts.length - 1] : undefined;
};

/** The placings a results page lists: an article per player with the rank, a nickname and a faction line. */
export function parseResults(html: string): MinihqResult[] {
  const out: MinihqResult[] = [];
  for (const m of html.matchAll(ARTICLE)) {
    const a = m[0];
    const player = text(/<h2[^>]*>([\s\S]*?)<\/h2>/i.exec(a)?.[1]);
    const rank = /<div[^>]*>\s*(\d+)\s*<\/div>/i.exec(a)?.[1];
    if (!player || !rank) continue;
    const faction = factionOf(text(/<\/h2>\s*<p[^>]*>([\s\S]*?)<\/p>/i.exec(a)?.[1]));
    out.push({ placing: Number(rank), player, ...(faction ? { faction } : {}) });
  }
  return out;
}

/** The lists an army-lists page holds: an article per list with a heading of "nickname - faction" and the text. */
export function parseArmyLists(html: string): MinihqList[] {
  const out: MinihqList[] = [];
  for (const m of html.matchAll(ARTICLE)) {
    const a = m[0];
    const heading = text(/<button[^>]*data-accordion-button[^>]*>[\s\S]*?<span[^>]*>([\s\S]*?)<\/span>/i.exec(a)?.[1]);
    if (!heading) continue;
    const parts = heading
      .split(/\s+-\s+/)
      .map((p) => p.trim())
      .filter(Boolean);
    const player = parts[0] ?? heading;
    const faction = parts.length > 1 ? parts[parts.length - 1] : undefined;
    const panel = /<div[^>]*role="region"[^>]*>([\s\S]*?)<\/div>\s*<\/article>/i.exec(a)?.[1] ?? "";
    out.push({ player, ...(faction ? { faction } : {}), text: stripHtml(panel) });
  }
  return out;
}

/* ---- joining --------------------------------------------------------------------------------- */

/** Lines an organiser's header uses to name the player or their team. */
const NAME_LINE = /^\+*\s*(?:player|joueur|pseudo|name|nom|team|[ée]quipe)\b[^:]*:/i;

/** The list text with the lines naming a person removed. */
export const scrubNames = (listText: string): string =>
  listText
    .split("\n")
    .filter((line) => !NAME_LINE.test(line))
    .join("\n")
    .trim();

/** "+ DETACHMENT RULES: Ember Vanguard", as organisers' headers write it in either language. */
const HEADER_DETACHMENT = /^\+*\s*d[ée]tache?ments?[^:\n]*:\s*([^\n]+)/im;

const nick = (s: string): string => s.trim().toLowerCase();

export interface MinihqJoinOptions {
  readonly keepNames?: boolean;
  readonly importedAt?: string;
}

export interface MinihqTournamentLists {
  readonly tournament: MinihqTournament;
  readonly lists: readonly StoredPublishedList[];
  /** Lists with no readable text, usually a picture. */
  readonly skipped: number;
  /** Lists whose player does not appear in the results, so they carry no placing. */
  readonly unplaced: number;
}

/**
 * One tournament's lists with their placings, in the corpus shape.
 *
 * Lists and results are joined on the nickname, which the platform prints identically on both
 * pages. The list text goes through the same extractor a pasted list does, so organiser headers and
 * the app's sign-off fall away; the detachment is read from the app's own header or, failing that,
 * from the organiser's. Names are dropped unless asked for.
 */
export function joinTournament(tournament: MinihqTournament, lists: readonly MinihqList[], results: readonly MinihqResult[], opts: MinihqJoinOptions = {}): MinihqTournamentLists {
  const byPlayer = new Map(results.map((r) => [nick(r.player), r]));
  const importedAt = opts.importedAt ?? new Date().toISOString();
  const out: StoredPublishedList[] = [];
  let skipped = 0;
  let unplaced = 0;
  for (const l of lists) {
    const result = byPlayer.get(nick(l.player));
    const raw = opts.keepNames ? l.text : scrubNames(l.text);
    const guess = guessListHeader(raw);
    const detachment = guess.detachment ?? HEADER_DETACHMENT.exec(raw)?.[1]?.trim();
    const list = pastedList({
      listText: raw,
      ...(opts.keepNames ? { player: l.player } : {}),
      ...(l.faction ?? result?.faction ? { faction: l.faction ?? result?.faction } : {}),
      ...(detachment ? { detachments: detachment } : {}),
      ...(guess.forceDisposition ? { forceDisposition: guess.forceDisposition } : {}),
      ...(result ? { placing: result.placing } : {}),
      sourceTitle: tournament.name,
      sourceUrl: minihqUrls.lists(tournament.slug),
    });
    if (!list) {
      skipped++;
      continue;
    }
    if (!result) unplaced++;
    out.push({ ...list, source: { ...list.source, published: tournament.date }, importedAt });
  }
  return { tournament, lists: out, skipped, unplaced };
}

/* ---- crawling -------------------------------------------------------------------------------- */

export interface MinihqCrawlOptions {
  /** Only tournaments on or after this ISO date. */
  readonly since: string;
  /** Slugs fetched before, which are not fetched again. */
  readonly skip?: ReadonlySet<string>;
  /** Stop after this many tournaments. */
  readonly limit?: number;
  readonly keepNames?: boolean;
  /** Milliseconds between requests. The platform is a small site; one request a second is the default. */
  readonly delayMs?: number;
  readonly gameSystem?: string;
  readonly importedAt?: string;
  readonly log?: (line: string) => void;
}

export interface MinihqCrawl {
  readonly tournaments: readonly MinihqTournamentLists[];
  readonly requests: number;
  readonly warnings: readonly string[];
}

const IS_40K = /40[, ]?000|40k/i;

/**
 * Every ended 40k tournament since a date, with its lists and placings.
 *
 * The index is newest first, so paging stops at the first page whose last tournament is older than
 * the date. Each tournament costs two requests, and a page that answers badly costs a warning rather
 * than the crawl.
 */
export async function crawlMinihq(opts: MinihqCrawlOptions, fetchImpl: FetchLike = fetch as unknown as FetchLike): Promise<MinihqCrawl> {
  const log = opts.log ?? (() => undefined);
  const delayMs = opts.delayMs ?? 1000;
  const warnings: string[] = [];
  const tournaments: MinihqTournamentLists[] = [];
  let requests = 0;

  const get = async (url: string): Promise<string | undefined> => {
    if (requests > 0 && delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
    requests++;
    const res = await fetchImpl(url, { headers: { "user-agent": MINIHQ.userAgent, accept: "text/html" } });
    if (!res.ok) {
      warnings.push(`GET ${url} -> HTTP ${res.status}`);
      return undefined;
    }
    return res.text();
  };

  let pages: number | undefined;
  for (let page = 1; pages === undefined || page <= pages; page++) {
    const html = await get(minihqUrls.index(page, opts.gameSystem));
    if (html === undefined) throw new Error(`the tournament index could not be read (page ${page})`);
    const total = parseIndexTotal(html);
    pages ??= total !== undefined ? Math.max(1, Math.ceil(total / MINIHQ.pageSize)) : 1;
    const cards = parseTournamentIndex(html);
    if (!cards.length) break;
    let older = false;
    for (const t of cards) {
      if (t.date < opts.since) {
        older = true;
        continue;
      }
      if (t.game && !IS_40K.test(t.game)) continue;
      if (opts.skip?.has(t.slug)) continue;
      if (opts.limit !== undefined && tournaments.length >= opts.limit) return { tournaments, requests, warnings };
      log(`${t.date}  ${t.name}`);
      const listsHtml = await get(minihqUrls.lists(t.slug));
      const resultsHtml = await get(minihqUrls.results(t.slug));
      const joined = joinTournament(t, listsHtml ? parseArmyLists(listsHtml) : [], resultsHtml ? parseResults(resultsHtml) : [], { ...(opts.keepNames ? { keepNames: true } : {}), ...(opts.importedAt ? { importedAt: opts.importedAt } : {}) });
      log(`  ${joined.lists.length} lists${joined.skipped ? `, ${joined.skipped} unreadable` : ""}${joined.unplaced ? `, ${joined.unplaced} without a placing` : ""}`);
      tournaments.push(joined);
    }
    if (older) break;
  }
  return { tournaments, requests, warnings };
}
