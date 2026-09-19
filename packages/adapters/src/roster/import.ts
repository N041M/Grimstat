import type { Datasheet, Roster, RosterDetachment, Snapshot } from "@grimstat/schema";
import type { AttachRole } from "./import-common";
import { normaliseName } from "@grimstat/snapshot";
import { companionsOf, compositionBounds, profileBounds } from "@grimstat/resolver";
import {
  MAX_COPIES,
  POINTS_BY_SIZE,
  RosterImportContext,
  SIZE_BY_LABEL,
  defaultGroups,
  isWargearOf,
  isWeaponOf,
  namesWeaponOf,
  mergeGroup,
  profileGroups,
  wargearGroups,
  zipModelGroups,
  type PendingUnit,
  type WargearItem,
} from "./import-common";

/**
 * Tolerant army-list text importer. Understands:
 * - Grimstat's own GW-app-style and NR-tournament-style exports (see text.ts)
 * - New Recruit "tournament" exports (`+ FACTION KEYWORD: …` header block, `Char1: 2x Unit (415 pts): …`,
 *   bullet model lines `• 9x Battle Sister: 9 with Bolt pistol, …`, `Enhancement: X (+15 pts)`)
 * - the WTC-compact one-line-per-unit form (`5x Warden Squad (90 pts): 1 with Flux carbine, 4 with Shock maul`)
 * - 10th-edition-style GW app text (`Unit (80 points)` + `• 1x Wargear` lines)
 *
 * Everything is best-effort. A line that cannot be understood becomes a warning rather than an exception. Name lookups,
 * detachments, enhancements and leader attachment live in `RosterImportContext`, shared with the `.rosz` importer.
 */

const SECTION_NAMES = new Set(["characters", "battleline", "dedicated transports", "other datasheets", "allied units", "epic heroes", "infantry", "mounted", "vehicles", "monsters", "fortifications", "swarms", "beasts", "aircraft"]);
const SIZES = "Combat Patrol|Incursion|Strike Force|Onslaught";
/** Points as `(2,000 points)`, `[2000pts]` or nothing at all. */
const LIMIT = String.raw`(?:[([]\s*(\d[\d,]*)\s*(?:points?|pts?)\s*[)\]]?)?`;
/** `Strike Force (2,000 points)`, the GW app's battle-size line. */
const SIZE_LINE = new RegExp(String.raw`^(${SIZES})\s*${LIMIT}$`, "i");

const WS = /\s/;
/** `.` matches every character except a line break, so a name cannot run past one. */
const DOT = /./;
/** How the dialects spell the word after the number. */
const POINTS_WORD = /points?|pts?/iy;
/** A battle size, matched where the size is expected to start. */
const SIZE_WORD = new RegExp(SIZES, "iy");
/** The three dashes the faction/size line separates its two halves with. */
const DASHES = new Set(["—", "–", "-"]);

/** What the faction/size line says. The points limit is the only part the line may leave out. */
export interface FactionSize {
  faction: string;
  /** The battle size as the line spells it. */
  size: string;
  /** The points limit, with any thousands separators still in it. */
  points?: string;
}

/**
 * `Ashen Wardens — Strike Force [2000pts]`, the faction/size line of the NR-tournament dialect.
 *
 * Read as a scan for the same reason `parseDetSpec` is. A single pattern has to grow the faction name a
 * character at a time and try the dash against every place the spaces before it could end, which on a
 * padded line takes twenty-six milliseconds at four thousand characters. A scan works because the line
 * always turns on a dash. The faction name ends at the first dash with a battle size behind it.
 */
export function parseFactionSize(text: string): FactionSize | undefined {
  const n = text.length;
  const digit = (i: number): boolean => i < n && text[i]! >= "0" && text[i]! <= "9";
  const skipWs = (i: number): number => {
    while (i < n && WS.test(text[i]!)) i++;
    return i;
  };
  const backWs = (i: number): number => {
    while (i > 0 && WS.test(text[i - 1]!)) i--;
    return i;
  };
  // the faction name is read with `.`, so it cannot run past a line break
  let nameLimit = 0;
  while (nameLimit < n && DOT.test(text[nameLimit]!)) nameLimit++;

  /** The points limit after the battle size, when the rest of the line holds nothing else. */
  const limitAt = (i: number): { points?: string } | undefined => {
    const j = skipWs(i);
    if (j >= n) return {};
    if (text[j] !== "(" && text[j] !== "[") return undefined;
    const from = skipWs(j + 1);
    if (!digit(from)) return undefined;
    let digits = from;
    while (digits < n && (digit(digits) || text[digits] === ",")) digits++;
    POINTS_WORD.lastIndex = skipWs(digits);
    if (!POINTS_WORD.exec(text)) return undefined;
    let k = skipWs(POINTS_WORD.lastIndex);
    if (text[k] === ")" || text[k] === "]") k = skipWs(k + 1);
    return k >= n ? { points: text.slice(from, digits) } : undefined;
  };

  for (let d = 0; d < n; d++) {
    if (!DASHES.has(text[d]!)) continue;
    // the spaces before the dash belong to the pattern, and one of them at most can be given back to the
    // name, which is the only way a line that opens on a space can be read at all
    const end = Math.max(1, backWs(d));
    if (end >= d || end > nameLimit) continue;
    const size = skipWs(d + 1);
    if (size === d + 1) continue;
    SIZE_WORD.lastIndex = size;
    const named = SIZE_WORD.exec(text);
    if (!named) continue;
    const limit = limitAt(SIZE_WORD.lastIndex);
    if (!limit) continue;
    return { faction: text.slice(0, end), size: named[0]!, ...limit };
  }
  return undefined;
}

/** A group of models as a list line describes it, before profiles and wargear are partitioned (see `finishUnit`). */
interface RawGroup {
  /** The profile the line named, when it named one; a unit-header group has none and gets `profileGroups`. */
  modelProfileId?: string;
  count: number;
  items: WargearItem[];
  /** No line named these models: the group stands in for the unit under a wargear line (see `wargearTarget`). */
  implied?: boolean;
}

interface TextUnit {
  u: PendingUnit;
  /** Flags whose label this parser has no word for, reported only if nothing else accounts for them. */
  ignored?: string[];
  /** The unit took its part in an attached-unit block, as the host or as a rider. */
  inBlock?: boolean;
  /** New Recruit's `Char1:` prefix, used by the `+ WARLORD:` header line. */
  ref?: string;
  headerCount?: number;
  groups: RawGroup[];
}

const BULLET = /^[•◦▪\-*]\s*/;

/**
 * The `+` marks New Recruit and Grimstat's own dialect wrap header lines in, taken off both ends.
 *
 * Written out rather than replaced with a pattern because the pattern is a global replace whose trailing
 * half starts again at every position in a run of spaces, which costs twenty-six milliseconds on a line
 * padded to four thousand characters and runs on every line of the list.
 *
 * Three marks come off the front along with the spaces behind them. At the back the pattern reaches the
 * end of the line, so a run of more than three leaves the spaces in front of it alone and gives up three.
 */
export function stripPlusMarks(text: string): string {
  const n = text.length;
  let start = 0;
  if (text[0] === "+") {
    while (start < 3 && text[start] === "+") start++;
    while (start < n && WS.test(text[start]!)) start++;
  }
  let marks = n;
  while (marks > start && text[marks - 1] === "+") marks--;
  let end = n;
  if (n - marks > 3) end = n - 3;
  else if (n - marks > 0) {
    end = marks;
    while (end > start && WS.test(text[end - 1]!)) end--;
  }
  return start === 0 && end === n ? text : text.slice(start, end);
}
const COUNT_ITEM = /^(\d+)\s*[x×]\s+(.+)$/i;

