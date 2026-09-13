import type { Snapshot, WeaponKeyword } from "@grimstat/schema";
import { parseKeywordText } from "./keywordParser";

/**
 * Completion and correction for the comma-separated keyword fields.
 *
 * A keyword field is one input holding a list, so everything here works on the token the caret sits
 * in rather than on the whole value. Matching is done on the canonical name the parser produces, so
 * "twin linked", "Twin-Linked" and "TWIN-LINKED" are one keyword, and only a real misspelling is
 * reported.
 */

/** The comma-separated token the caret sits in, and where it starts and ends in the text. */
export interface KeywordToken {
  start: number;
  end: number;
  /** The token with its surrounding spaces removed. */
  text: string;
}

export function tokenAt(text: string, caret: number): KeywordToken {
  const at = Math.max(0, Math.min(caret, text.length));
  const start = text.lastIndexOf(",", at - 1) + 1;
  const comma = text.indexOf(",", at);
  const end = comma < 0 ? text.length : comma;
  return { start, end, text: text.slice(start, end).trim() };
}

/** The same list with `word` in place of `token`, and where the caret goes after it. */
export function replaceToken(text: string, token: KeywordToken, word: string): { text: string; caret: number } {
  const before = text.slice(0, token.start);
  const head = `${before}${before && !before.endsWith(" ") ? " " : ""}${word}`;
  return { text: head + text.slice(token.end), caret: head.length };
}

/** Keywords worth offering for a half-typed token: the ones it starts, then the ones it appears in. */
export function matchKeywords(token: string, known: readonly string[], limit = 6): string[] {
  const q = token.trim().toLowerCase();
  if (!q) return [];
  const starts: string[] = [];
  const inside: string[] = [];
  for (const k of known) {
    const lower = k.toLowerCase();
    if (lower === q) continue;
    if (lower.startsWith(q)) starts.push(k);
    else if (lower.includes(q)) inside.push(k);
  }
  return [...starts, ...inside].slice(0, limit);
}

/** Canonical name → the spelling it is printed in, read from the printed list itself. */
export function keywordsByName(known: readonly string[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const k of known) {
    const parsed = parseKeywordText(k)[0];
    if (parsed) out.set(parsed.name, k);
  }
  return out;
}

/** A keyword in the field that no known one matches, with the nearest known spelling if there is one. */
export interface KeywordProblem {
  /** The keyword as the player typed it. */
  raw: string;
  /** The nearest known spelling, when one is close enough to be worth offering. */
  suggestion?: string;
}

export function keywordProblems(text: string, known: readonly string[]): KeywordProblem[] {
  const index = keywordsByName(known);
  const names = [...index.keys()];
  const out: KeywordProblem[] = [];
  const seen = new Set<string>();
  for (const kw of parseKeywordText(text)) {
    if (index.has(kw.name) || seen.has(kw.name)) continue;
    seen.add(kw.name);
    const near = nearest(kw.name, names);
    const printed = near ? index.get(near) : undefined;
    const suggestion = printed ? carryValue(printed, kw) : undefined;
    out.push({ raw: kw.raw ?? kw.name, ...(suggestion ? { suggestion } : {}) });
  }
  return out;
}

/**
 * The known spelling, holding the value the player typed rather than the one the example carries.
 *
 * Correcting "Sustaned Hits D3" to "Sustained Hits 1" would fix the spelling and quietly change the
 * weapon. Anti-X keeps its example whole, because its value belongs to a target keyword that the
 * misspelling may not have named at all.
 */
function carryValue(printed: string, typed: WeaponKeyword): string {
  const sample = parseKeywordText(printed)[0];
  if (typed.value === undefined || sample === undefined || sample.name === "ANTI") return printed;
  const cut = printed.lastIndexOf(" ");
  const base = sample.value === undefined || cut < 0 ? printed : printed.slice(0, cut).trim();
  return `${base} ${typed.value}`;
}

/**
 * The known name within an edit or two of `name`, if one is.
 *
 * The allowance grows with the length of the name so that a short one cannot be turned into a
 * different short one: "HEAVY" and "LANCE" are five letters apart in meaning and would otherwise be
 * offered for each other's neighbours.
 */
export function nearest(name: string, known: readonly string[]): string | undefined {
  const n = name.trim().toUpperCase();
  if (!n) return undefined;
  const allowed = n.length <= 6 ? 1 : 2;
  let best: string | undefined;
  let bestDistance = allowed + 1;
  for (const k of known) {
    const d = distance(n, k);
    if (d < bestDistance) {
      bestDistance = d;
      best = k;
    }
  }
  return bestDistance <= allowed ? best : undefined;
}

/** Levenshtein distance, two rows at a time. */
function distance(a: string, b: string): number {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(row[j - 1]! + 1, prev[j]! + 1, prev[j - 1]! + cost);
    }
    prev = row;
  }
  return prev[b.length]!;
}

/** Every keyword the loaded data puts on a unit, for the unit-keyword field. */
export function unitKeywordVocabulary(snapshot: Snapshot | undefined): string[] {
  if (!snapshot) return [];
  const out = new Set<string>();
  for (const d of snapshot.data.datasheets) {
    for (const k of d.keywords) out.add(k.trim().toUpperCase());
    for (const k of d.factionKeywords) out.add(k.trim().toUpperCase());
  }
  out.delete("");
  return [...out].sort((a, b) => a.localeCompare(b));
}
