/**
 * A list the user pasted.
 *
 * The list may come from a tournament platform, a write-up or a message from a friend, none of which
 * this app fetches from. The result has the same shape as a list read out of a write-up: a heading
 * composed from the fields the user filled in, and the list text kept verbatim, so the corpus holds
 * one kind of record wherever a list was seen.
 */

import { LIST_NAME, extractList, looksLikeList } from "./article";
import type { ArticleSource, PublishedList } from "./types";

export interface PastedListInput {
  /** The list, and whatever came with it: a page's chrome around a list is dropped. */
  readonly listText: string;
  readonly player?: string;
  readonly faction?: string;
  /** As a heading writes them: "Ember Vanguard/Thorn Tide". */
  readonly detachments?: string;
  readonly forceDisposition?: string;
  readonly placing?: number;
  /** The event or write-up it was seen in. */
  readonly sourceTitle?: string;
  readonly sourceUrl?: string;
}

/** A pasted list with its provenance; the caller adds when it was imported. */
export interface PastedList extends PublishedList {
  readonly source: ArticleSource;
}

const ordinal = (n: number): string => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : n % 10 === 1 ? "st" : n % 10 === 2 ? "nd" : n % 10 === 3 ? "rd" : "th"}`;

const clean = (s: string | undefined): string | undefined => s?.trim() || undefined;

/**
 * The list behind the paste, or nothing when there is no list in it.
 *
 * The heading is composed the way a write-up would write it (player, faction with its detachments,
 * disposition, placing), so it reads back through `parseHeading` unchanged. When no field was filled
 * in, the list's own first line is used, because a record needs a heading to be listed under.
 */
export function pastedList(input: PastedListInput): PastedList | undefined {
  const extracted = extractList(input.listText);
  if (!extracted) return undefined;
  const listText = trimTail(extracted);
  if (!listText) return undefined;

  const player = clean(input.player);
  const faction = clean(input.faction);
  const detachments = (input.detachments ?? "")
    .split("/")
    .map((d) => d.trim())
    .filter(Boolean);
  const forceDisposition = clean(input.forceDisposition);
  const placing = input.placing !== undefined && Number.isInteger(input.placing) && input.placing > 0 ? input.placing : undefined;

  const dets = detachments.length ? `(${detachments.join("/")})` : "";
  const factionPart = faction ? `${faction}${dets ? ` ${dets}` : ""}` : dets || undefined;
  const first = listText.split("\n", 1)[0]?.trim() ?? "";
  const heading = [player, factionPart, forceDisposition, placing ? `${ordinal(placing)} Place` : undefined].filter((p): p is string => Boolean(p)).join(" - ") || first;
  const listName = LIST_NAME.exec(first)?.groups?.["name"]?.trim();

  const url = normaliseUrl(input.sourceUrl);
  const title = clean(input.sourceTitle);
  const publication = url ? hostOf(url) : undefined;
  const source: ArticleSource = { ...(title ? { title } : {}), ...(url ? { url } : {}), ...(publication ? { publication } : {}) };

  return {
    heading,
    ...(player ? { player } : {}),
    ...(faction ? { faction } : {}),
    detachments,
    ...(forceDisposition ? { forceDisposition } : {}),
    ...(placing ? { placing } : {}),
    ...(listName ? { listName } : {}),
    listText,
    source,
  };
}

/** Trailing lines after the last unit, such as "Exported with App Version…" or a page footer, are dropped. */
function trimTail(list: string): string {
  const lines = list.split("\n");
  while (lines.length && !looksLikeList(lines[lines.length - 1]!.trim())) lines.pop();
  return lines.join("\n").trim();
}

/** A link as typed, made absolute — "host/path" becomes "https://host/path" — or nothing when it is not link-shaped. */
export function normaliseUrl(raw: string | undefined): string | undefined {
  const s = raw?.trim();
  if (!s || /\s/.test(s)) return undefined;
  const url = /^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `https://${s}`;
  return /^https?:\/\/[^/?#]+\.[^/?#]+/i.test(url) ? url : undefined;
}

/** The host a link points at, without "www." — the publication, for grouping lists by where they were seen. */
const hostOf = (url: string): string | undefined => /^[a-z]+:\/\/(?:www\.)?([^/?#]+)/i.exec(url)?.[1]?.toLowerCase();

/* ---- prefilling ------------------------------------------------------------------------------ */

const SIZE = /^(?:combat patrol|incursion|strike force|onslaught)\s*\(/i;
/** The section titles the app prints above its units; the first one means the header is over. */
const SECTION = /^(?:characters?|epic heroes?|battleline|dedicated transports?|other datasheets?|allied units?|fortifications?)$/i;
/** An organiser's header line, or a rule of punctuation: not part of the app's header. */
const NOISE = /^\+|^[-=*#_~+ ]+$/;
const DETACHMENT_POINTS = /^(?<name>.+?)\s*\(\s*\d+\s*Detachment Points?\s*\)$/i;
const inCapitals = (s: string): boolean => s === s.toUpperCase() && /[A-Z]/.test(s);

export interface ListHeaderGuess {
  readonly faction?: string;
  readonly detachment?: string;
  readonly forceDisposition?: string;
}

/**
 * What the official app writes above the units, read for prefilling a form.
 *
 * The faction is the first plain line after the list's name. The detachment is the line costed in
 * Detachment Points or, in the older export, the plain line after the size line. A Force Disposition
 * is a line in capitals before the size line; capitals after it are section titles. The result is a
 * guess for the user to correct, and no record relies on it.
 */
export function guessListHeader(text: string): ListHeaderGuess {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const out: { faction?: string; detachment?: string; forceDisposition?: string } = {};
  let sized = false;
  for (let i = 0; i < lines.length && i < 12; i++) {
    const line = lines[i]!;
    if (i === 0 && LIST_NAME.test(line)) continue;
    if (NOISE.test(line)) continue;
    if (SECTION.test(line)) break;
    const dp = DETACHMENT_POINTS.exec(line);
    if (dp) {
      const name = dp.groups?.["name"]?.trim();
      if (name && !out.detachment) out.detachment = name;
      continue;
    }
    if (SIZE.test(line)) {
      sized = true;
      continue;
    }
    // A unit, its wargear, a count: the header is over.
    if (looksLikeList(line)) break;
    if (inCapitals(line)) {
      if (!sized && !out.forceDisposition) out.forceDisposition = line;
      continue;
    }
    if (!out.faction) out.faction = line;
    else if (sized && !out.detachment) out.detachment = line;
  }
  return out;
}