/** What one unit-header line says. Everything but the name and the points cost is optional. */
export interface UnitHeader {
  /** New Recruit's `Char1:` prefix, used by the `+ WARLORD:` header line. */
  ref?: string;
  /** The `10x` in front of the name, as the line writes it. */
  count?: string;
  label: string;
  /** The points cost, with any thousands separators still in it. */
  points: string;
  /** Whatever follows the colon after the points cost. */
  rest?: string;
}

/** `Char1:`, the reference New Recruit puts in front of a character. */
const REF_HEAD = /([A-Za-z]+\d+):/y;
/** The `10x` of `10x Warden Squad`, up to the `x` itself. */
const COUNT_HEAD = /(\d+)\s*[x×]/iy;
/** The characters that can open a points cost. */
const COST_OPENERS = new Set(["(", "[", "-", "–", "—"]);

/**
 * `Char1: 2x Canis Rex (415 pts): Warlord` / `10x Squad (110 pts)` / `Unit [80pts]: …` / `Unit - 80 pts`.
 * Points are written by the dialects in parentheses, in brackets or after a dash, with or without thousands
 * separators and with any of pt/pts/point/points, so all of that has to be read together.
 *
 * Read as a scan for the same reason `parseDetSpec` is. A single pattern has to grow the name a character
 * at a time and try the bracket that opens the cost against every place the spaces before it could end,
 * which on a padded line takes a quarter of a second at four thousand characters. A scan works because the
 * cost always opens on one of five characters. The name ends at the first of those that opens a cost the
 * rest of the line fits.
 */
/** The `2x` that opens a model group, up to the `x` itself. */
const GROUP_HEAD = /(\d+)\s*[x×]/y;

/** What one `2x Warden (Flux carbine)` group of a unit-header line says. */
export interface GroupSpec {
  /** The count in front of the `x`, as the line writes it. */
  count: string;
  /** The model name, with the spaces around it still on it. */
  name: string;
  /** What the brackets after the name hold, when the line carries them. */
  body?: string;
}

/**
 * `2x Warden`, `2x Warden (Flux carbine, Shock maul)` — one group of a New Recruit unit-header line.
 *
 * Read as a scan for the same reason `parseDetSpec` is. A single pattern has to grow the model name a
 * character at a time and try the bracket against every place the spaces before it could end, which on a
 * padded line takes forty-two milliseconds at four thousand characters. A scan works because the name
 * holds no brackets, so the group after it opens at the first bracket on the line.
 */
export function parseGroupSpec(text: string): GroupSpec | undefined {
  const n = text.length;
  GROUP_HEAD.lastIndex = 0;
  const head = GROUP_HEAD.exec(text);
  if (!head) return undefined;
  const afterX = GROUP_HEAD.lastIndex;
  const backWs = (i: number): number => {
    while (i > 0 && WS.test(text[i - 1]!)) i--;
    return i;
  };
  let from = afterX;
  while (from < n && WS.test(text[from]!)) from++;
  if (from === afterX) return undefined;

  let open = from;
  while (open < n && text[open] !== "(" && text[open] !== ")") open++;
  // the brackets after the name have to close on the last character of the line, and `.` cannot cross a
  // line break, so either the whole of what they hold reads or the line carries no group at all
  let holds = text[open] === "(" && open + 1 < n && text[n - 1] === ")";
  for (let i = open + 1; holds && i < n - 1; i++) holds = DOT.test(text[i]!);
  if (open < n && !holds) return undefined;
  const nameEnd = open < n ? backWs(open) : backWs(n);

  // the spaces after the `x` belong to the pattern, and they give characters back to the name one at a
  // time until it fits in front of the brackets
  for (let s = Math.min(from, n - 1); s > afterX; s--) {
    const end = Math.max(s + 1, nameEnd);
    if (open < n && end > open) continue;
    const group: GroupSpec = { count: head[1]!, name: text.slice(s, end) };
    if (open < n) group.body = text.slice(open + 1, n - 1);
    return group;
  }
  return undefined;
}

export function parseUnitHeader(text: string): UnitHeader | undefined {
  const n = text.length;
  if (!n) return undefined;
  const skipWs = (i: number): number => {
    while (i < n && WS.test(text[i]!)) i++;
    return i;
  };
  const backWs = (i: number): number => {
    while (i > 0 && WS.test(text[i - 1]!)) i--;
    return i;
  };
  // Positions the cost can open at, and positions the name cannot run past. Both are collected once so
  // that the four ways the line can begin share the work.
  const openers: number[] = [];
  const breaks: number[] = [];
  for (let i = 0; i < n; i++) {
    if (COST_OPENERS.has(text[i]!)) openers.push(i);
    if (!DOT.test(text[i]!)) breaks.push(i);
  }
  const breakFrom = (i: number): number => breaks.find((b) => b >= i) ?? n;

  /** `\s* [)\]]? \s*` and then either the end of the line or `: rest`. */
  const endOf = (i: number): { rest?: string } | undefined => {
    const afterBracket = (j: number): { rest?: string } | undefined => {
      const k = skipWs(j);
      if (k >= n) return {};
      if (text[k] !== ":") return undefined;
      const from = skipWs(k + 1);
      return breakFrom(from) < n ? undefined : { rest: text.slice(from) };
    };
    const k = skipWs(i);
    if (text[k] === ")" || text[k] === "]") {
      const closed = afterBracket(k + 1);
      if (closed) return closed;
    }
    return afterBracket(k);
  };

  /** The points cost opening at `j`, when the rest of the line holds nothing else. */
  const costs = new Map<number, { points: string; rest?: string } | null>();
  const costAt = (j: number): { points: string; rest?: string } | null => {
    const memo = costs.get(j);
    if (memo !== undefined) return memo;
    const read = (): { points: string; rest?: string } | null => {
      const opener = text[j]!;
      const digit = (i: number): boolean => i < n && text[i]! >= "0" && text[i]! <= "9";
      const from = opener === "(" || opener === "[" ? j + 1 : skipWs(j + 1);
      if (!digit(from)) return null;
      let digits = from + 1;
      while (digits < n && (digit(digits) || text[digits] === ",")) digits++;
      POINTS_WORD.lastIndex = skipWs(digits);
      if (!POINTS_WORD.exec(text)) return null;
      const tail = endOf(POINTS_WORD.lastIndex);
      return tail ? { points: text.slice(from, digits), ...tail } : null;
    };
    const out = read();
    costs.set(j, out);
    return out;
  };

  /** The name running from `s` to the first cost the rest of the line fits. */
  const nameFrom = (s: number): UnitHeader | undefined => {
    const limit = breakFrom(s);
    if (s >= limit) return undefined;
    for (const j of openers) {
      if (j <= s) continue;
      const cost = costAt(j);
      if (!cost) continue;
      // the spaces before the cost belong to the pattern, not to the name
      const end = Math.max(s + 1, backWs(j));
      // a later opener only starts further right, so nothing beyond this one fits either
      if (end > limit) return undefined;
      return { label: text.slice(s, end), ...cost };
    }
    return undefined;
  };

  /**
   * The name taken to start inside the spaces that precede it. The pattern lets those spaces give a
   * character back, which is the only way a cost opening at `w` itself can be reached.
   */
  const nameInsideSpaces = (w: number, floor: number): UnitHeader | undefined => {
    if (w <= floor) return undefined;
    const j = openers.find((o) => o >= w && costAt(o) !== null);
    const cost = j === undefined ? null : costAt(j);
    if (j === undefined || !cost) return undefined;
    for (let s = w - 1; s >= floor; s--) {
      const end = Math.max(s + 1, backWs(j));
      if (end <= breakFrom(s)) return { label: text.slice(s, end), ...cost };
    }
    return undefined;
  };

  /** Everything after the optional `Char1:`, which the line may or may not carry. */
  const fromStart = (w: number, floor: number): UnitHeader | undefined => {
    COUNT_HEAD.lastIndex = w;
    const counted = COUNT_HEAD.exec(text);
    if (counted) {
      const afterX = COUNT_HEAD.lastIndex;
      const wb = skipWs(afterX);
      if (wb > afterX) {
        const hit = nameFrom(wb) ?? nameInsideSpaces(wb, afterX + 1);
        if (hit) return { count: counted[1]!, ...hit };
      }
    }
    return nameFrom(w) ?? nameInsideSpaces(w, floor);
  };

  REF_HEAD.lastIndex = 0;
  const ref = REF_HEAD.exec(text);
  if (ref) {
    const hit = fromStart(skipWs(REF_HEAD.lastIndex), REF_HEAD.lastIndex);
    if (hit) return { ref: ref[1]!, ...hit };
  }
  return fromStart(0, 0);
}
/** What one detachment line says, with the brackets stripped off. Every part but the name is optional. */
export interface DetSpec {
  name: string;
  /** Detachment Points, as the line writes them. */
  dp?: string;
  /** The text after the DP count inside the same brackets. */
  dpNote?: string;
  /** A parenthesised group after the name, which is where the force disposition is written. */
  note?: string;
}

