/**
 * Pulling published army lists out of a tournament write-up.
 *
 * The article is supplied by the caller — saved from a browser, or pasted. This module never fetches:
 * the write-up pages sit behind a bot challenge their publisher deliberately put there, and getting
 * past it would mean pretending to be a browser. Reading a page you opened yourself and handing it to
 * a local tool is a different thing entirely, and it is the only thing supported here.
 */

import { stripHtml } from "../util/html";
import type { ArticleSource, PublishedArticle, PublishedList } from "./types";

/**
 * A list heading: `Player - Faction (Detachment/Detachment) - Force Disposition - 1st Place`.
 *
 * Every part after the player is optional in practice — headings drop the disposition, carry a note
 * in brackets after the placing, or name a team instead of a player — so the only thing required is
 * the placing, which is what makes a heading a *result* rather than a section title.
 */
const HEADING = /^(?<player>.+?)\s+[-–—]\s+(?<rest>.+?)\s+[-–—]\s+(?<place>\d+)(?:st|nd|rd|th)\s+Place\b/i;
/** The faction part of a heading, with its detachments in brackets after it. */
const FACTION = /^(?<faction>.+?)\s*(?:\((?<dets>[^)]*)\))?$/;
/** A list's own first line, as the official app writes it. */
const LIST_NAME = /^(?<name>.+?)\s*\(\s*[\d,]+\s*(?:points?|pts?)\s*\)\s*$/i;

/** Anything that reads as a heading but has no placing is a section title, not a result. */
export function parseHeading(heading: string): Omit<PublishedList, "listText"> | undefined {
  const m = HEADING.exec(heading.trim());
  if (!m?.groups) return undefined;
  const { player, rest, place } = m.groups as Record<string, string>;

  // What sits between the faction and the placing is the disposition, when the heading gave one.
  const parts = rest!.split(/\s+[-–—]\s+/);
  const factionPart = parts[0] ?? "";
  const disposition = parts.length > 1 ? parts[parts.length - 1]!.trim() : undefined;

  const fm = FACTION.exec(factionPart.trim());
  const detachments = (fm?.groups?.["dets"] ?? "")
    .split("/")
    .map((d) => d.trim())
    .filter(Boolean);

  return {
    heading: heading.trim(),
    player: player!.trim() || undefined,
    faction: fm?.groups?.["faction"]?.trim() || undefined,
    detachments,
    ...(disposition ? { forceDisposition: disposition } : {}),
    placing: Number(place),
  };
}

/**
 * Every list in one article, each paired with the heading above it.
 *
 * Structure rather than styling: a heading element carrying a placing, then the next collapsible
 * body after it. Matching on the class names a publication happens to use today would break the
 * first time they restyle; a heading followed by a block of list text will not.
 */
export function parseArticle(html: string, source: ArticleSource = {}): PublishedArticle {
  const lists: PublishedList[] = [];
  const warnings: string[] = [];

  const blocks = splitOnHeadings(html);
  for (const { heading, body } of blocks) {
    const meta = parseHeading(heading);
    if (!meta) continue;
    const listText = extractList(body);
    if (!listText) {
      warnings.push(`No list found under "${heading}".`);
      continue;
    }
    const first = listText.split("\n", 1)[0]?.trim() ?? "";
    const named = LIST_NAME.exec(first);
    lists.push({ ...meta, ...(named?.groups?.["name"] ? { listName: named.groups["name"].trim() } : {}), listText });
  }

  if (blocks.length && !lists.length) warnings.push("No list headings recognised — is this a tournament write-up?");
  return { source, lists, warnings };
}

/** The article cut at every heading element, each heading paired with what follows it. */
function splitOnHeadings(html: string): { heading: string; body: string }[] {
  const out: { heading: string; body: string }[] = [];
  const re = /<h[1-4]\b[^>]*>([\s\S]*?)<\/h[1-4]>/gi;
  const marks: { text: string; end: number; start: number }[] = [];
  for (let m = re.exec(html); m; m = re.exec(html)) marks.push({ text: stripHtml(m[1]!), start: m.index, end: re.lastIndex });
  for (let i = 0; i < marks.length; i++) {
    const here = marks[i]!;
    // A list belongs to the heading above it, so a block runs to the next heading that is a result.
    const next = marks.slice(i + 1).find((n) => parseHeading(n.text));
    out.push({ heading: here.text, body: html.slice(here.end, next ? next.start : html.length) });
  }
  return out;
}

/**
 * The list text inside one block.
 *
 * Publications hide long lists behind a "click to expand" control, so the list is whatever the
 * largest run of list-looking lines in the block is. Recognising it by content — points costs and
 * wargear bullets — rather than by the markup around it is what keeps this working when the markup
 * changes, and what lets the same function read a list someone simply pasted.
 */
export function extractList(body: string): string | undefined {
  const text = stripHtml(body);
  if (!text) return undefined;

  let best: string[] = [];
  let run: string[] = [];
  let prose = 0;

  const close = () => {
    while (run.length && !run[run.length - 1]!.trim()) run.pop();
    if (run.length > best.length) best = run;
    run = [];
    prose = 0;
  };

  for (const line of text.split("\n")) {
    const t = line.trim();
    // Markup leaves blank lines between every paragraph; they are spacing, not prose, and counting
    // them as prose cuts every list off after its first two entries.
    if (!t) {
      if (run.length) run.push(line);
      continue;
    }
    if (looksLikeList(t)) {
      prose = 0;
      run.push(line);
      continue;
    }
    if (!run.length) continue;
    // Plain lines inside a list are real — faction, detachment, disposition, section headings — so a
    // run only ends after several in a row.
    if (++prose > PROSE_TOLERANCE) {
      close();
      continue;
    }
    run.push(line);
  }
  close();

  const result = best.join("\n").trim();
  // Two costed lines is the floor: one alone is a heading that happened to mention points.
  return (result.match(COSTED) ?? []).length >= 2 ? result : undefined;
}

/** Consecutive plain lines a list may contain before the run is judged to have ended. */
const PROSE_TOLERANCE = 3;

/**
 * A parenthetical cost: "(95 points)", "(1,000 pts)", and the app's "(3 Detachment Points)" — the
 * last matters because it is the line between a list's header and its units, and treating it as
 * prose splits the list in two.
 */
const COSTED = /\(\s*[\d,]+\s*[A-Za-z ]*?(?:points?|pts?)\s*\)/gi;

const looksLikeList = (line: string): boolean => new RegExp(COSTED.source, "i").test(line) || /^[\u2022\u25e6\u25aa\u2023\u00b7-]/.test(line) || /^\d+\s*[x\u00d7]\s+\S/.test(line);