/** The `[2 DP` / `(3 Detachment Points` that opens a DP group, matched where the group starts. */
const DP_HEAD = /[[(]\s*(\d+)\s*(?:DP|Detachment\s+Points?)/iy;

/**
 * `Ember Vanguard`, `Ember Vanguard [2 DP] (TAKE AND HOLD)`, `Ember Vanguard (2 DP, TAKE AND HOLD)`,
 * `Ember Vanguard (3 Detachment Points)`.
 *
 * The last form is the official app's, and therefore the one most pasted lists use. Only New Recruit
 * abbreviates to DP.
 *
 * Read as a scan rather than as one pattern. Every part after the name is optional, so one pattern has to
 * grow the name a character at a time and try every optional part against the rest of the line again. On a
 * line carrying a long run of spaces that takes seconds. A scan works because both bracket groups begin at
 * a bracket. The name ends at the first bracket that opens a group the rest of the line fits, and runs to
 * the end of the line when there is none.
 */
/** The word an enhancement flag opens with. */
const ENHANCEMENT_HEAD = /enhancements?:/iy;
/** The spellings of the word inside `(+15 pts)`, in the order the pattern they replace tried them. */
const COST_WORDS = ["points", "point", "pts", "pt"];

/**
 * `Enhancement: Ember Blade (+15 pts)` — the name, with the cost taken off when the line writes one.
 * The GW app writes "(+15 Points)", New Recruit "(+15 pts)".
 *
 * Read as a scan for the same reason `parseDetSpec` is. A single pattern has to grow the name a character
 * at a time and try the cost against every place the spaces before it could end, which on a padded line
 * takes twenty-six milliseconds at four thousand characters. A scan works because the cost closes on the
 * last character of the line, so reading it backwards from there finds the one bracket it can open at.
 */
export function parseEnhancement(text: string): string | undefined {
  const n = text.length;
  ENHANCEMENT_HEAD.lastIndex = 0;
  if (!ENHANCEMENT_HEAD.exec(text)) return undefined;
  const head = ENHANCEMENT_HEAD.lastIndex;
  const backWs = (i: number): number => {
    while (i > head && WS.test(text[i - 1]!)) i--;
    return i;
  };
  let from = head;
  while (from < n && WS.test(text[from]!)) from++;

  /** The bracket the cost opens at, read back from the closing one, or -1 when the line carries no cost. */
  const costOpen = ((): number => {
    if (text[n - 1] !== ")") return -1;
    for (const word of COST_WORDS) {
      const at = n - 1 - word.length;
      if (at <= head || text.slice(at, n - 1).toLowerCase() !== word) continue;
      const spaced = backWs(at);
      let digits = spaced;
      while (digits > head && text[digits - 1]! >= "0" && text[digits - 1]! <= "9") digits--;
      if (digits === spaced) continue;
      const plus = text[digits - 1] === "+" ? digits - 1 : digits;
      if (text[plus - 1] === "(") return plus - 1;
    }
    return -1;
  })();
  const costFrom = costOpen < 0 ? -1 : backWs(costOpen);

  // the spaces after the colon belong to the pattern, and they give characters back to the name one at a
  // time until it fits in front of the cost
  let limit = n;
  for (let i = n - 1; i >= from; i--) if (!DOT.test(text[i]!)) limit = i;
  for (let s = from; s >= head; s--) {
    if (s < n && !DOT.test(text[s]!)) limit = s;
    if (s >= limit) continue;
    if (costOpen >= 0) {
      const end = Math.max(s + 1, costFrom);
      if (end <= costOpen) {
        if (end <= limit) return text.slice(s, end);
        continue;
      }
    }
    if (n <= limit) return text.slice(s, n);
  }
  return undefined;
}

export function parseDetSpec(text: string): DetSpec | undefined {
  const n = text.length;
  if (!n) return undefined;
  let nameLimit = 0;
  while (nameLimit < n && DOT.test(text[nameLimit]!)) nameLimit++;
  let end = n;
  while (end > 0 && WS.test(text[end - 1]!)) end--;
  const skipWs = (i: number): number => {
    while (i < n && WS.test(text[i]!)) i++;
    return i;
  };
  const backWs = (i: number): number => {
    while (i > 0 && WS.test(text[i - 1]!)) i--;
    return i;
  };

  // A trailing "( … )" has to close on the last character of the line and cannot hold a closing bracket,
  // so every bracket that can open one lies after the last ")" before that closing one.
  const noteEnd = end > 0 && text[end - 1] === ")" ? end - 1 : -1;
  const noteFrom = noteEnd < 0 ? -1 : text.lastIndexOf(")", noteEnd - 1) + 1;
  const noteAt = (i: number): string | undefined => (noteEnd >= 0 && i >= noteFrom && i < noteEnd && text[i] === "(" ? text.slice(i + 1, noteEnd).trim() : undefined);

  /** What may follow a DP group: its closing bracket, a trailing note, and nothing but space besides. */
  const closeAt = (i: number): { note?: string } | undefined => {
    const j = skipWs(i);
    if (j >= n) return {};
    if (text[j] === "]" || text[j] === ")") {
      const k = skipWs(j + 1);
      if (k >= n) return {};
      const note = noteAt(k);
      if (note !== undefined) return { note };
    }
    const note = noteAt(j);
    return note === undefined ? undefined : { note };
  };

  /** A DP group starting at `i`, together with whatever follows it. */
  const dpAt = (i: number): DetSpec | undefined => {
    DP_HEAD.lastIndex = i;
    const head = DP_HEAD.exec(text);
    if (!head) return undefined;
    const afterHead = DP_HEAD.lastIndex;
    const comma = skipWs(afterHead);
    if (text[comma] === ",") {
      // the text after the comma ends at the earliest point where the rest of the line still fits,
      // and it cannot reach past a closing bracket
      const from = skipWs(comma + 1);
      let stop = from;
      while (stop < n && text[stop] !== ")" && text[stop] !== "]") stop++;
      const noteOpen = noteEnd < 0 ? -1 : text.indexOf("(", Math.max(from + 1, noteFrom));
      const ends = [Math.max(from + 1, end)];
      if (stop < n) ends.push(Math.max(from + 1, backWs(stop)));
      if (noteOpen >= 0 && noteOpen < noteEnd) ends.push(Math.max(from + 1, backWs(noteOpen)));
      for (const g of [...new Set(ends)].sort((a, b) => a - b)) {
        if (g > stop) continue;
        const tail = closeAt(g);
        if (tail) return { name: "", dp: head[1]!, dpNote: text.slice(from, g).trim(), ...tail };
      }
      // nothing but space after the comma still counts as a comma group, with nothing in it
      if (from > comma + 1) {
        const tail = closeAt(from);
        if (tail) return { name: "", dp: head[1]!, dpNote: "", ...tail };
      }
    }
    const tail = closeAt(afterHead);
    return tail ? { name: "", dp: head[1]!, ...tail } : undefined;
  };

  for (let i = 1; i < n; i++) {
    if (text[i] !== "[" && text[i] !== "(") continue;
    let hit = dpAt(i);
    if (!hit) {
      const note = noteAt(i);
      if (note !== undefined) hit = { name: "", note };
    }
    if (!hit) continue;
    const start = Math.max(1, backWs(i));
    if (start > nameLimit) return undefined;
    return { ...hit, name: text.slice(0, start).trim() };
  }
  const start = Math.max(1, end);
  return start > nameLimit ? undefined : { name: text.slice(0, start).trim() };
}

/** `Attached Unit 1` opens a block; `Attached Units` is the section heading above the blocks. */
/**
 * The heading that introduces a block of units attached to one another, numbered once per block. The
 * official app writes it in the language it is set to, and the number moves with the language:
 * "Attached Unit 1", "Unité 1 Attachée", "Unité Attachée 2".
 */
const ATTACH_BLOCK = /^(?:attached\s+units?(?:\s+\d+)?|unit[ée]s?(?:\s+\d+)?\s+attach[ée]es?(?:\s+\d+)?)$/i;

/**
 * A section heading the parser does not have the word for. The app writes the sections it lays a list
 * out in — characters, battleline, the rest — in capitals, whatever language it is set to, so a line in
 * capitals that is none of the things read before this one is one of those headings. It is only read as
 * one once the list has started, because the name of a list can be written in capitals too.
 */
const CAPITALS = /^[^a-z]*[A-Z\u00C0-\u00DE][^a-z]*$/;

/** `<label> : <value>`, the shape the app writes a unit's flags in, whatever its language calls them. */
const LABELLED_FLAG = /^[^:0-9]{2,40}\s*:\s*(.+)$/;

export function splitList(text: string): string[] {
  return text
    .split(/,\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Splits on commas that are not inside brackets, so `Foo (2 DP, X), Bar` is two parts. */
function splitOutsideParens(text: string): string[] {
  return text
    .split(/,\s*(?![^()[\]]*[)\]])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Where one `N with …` group ends and the next begins, and the count that opens one. */
const WITH_SPLIT = /,\s*(?=\d+\s+with\s)/i;
const WITH_COUNT = /^(\d+)\s+with\s+/i;

/**
 * Models a `N with …` list accounts for. Each prefix opens one group of N models that carries every item
 * up to the next prefix, so a group counts once however much it is carrying.
 */
function withGroupModels(text: string): number {
  return text
    .trim()
    .split(WITH_SPLIT)
    .reduce((sum, seg) => sum + Number(WITH_COUNT.exec(seg.trim())?.[1] ?? 0), 0);
}

/**
 * "9 with Bolt pistol, Boltgun" → both items on 9 models; "2x Twin meltagun" → one item, two copies.
 * The `N with …` prefix is how the WTC-compact and New Recruit dialects say that only part of a unit carries
 * something, so the count has to survive parsing — `wargearGroups` turns it into real sub-groups.
 */
export function parseWargearItems(text: string): WargearItem[] {
  const out: WargearItem[] = [];
  for (const seg of text.trim().split(WITH_SPLIT)) {
    const withCount = WITH_COUNT.exec(seg.trim());
    const n = withCount ? Number(withCount[1]) : 0;
    for (const item of splitList(seg.trim().replace(/^\d+\s+with\s+/i, ""))) {
      const m = COUNT_ITEM.exec(item);
      if (m) out.push({ name: m[2]!.trim(), n, copies: Math.max(1, Math.min(MAX_COPIES, Number(m[1]))) });
      else out.push({ name: item, n, copies: 1 });
    }
  }
  return out;
}

/** The count of `1 Custodian Guard with guardian spear`, which is written without the `x` that `COUNT_ITEM` needs. */
const MODEL_COUNT = /^(\d+)\s+/;

/**
 * `Custodian Guard with guardian spear` cut at the first "with" standing on its own: the model in front of
 * it and the wargear behind it.
 *
 * Read as a scan for the same reason `parseDetSpec` is. The pattern `(.+?)\s+with\s+` has the name grow a
 * character at a time and the whitespace either side of the word grow and shrink against every position it
 * reaches, which on a line carrying two thousand spaces takes six seconds. A scan works because the word
 * itself is fixed: each "with" of the line is found once, and the characters either side say whether it
 * stands on its own.
 */
function firstWith(text: string): { label: string; wargear: string } | undefined {
  const lower = text.toLowerCase();
  for (let at = lower.indexOf("with"); at >= 0; at = lower.indexOf("with", at + 4)) {
    const after = at + 4;
    if (at === 0 || !WS.test(text[at - 1]!) || after >= text.length || !WS.test(text[after]!)) continue;
    const label = text.slice(0, at).trim();
    const wargear = text.slice(after).trim();
    if (label && wargear) return { label, wargear };
  }
  return undefined;
}

/** Flat wargear list, one entry per copy; loses the `N with` counts, so parsers want `parseWargearItems`. */
export function parseWargearList(text: string): string[] {
  return parseWargearItems(text).flatMap((i) => Array.from({ length: i.copies ?? 1 }, () => i.name));
}

/** A count written without the `x` that would separate it from the item: "2 Shieldbreaker missile launchers". */
const BARE_COUNT = /^(\d+)\s+(.+)$/;
/** The "and" a list writes between the last two entries of a wargear list. */
const AND_JOIN = /\s+and\s+/i;
/** The plural `s` a count puts on a weapon name, with three letters in front of it so short names keep theirs. */
const SINGULAR = /(\w{3,})s$/;

/** One weapon of a wargear entry: the name as the entry writes it, and how many copies the entry asks for. */
interface ReadWeapon {
  name: string;
  copies: number;
}

/**
 * One wargear entry read as a weapon of the datasheet. A count in front of the name counts copies, and it puts
 * the name in the plural, so a counted entry is looked up in the singular as well: "2 Twin meltaguns" is the
 * Twin meltagun twice.
 */
function readWeapon(ds: Datasheet, text: string): ReadWeapon | undefined {
  const name = text.trim();
  if (!name) return undefined;
  if (isWeaponOf(ds, normaliseName(name))) return { name, copies: 1 };
  const m = BARE_COUNT.exec(name);
  if (!m) return undefined;
  const copies = Math.max(1, Math.min(MAX_COPIES, Number(m[1])));
  const counted = m[2]!.trim();
  for (const cand of [counted, counted.replace(SINGULAR, "$1")]) {
    if (isWeaponOf(ds, normaliseName(cand))) return { name: cand, copies };
  }
  return undefined;
}

/**
 * The weapons one wargear entry names, or undefined when it should stay as the list wrote it. Lists join the
 * last two entries of a wargear list with "and", but 73 weapon and weapon-group names in the game data have an
 * "and" of their own ("Cult claws and knife", "Slaughter and Carnage"), so an entry is cut at "and" only when
 * the whole of it is not a weapon of the datasheet and each piece is.
 */
function readWargearEntry(ds: Datasheet, text: string): ReadWeapon[] | undefined {
  if (isWeaponOf(ds, normaliseName(text))) return undefined;
  const out: ReadWeapon[] = [];
  for (const part of text.split(AND_JOIN)) {
    const w = readWeapon(ds, part);
    if (!w) return undefined;
    out.push(w);
  }
  return out;
}

/**
 * Re-reads the wargear of one model group against the datasheet. `parseWargearItems` has no datasheet to ask,
 * so it leaves an entry that joins two weapons with "and" and an entry that counts its weapon without an "x"
 * whole; here the datasheet can say what the list meant. Entries it cannot account for are kept as written and
 * reported by `finishUnit`.
 */
function readWargear(ds: Datasheet, items: WargearItem[]): WargearItem[] {
  return items.flatMap((item) => {
    const read = readWargearEntry(ds, item.name);
    if (!read) return [item];
    return read.map((w) => ({ ...item, name: w.name, copies: Math.min(MAX_COPIES, (item.copies ?? 1) * w.copies) }));
  });
}

/** Points as written with thousands separators: "1,000 points". */
function points(s: string | undefined): number {
  return Number((s ?? "").replace(/,/g, ""));
}

export function importRosterText(text: string, snapshot: Snapshot, opts: { name?: string } = {}): { roster: Roster; warnings: string[] } {
  const ctx = new RosterImportContext(snapshot);
  const { warnings } = ctx;
  let name = opts.name ?? "";
  let battleSize: Roster["battleSize"] | undefined;
  let pointsLimit: number | undefined;
  let totalPoints: number | undefined;
  let forceDisposition: string | undefined;
  let warlordRef: string | undefined;
  const units: TextUnit[] = [];
  /**
   * The unit the lines being read belong to, and the companion model most recently opened under it.
   * A companion is a model with a datasheet of its own written inside another unit's entry, as Sir
   * Hekhtur is written inside Canis Rex. The wargear lines under such a model are its own, so they go
   * to `sub`. `cur` stays the unit that owns the entry, and keeps the warlord mark, the enhancement
   * and the attachment.
   */
  const st: { cur: TextUnit | null; sub: TextUnit | null } = { cur: null, sub: null };

  /**
   * The official app names no host unit. Attachment is structural: the units under one
   * "Attached Unit N" heading form a block, and the one marked Bodyguard hosts the Leaders and
   * Supports beside it. The leader is usually listed first, so the host is only known once the block
   * ends — which is why these are collected and resolved on close rather than as they are read.
   */
  let block: { host?: TextUnit; riders: { t: TextUnit; role: AttachRole }[]; members: TextUnit[] } | undefined;

  /**
   * Who leads whom in a block nothing marked, worked out from the datasheets rather than from the words.
   *
   * The app writes each unit's part in the block as a flag ("Attached as: Bodyguard"), and it writes it
   * in whatever language it is set to, so a list exported in French carries the same block with none of
   * its parts named. The sheets themselves say who can join what: the host is the member another member
   * can lead or support, and that member is the rider. A block whose members have no such relation is
   * left alone, which is what an unattached pair of units in the same block should be.
   */
  const inferAttachments = (members: readonly TextUnit[]) => {
    const joins = (rider: TextUnit, host: TextUnit): boolean => rider.u.ds.leaderTo.includes(host.u.ds.id) || rider.u.ds.supportTo.includes(host.u.ds.id);
    const host = members.find((h) => members.some((r) => r !== h && joins(r, h)));
    if (!host) return;
    host.inBlock = true;
    for (const rider of members) {
      if (rider === host || rider.u.attachHost || !joins(rider, host)) continue;
      const supports = rider.u.ds.supportTo.includes(host.u.ds.id) && !rider.u.ds.leaderTo.includes(host.u.ds.id);
      rider.u.attachHost = { unitId: host.u.id, role: supports ? "support" : "leader" };
      rider.inBlock = true;
    }
  };

  const closeAttachBlock = () => {
    const host = block?.host;
    if (host) {
      host.inBlock = true;
      for (const r of block!.riders) {
        r.t.u.attachHost = { unitId: host.u.id, role: r.role };
        r.t.inBlock = true;
      }
    } else if (block) inferAttachments(block.members);
    block = undefined;
  };
  let headerSeen = false;

  const setFaction = (label: string): boolean => {
    // "Imperium - Ashen Wardens": the most specific keyword is the last one
    for (const c of [label, ...label.split(/\s+[-–—]\s+/).reverse()]) {
      const f = ctx.findFaction(c);
      if (f) {
        ctx.factionId = f.id;
        return true;
      }
    }
    return false;
  };

  /**
   * The detachment most recently added, and the dispositions its datasheet allows.
   *
   * The official app writes the force disposition on the line *after* the detachment, with nothing to
   * mark it as one — so it can only be recognised by asking the game data whether this detachment
   * permits it. That keeps the five dispositions out of the parser: they are rules text, and rules
   * text lives in the snapshot.
   */
  let lastDetachment: { entry: RosterDetachment; allowed: readonly string[] } | undefined;

  /** One entry of a `Detachment:` line or header value, with its optional DP count and force disposition. */
  const addDetachmentSpec = (spec: string) => {
    const m = parseDetSpec(spec.trim().replace(/\s*\+*$/, ""));
    if (!m) return;
    // a trailing "(…)" is a disposition only next to a DP count; otherwise it is a variant label the snapshot ignores
    const disposition = m.dpNote || (m.dp ? m.note : undefined) || forceDisposition;
    const label = m.name;
    const entry = ctx.addDetachment(label, disposition);
    const det = ctx.findDetachment(label);
    lastDetachment = entry && det ? { entry, allowed: det.forceDispositions } : undefined;
  };

  const applyFlag = (t: TextUnit, f: string): boolean => {
    if (/^warlord$/i.test(f.trim())) {
      t.u.warlord = true;
      return true;
    }
    const enhancement = parseEnhancement(f);
    if (enhancement !== undefined) {
      t.u.enhancementName = enhancement.trim();
      return true;
    }
    let m = /^(leads|leader of|attached to|supports|support of):\s*(.+)$/i.exec(f);
    if (m) {
      t.u.attach = { hostName: m[2]!.trim(), role: /^support/i.test(m[1]!) ? "support" : "leader" };
      return true;
    }
    // "Attached as: Leader (Character)" — a declaration, not wargear, so it is consumed whether or
    // not a block is open; left unconsumed it lands in the unit's weapons.
    m = /^attached\s+as:\s*(leader|bodyguard|support)\b/i.exec(f);
    if (m) {
      const kind = m[1]!.toLowerCase();
      if (block && kind === "bodyguard") block.host = t;
      else if (block) block.riders.push({ t, role: kind === "support" ? "support" : "leader" });
      return true;
    }
    return false;
  };

  /** The group a bare wargear line belongs to: the last one the unit declared, else an implicit unit-sized group. */
  const wargearTarget = (t: TextUnit): RawGroup => {
    const last = t.groups.at(-1);
    if (last) return last;
    // A wargear line says what the unit carries and gives no unit size. With no count on the header the unit
    // keeps the size it would have had without the line, which is the datasheet's minimum composition.
    const size = t.headerCount ?? defaultGroups(t.u.ds).reduce((s, g) => s + g.count, 0);
    const g: RawGroup = { count: Math.max(1, size), items: [], implied: true };
    t.groups.push(g);
    return g;
  };

  /**
   * A wargear line under a model group states how many *models* carry the item ("• 5x Warden" / "2x Shock maul"
   * = two of the five). Only when the count exceeds the group does it mean copies per model, which is how a
   * single-model unit writes "2x Twin hail gun".
   */
  const addWargear = (t: TextUnit, itemName: string, count: number) => {
    const g = wargearTarget(t);
    const asked = Math.max(1, Math.floor(count / Math.max(1, g.count)));
    if (asked > MAX_COPIES) warnings.push(`${t.u.name}: kept ${MAX_COPIES} copies of "${itemName}" out of the ${asked} the list asks for.`);
    g.items.push({ name: itemName, n: count >= g.count ? 0 : count, copies: Math.min(MAX_COPIES, asked) });
  };

  /**
   * A bullet the app writes as `<label> : <value>` whose label this parser has no word for: the official
   * app's French export writes "Optimisation : Murdermind" where the English writes "Enhancement:
   * Murdermind", and "Attachée en tant que : Meneur" where it writes "Attached as: Leader".
   *
   * The label cannot be read, but the value often can: the snapshot knows every enhancement by name, and
   * the app leaves those names alone in most of its languages. A value that names one is an enhancement
   * line whatever the label says. Anything else is reported as a line that was not understood, which is
   * what it is — read as wargear it would put the words of the flag on the models as a weapon.
   */
  const readLabelledFlag = (t: TextUnit, line: string): boolean => {
    const m = LABELLED_FLAG.exec(line);
    if (!m) return false;
    // Thirty-two enhancements are printed with a word in brackets after the name, and the app adds one of
    // its own to say that the line is an enhancement at all, so both spellings are tried.
    const raw = m[1]!.trim();
    const value = [raw, raw.replace(/\s*\([^)]*\)\s*$/, "").trim()].find((v) => v && ctx.findEnhancement(v));
    if (value) {
      t.u.enhancementName = value;
      return true;
    }
    (t.ignored ??= []).push(line);
    return true;
  };

  /**
   * A line that names a model: one of the unit's own, or a model carrying a datasheet of its own.
   * Returns false when the line names neither, so that the caller reads it as wargear as before.
   */
  const addModelLine = (t: TextUnit, label: string, count: number, items: WargearItem[]): boolean => {
    // "4x Custodian Warden (Guardian Spear)": the brackets hold the loadout, which the dialects that
    // write it this way also list on the lines underneath, so the name in front of them is all that is read
    const bare = label.replace(/\s*\([^()]*\)\s*$/, "").trim();
    const prof = ctx.modelFor(t.u.ds, label) ?? (bare === label ? undefined : ctx.modelFor(t.u.ds, bare));
    if (prof) {
      t.groups.push({ modelProfileId: prof.id, count, items });
      st.sub = null;
      return true;
    }
    const companion = ctx.companionDatasheet(t.u.ds, bare);
    if (!companion) return false;
    startCompanion(companion, count, items);
    return true;
  };

  /**
   * A model line that names a datasheet of its own becomes a unit of its own, and the wargear lines
   * written under it follow it there. Canis Rex's entry is written this way: the Knight and Sir Hekhtur
   * are two models with two datasheets under one heading.
   */
  const startCompanion = (ds: Datasheet, count: number, items: WargearItem[]) => {
    const t: TextUnit = { u: ctx.newUnit(ds), groups: [{ count: Math.max(1, count), items }] };
    units.push(t);
    st.sub = t;
    // The header counted the companion among the unit's models: "2x Canis Rex" is the Knight and
    // Sir Hekhtur. The unit itself is the rest.
    if (st.cur?.headerCount) st.cur.headerCount = Math.max(1, st.cur.headerCount - Math.max(1, count));
  };

  /**
   * A header that counts more models than the datasheet can hold, with nothing written under it
   * to say what they are: "2x Canis Rex (415 pts)" is the Knight and Sir Hekhtur. Read as two
   * Knights the unit was over its size and priced off the wrong tier. The models the composition
   * has no room for are the ones that come with the unit, one unit each, in the order the snapshot
   * lists them. A companion line under the header has already taken its model off the count.
   */
  const claimCompanions = (t: TextUnit) => {
    const max = compositionBounds(t.u.ds).max;
    if (!t.headerCount || max === undefined || t.headerCount <= max) return;
    let spare = t.headerCount - max;
    for (const c of companionsOf(ctx.snapshot, t.u.ds)) {
      if (spare <= 0) break;
      // No groups: the build step gives a unit with none its datasheet's default models and wargear.
      units.push({ u: ctx.newUnit(c), groups: [] });
      spare--;
      t.headerCount--;
    }
    // The header's count also stood up an implied group when a wargear line came before any model line.
    for (const g of t.groups) if (g.implied && g.count > t.headerCount) g.count = t.headerCount;
  };

  const startUnit = (ref: string | undefined, count: number | undefined, label: string, rest: string | undefined) => {
    const ds = ctx.matchDatasheet(label);
    if (!ds) {
      warnings.push(`Unknown unit "${label}" — skipped.`);
      st.cur = null;
      st.sub = null;
      return;
    }
    const t: TextUnit = { u: ctx.newUnit(ds), groups: [] };
    if (ref) t.ref = ref;
    if (count) t.headerCount = count;
    units.push(t);
    block?.members.push(t);
    st.cur = t;
    st.sub = null;
    if (!rest) return;
    // NR "Unit [80pts]: 2x Model (a, b), 1x Other (c) — Warlord; Enhancement: X", or inline wargear
    const [groupsPart = "", ...flagParts] = rest.split(/\s+[—–]\s+/);
    const chunks = groupsPart.split(/,\s*(?=\d+\s*[x×]\s+[^(),]+(?:\(|,|$))/);
    const specs = chunks.map((c) => parseGroupSpec(c.trim()));
    const asGroups = chunks.length > 0 && specs.every((spec, i) => spec && (chunks[i]!.includes("(") || ctx.profileFor(ds, spec.name)));
    if (asGroups) {
      for (const spec of specs) {
        const items = spec!.body ? parseWargearItems(spec!.body) : [];
        const prof = ctx.modelFor(ds, spec!.name);
        const companion = prof ? undefined : ctx.companionDatasheet(ds, spec!.name);
        if (companion) {
          startCompanion(companion, Number(spec!.count), items);
          continue;
        }
        const g: RawGroup = { count: Number(spec!.count), items };
        if (prof) g.modelProfileId = prof.id;
        t.groups.push(g);
      }
    } else {
      // WTC-compact: wargear and flags share one comma-separated list ("Flux pistol, Enhancement: Ember Blade")
      const gear = splitOutsideParens(groupsPart).filter((seg) => !applyFlag(t, seg));
      const gearText = gear.join(", ");
      const items = parseWargearItems(gearText);
      // The header says what the unit carries, not which models it is made of. Model lines may still
      // follow — "5x Incubi (90 pts): Incubi Shrine Token" over "1x Klaivex" and "4x Incubi" — and
      // counting both left the unit twice its size, so this group is the one `finishUnit` folds away
      // when the lines underneath account for the models themselves.
      if (items.length) t.groups.push({ count: Math.max(1, count ?? withGroupModels(gearText)), items, implied: true });
    }
    for (const f of flagParts.join(" ").split(/;\s*/)) applyFlag(t, f.trim());
  };

  const rawLines = text.split(/\r?\n/);
  let lastHeaderKey = "";
  for (const raw of rawLines) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    // ---- New Recruit header block
    if (/^\+{3,}$/.test(trimmed) || /^\+\s*$/.test(trimmed)) continue;
    // "+ KEY: value" (New Recruit header block) and "& continuation" lines; "++ …" lines belong to Grimstat's own dialect
    const hm = /^\+\s+([A-Z][A-Z ]+?):\s*(.*)$/.exec(trimmed) ?? (trimmed.startsWith("&") ? /^&\s*()(.*)$/.exec(trimmed) : null);
    if (hm) {
      const key = (hm[1] || lastHeaderKey).trim().toUpperCase();
      const val = (hm[2] ?? "").trim();
      lastHeaderKey = key || lastHeaderKey;
      switch (key) {
        case "FACTION KEYWORD":
        case "FACTION":
          if (!setFaction(val)) warnings.push(`Unknown faction "${val}".`);
          break;
        case "DETACHMENT":
        case "DETACHMENTS":
          for (const part of splitOutsideParens(val)) addDetachmentSpec(part);
          break;
        case "FORCE DISPOSITION":
          forceDisposition = val;
          for (const d of ctx.detachments) d.forceDisposition = val;
          break;
        case "TOTAL ARMY POINTS":
          totalPoints = points(/(\d[\d,]*)/.exec(val)?.[1]) || undefined;
          break;
        case "WARLORD":
          warlordRef = val;
          break;
        case "ARMY NAME":
        case "LIST NAME":
          name = val;
          break;
        default:
          break; // ENHANCEMENT (repeated per unit), NUMBER OF UNITS, SECONDARY, … are informational
      }
      headerSeen = true;
      continue;
    }
    if (/^(exported with|created with)/i.test(trimmed)) continue;
    const isBullet = BULLET.test(trimmed);
    const line = stripPlusMarks(trimmed.replace(BULLET, "")).trim();
    if (!line) continue;

    // ---- header lines: faction, battle size, detachments
    const factionSize = parseFactionSize(line);
    if (factionSize) {
      setFaction(factionSize.faction);
      battleSize = SIZE_BY_LABEL[factionSize.size.toLowerCase().replace(/\s+/g, " ")] ?? battleSize;
      if (factionSize.points) pointsLimit = points(factionSize.points);
      headerSeen = true;
      continue;
    }
    let m = SIZE_LINE.exec(line);
    if (m) {
      battleSize = SIZE_BY_LABEL[m[1]!.toLowerCase().replace(/\s+/g, " ")] ?? battleSize;
      if (m[2]) pointsLimit = points(m[2]);
      headerSeen = true;
      continue;
    }
    // "Detachment: X", "Detachment: X [2 DP] (TAKE AND HOLD)", "Detachments: X (2 DP), Y" — the DP suffix is optional
    m = /^Detachments?:\s*(.+)$/i.exec(line);
    if (m) {
      for (const part of splitOutsideParens(m[1]!)) addDetachmentSpec(part);
      continue;
    }
    if (!isBullet && ctx.findFaction(line)) {
      setFaction(line);
      headerSeen = true;
      continue;
    }
    if (!isBullet && ATTACH_BLOCK.test(line)) {
      closeAttachBlock();
      // "Attached Unit 1" opens a block; the bare "Attached Units" heading only introduces them.
      if (/\d/.test(line)) block = { riders: [], members: [] };
      st.cur = null;
      st.sub = null;
      continue;
    }
    // A bare force disposition on the line after its detachment, as the app lays it out. It is recognised
    // by asking that detachment which dispositions it allows rather than by a list of names in here.
    if (!isBullet && lastDetachment?.allowed.some((d) => normaliseName(d) === normaliseName(line))) {
      lastDetachment.entry.forceDisposition = line;
      continue;
    }
    if (!isBullet && (SECTION_NAMES.has(normaliseName(line)) || (headerSeen && CAPITALS.test(line)))) {
      closeAttachBlock();
      st.cur = null;
      st.sub = null;
      continue;
    }
    // A bare detachment name, wherever it appears: GW-app exports put it under the faction, others
    // after the units. The app suffixes it with its Detachment Points, so the lookup has to be by the
    // name alone — a suffix that is a points cost belongs to a unit, so only a DP count counts here.
    if (!isBullet) {
      const spec = parseDetSpec(line);
      const detName = spec?.name;
      if (detName && (spec.dp || detName === line) && ctx.findDetachment(detName)) {
        addDetachmentSpec(line);
        continue;
      }
    }

    // ---- unit header
    const header = isBullet ? undefined : parseUnitHeader(line);
    if (header) {
      const { ref, count, label, rest } = header;
      // The first line of a list is its name. "Knights (2000 points)" names the list, and a loose
      // match on "Knights" must not turn it into a unit, so only a datasheet's own name counts here.
      const looksLikeUnit = !!ref || !!count || (headerSeen || units.length ? !!ctx.matchDatasheet(label) : !!ctx.findDatasheet(label));
      if (!headerSeen && !looksLikeUnit && !units.length) {
        // "My list (2000 points)" — the roster name line
        name = name || label.trim();
        headerSeen = true;
        continue;
      }
      headerSeen = true;
      startUnit(ref, count ? Number(count) : undefined, label.trim(), rest);
      continue;
    }

    if (!st.cur) {
      if (!headerSeen && !isBullet) {
        name = name || line;
        headerSeen = true;
      } else if (!/^\d+\s*(pts|points)$/i.test(line)) warnings.push(`Ignored line: "${line}"`);
      continue;
    }
    if (applyFlag(st.cur, line)) continue;
    if (isBullet && readLabelledFlag(st.cur, line)) continue;

    // ---- lines under a unit: "1x Sir Hekhtur: Close combat weapon, …" | "9x Battle Sister: 9 with …" | "1x Power fist"
    m = COUNT_ITEM.exec(line);
    if (m) {
      const count = Number(m[1]);
      const body = m[2]!.trim();
      const colon = body.indexOf(":");
      if (colon > 0) {
        const label = body.slice(0, colon).trim();
        const items = parseWargearItems(body.slice(colon + 1));
        if (addModelLine(st.cur, label, count, items)) continue;
        st.cur.groups.push({ count, items });
        st.sub = null;
        continue;
      }
      // A weapon first. `profileFor` matches by prefix, so "10x Hormagaunt talons" would otherwise
      // read as ten more Hormagaunts — a second model group, the weapon gone, and no warning.
      if (!namesWeaponOf(st.cur.u.ds, normaliseName(body))) {
        if (addModelLine(st.cur, body, count, [])) continue;
        // "1x Gun Servitor with Arc Rifle": the model and the weapon that tells it from its fellows,
        // on the line the other dialects write as "1 Custodian Guard with guardian spear".
        const withCut = firstWith(body);
        if (withCut && addModelLine(st.cur, withCut.label, count, parseWargearItems(withCut.wargear))) continue;
      }
      addWargear(st.sub ?? st.cur, body, count);
      continue;
    }
    // "1 Custodian Guard with guardian spear" — a model and its loadout on one line, without the `x`.
    // Only a name that is a model of the unit takes this branch; everything else is wargear as before.
    const counted = MODEL_COUNT.exec(line);
    const cut = counted && firstWith(line.slice(counted[0]!.length));
    if (cut && addModelLine(st.cur, cut.label, Number(counted![1]), parseWargearItems(cut.wargear))) continue;
    if (isBullet) {
      // "• Bolt pistol", or a line holding several items: "• Guardian Drone, Gun Drone". Exactly one
      // weapon name in the game data has a comma in it, so a line the datasheet knows whole is left as
      // the list wrote it and only an unknown one is split.
      const target = st.sub ?? st.cur;
      if (isWeaponOf(target.u.ds, normaliseName(line))) addWargear(target, line, 0);
      else {
        const g = wargearTarget(target);
        for (const item of parseWargearItems(line)) g.items.push(item);
      }
      continue;
    }
    warnings.push(`${st.cur.u.name}: ignored line "${line}"`);
  }

  // The last block has no heading after it to close it.
  closeAttachBlock();
  for (const t of [...units]) claimCompanions(t);
  for (const t of units) finishUnit(t, warnings);
  // A flag whose label this parser has no word for is worth reporting only when nothing else answered it.
  // The blocks those lines mark out are resolved from the datasheets, so a unit that came out attached has
  // lost nothing by the line being unreadable, and saying so would be noise on every unit of every list.
  for (const t of units) {
    if (t.u.attachHost || t.u.attach || t.inBlock) continue;
    for (const f of t.ignored ?? []) warnings.push(`${t.u.name}: ignored "${f}".`);
  }
  if (warlordRef) {
    const refMatch = /^([A-Za-z]+\d+):\s*(.*)$/.exec(warlordRef);
    const byRef = refMatch ? units.find((t) => t.ref?.toLowerCase() === refMatch[1]!.toLowerCase()) : undefined;
    const key = normaliseName(refMatch?.[2] ?? warlordRef);
    const found = byRef ?? units.find((t) => normaliseName(t.u.name) === key);
    if (found) found.u.warlord = true;
  }

  // battle size: explicit, else inferred from the declared total
  if (!battleSize) {
    const pts = totalPoints ?? 0;
    battleSize = pts <= 0 ? "strike-force" : pts <= 500 ? "combat-patrol" : pts <= 1000 ? "incursion" : pts <= 2000 ? "strike-force" : "onslaught";
  }
  pointsLimit ??= POINTS_BY_SIZE[battleSize];
  return ctx.build({ name: name || "Imported army", battleSize, pointsLimit });
}

/**
 * The models a unit of `size` is missing, given the groups a list wrote out.
 *
 * They are the ones the composition still wants: a Kommandos mob written as nine Kommandos is ten
 * models, and the tenth is the Nob. Where the composition does not say — it names no profile, or no
 * way of building the unit holds this many — the models are left without one, for `profileGroups` to
 * place.
 */
function missingModels(ds: Datasheet, written: readonly RawGroup[], size: number): RawGroup[] {
  let left = size - written.reduce((n, g) => n + g.count, 0);
  if (left <= 0) return [];
  const assigned = new Map<string, number>();
  for (const g of written) if (g.modelProfileId) assigned.set(g.modelProfileId, (assigned.get(g.modelProfileId) ?? 0) + g.count);
  const way = profileBounds(ds).find((w) => size >= w.reduce((n, p) => n + p.min, 0) && size <= w.reduce((n, p) => n + p.max, 0));
  const out: RawGroup[] = [];
  for (const p of way ?? []) {
    const short = Math.min(left, Math.max(0, p.min - (assigned.get(p.profileId) ?? 0)));
    if (short <= 0) continue;
    out.push({ count: short, items: [], modelProfileId: p.profileId });
    left -= short;
  }
  if (left > 0) out.push({ count: left, items: [] });
  return out;
}

/**
 * Turns the raw groups of one unit into model groups: each group is partitioned by profile (explicit, or spread
 * over the datasheet's profiles when only the unit size was given) and by wargear, and the two partitions are
 * overlaid. Wargear that names no weapon of the datasheet is kept but reported — silently dropping it downstream
 * would leave the unit simulating with its default loadout and nothing to show for the mis-parsed line.
 */
function finishUnit(t: TextUnit, warnings: string[]): void {
  const ds = t.u.ds;
  // A wargear line ahead of every model line stands the whole unit up as one group (see `wargearTarget`).
  // Model lines after it describe those same models, and counting both would give the unit twice its
  // size. The invented group therefore keeps only the models the named groups leave unaccounted for,
  // and its items go to the first group a line did name.
  const named = t.groups.filter((g) => !g.implied);
  const invented = t.groups.filter((g) => g.implied);
  if (named.length && invented.length) {
    const size = (gs: RawGroup[]) => gs.reduce((s, g) => s + g.count, 0);
    const whole = size(invented);
    for (const g of invented) named[0]!.items.push(...g.items);
    t.groups = whole > size(named) ? [...named, ...missingModels(ds, named, whole)] : named;
  }
  // no groups and no unit size: leave it to `defaultGroups` in the context's build step
  const groups: RawGroup[] = t.groups.length ? t.groups : t.headerCount ? [{ count: t.headerCount, items: [] }] : [];
  /*
   * The header counts the unit; the lines under it need not account for every model. A list writes
   * "10x Tempestus Scions (150 pts)" over a single line for the nine that share a loadout and says
   * nothing about the tenth. Read as the whole unit, those lines left a squad a model short — which
   * is a squad with no points, since the points are written per unit size.
   */
  const written = groups.reduce((n, g) => n + Math.max(1, g.count), 0);
  /*
   * A unit is as big as its header says. Where the header gives no size, the datasheet's own minimum
   * stands in, because a list that states none has not said the unit is short — it has only written
   * out the models it cared to name. Gaunt's Ghosts is written as a line per Ghost, and the five
   * whose names the datasheet does not carry were read as wargear, leaving the Colonel-Commissar on
   * his own; the Tempestus Aquilons lose the Gunfighter the same way.
   */
  const size = t.headerCount ?? (written > 0 ? compositionBounds(ds).min ?? 0 : 0);
  if (size > written) groups.push(...missingModels(ds, groups, size));
  const out: PendingUnit["groups"] = [];
  for (const g of groups) {
    const count = Math.max(1, g.count);
    const profiles = g.modelProfileId ? [{ modelProfileId: g.modelProfileId, count, wargear: [] }] : profileGroups(ds, count);
    for (const sub of zipModelGroups(profiles, wargearGroups(count, readWargear(ds, g.items)))) mergeGroup(out, sub);
  }
  t.u.groups = out;
  const unknown = [...new Set(out.flatMap((g) => g.wargear))].filter((w) => !isWargearOf(ds, w));
  for (const w of unknown) warnings.push(`${t.u.name}: unknown wargear "${w}".`);
}
