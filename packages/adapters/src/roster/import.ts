import type { Roster, RosterDetachment, Snapshot } from "@grimstat/schema";
import type { AttachRole } from "./import-common";
import { normaliseName } from "@grimstat/snapshot";
import {
  MAX_COPIES,
  POINTS_BY_SIZE,
  RosterImportContext,
  SIZE_BY_LABEL,
  defaultGroups,
  isWeaponOf,
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
/** `Ashen Wardens — Strike Force [2000pts]`, the faction/size line of the NR-tournament dialect. */
const FACTION_SIZE_LINE = new RegExp(String.raw`^(.+?)\s+[—–-]\s+(${SIZES})\s*${LIMIT}$`, "i");
/** `Strike Force (2,000 points)`, the GW app's battle-size line. */
const SIZE_LINE = new RegExp(String.raw`^(${SIZES})\s*${LIMIT}$`, "i");

/** A group of models as a list line describes it, before profiles and wargear are partitioned (see `finishUnit`). */
interface RawGroup {
  /** The profile the line named, when it named one; a unit-header group has none and gets `profileGroups`. */
  modelProfileId?: string;
  count: number;
  items: WargearItem[];
}

interface TextUnit {
  u: PendingUnit;
  /** New Recruit's `Char1:` prefix, used by the `+ WARLORD:` header line. */
  ref?: string;
  headerCount?: number;
  groups: RawGroup[];
}

const BULLET = /^[•◦▪\-*]\s*/;
const COUNT_ITEM = /^(\d+)\s*[x×]\s+(.+)$/i;
const WS = /\s/;
/** `.` matches every character except a line break, so a name cannot run past one. */
const DOT = /./;

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
/** How the dialects spell the word after the number. */
const POINTS_WORD = /points?|pts?/iy;
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
const ATTACH_BLOCK = /^attached\s+units?(?:\s+(\d+))?$/i;

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

/** Flat wargear list, one entry per copy; loses the `N with` counts, so parsers want `parseWargearItems`. */
export function parseWargearList(text: string): string[] {
  return parseWargearItems(text).flatMap((i) => Array.from({ length: i.copies ?? 1 }, () => i.name));
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
  const st: { cur: TextUnit | null } = { cur: null };

  /**
   * The official app names no host unit. Attachment is structural: the units under one
   * "Attached Unit N" heading form a block, and the one marked Bodyguard hosts the Leaders and
   * Supports beside it. The leader is usually listed first, so the host is only known once the block
   * ends — which is why these are collected and resolved on close rather than as they are read.
   */
  let block: { host?: TextUnit; riders: { t: TextUnit; role: AttachRole }[] } | undefined;
  const closeAttachBlock = () => {
    const host = block?.host;
    if (host) for (const r of block!.riders) r.t.u.attachHost = { unitId: host.u.id, role: r.role };
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
    // the GW app writes "(+15 Points)", New Recruit "(+15 pts)"
    let m = /^enhancements?:\s*(.+?)(?:\s*\(\+?\d+\s*(?:points?|pts?)\))?$/i.exec(f);
    if (m) {
      t.u.enhancementName = m[1]!.trim();
      return true;
    }
    m = /^(leads|leader of|attached to|supports|support of):\s*(.+)$/i.exec(f);
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
    const g: RawGroup = { count: Math.max(1, size), items: [] };
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

  const startUnit = (ref: string | undefined, count: number | undefined, label: string, rest: string | undefined) => {
    const ds = ctx.matchDatasheet(label);
    if (!ds) {
      warnings.push(`Unknown unit "${label}" — skipped.`);
      st.cur = null;
      return;
    }
    const t: TextUnit = { u: ctx.newUnit(ds), groups: [] };
    if (ref) t.ref = ref;
    if (count) t.headerCount = count;
    units.push(t);
    st.cur = t;
    if (!rest) return;
    // NR "Unit [80pts]: 2x Model (a, b), 1x Other (c) — Warlord; Enhancement: X", or inline wargear
    const [groupsPart = "", ...flagParts] = rest.split(/\s+[—–]\s+/);
    const groupRe = /^(\d+)\s*[x×]\s+([^()]+?)\s*(?:\((.*)\))?$/;
    const chunks = groupsPart.split(/,\s*(?=\d+\s*[x×]\s+[^(),]+(?:\(|,|$))/);
    const asGroups = chunks.length > 0 && chunks.every((c) => groupRe.test(c.trim()) && (c.includes("(") || ctx.profileFor(ds, groupRe.exec(c.trim())![2]!)));
    if (asGroups) {
      for (const part of chunks) {
        const m = groupRe.exec(part.trim())!;
        const prof = ctx.profileFor(ds, m[2]!);
        const g: RawGroup = { count: Number(m[1]), items: m[3] ? parseWargearItems(m[3]) : [] };
        if (prof) g.modelProfileId = prof.id;
        t.groups.push(g);
      }
    } else {
      // WTC-compact: wargear and flags share one comma-separated list ("Flux pistol, Enhancement: Ember Blade")
      const gear = splitOutsideParens(groupsPart).filter((seg) => !applyFlag(t, seg));
      const gearText = gear.join(", ");
      const items = parseWargearItems(gearText);
      if (items.length) t.groups.push({ count: Math.max(1, count ?? withGroupModels(gearText)), items });
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
    const line = trimmed.replace(BULLET, "").replace(/^\+{1,3}\s*|\s*\+{1,3}$/g, "").trim();
    if (!line) continue;

    // ---- header lines: faction, battle size, detachments
    let m = FACTION_SIZE_LINE.exec(line);
    if (m) {
      setFaction(m[1]!);
      battleSize = SIZE_BY_LABEL[m[2]!.toLowerCase().replace(/\s+/g, " ")] ?? battleSize;
      if (m[3]) pointsLimit = points(m[3]);
      headerSeen = true;
      continue;
    }
    m = SIZE_LINE.exec(line);
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
      if (/\d/.test(line)) block = { riders: [] };
      st.cur = null;
      continue;
    }
    // A bare force disposition on the line after its detachment, as the app lays it out. It is recognised
    // by asking that detachment which dispositions it allows rather than by a list of names in here.
    if (!isBullet && lastDetachment?.allowed.some((d) => normaliseName(d) === normaliseName(line))) {
      lastDetachment.entry.forceDisposition = line;
      continue;
    }
    if (!isBullet && SECTION_NAMES.has(normaliseName(line))) {
      closeAttachBlock();
      st.cur = null;
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
      const looksLikeUnit = !!ref || !!count || !!ctx.matchDatasheet(label);
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

    // ---- lines under a unit: "1x Sir Hekhtur: Close combat weapon, …" | "9x Battle Sister: 9 with …" | "1x Power fist"
    m = COUNT_ITEM.exec(line);
    if (m) {
      const count = Number(m[1]);
      const body = m[2]!.trim();
      const colon = body.indexOf(":");
      if (colon > 0) {
        const prof = ctx.profileFor(st.cur.u.ds, body.slice(0, colon).trim());
        const g: RawGroup = { count, items: parseWargearItems(body.slice(colon + 1)) };
        if (prof) g.modelProfileId = prof.id;
        st.cur.groups.push(g);
        continue;
      }
      // A weapon first. `profileFor` matches by prefix, so "10x Hormagaunt talons" would otherwise
      // read as ten more Hormagaunts — a second model group, the weapon gone, and no warning.
      const prof = isWeaponOf(st.cur.u.ds, normaliseName(body)) ? undefined : ctx.profileFor(st.cur.u.ds, body);
      if (prof) st.cur.groups.push({ modelProfileId: prof.id, count, items: [] });
      else addWargear(st.cur, body, count);
      continue;
    }
    if (isBullet) {
      // "• Bolt pistol" style single wargear line
      addWargear(st.cur, line, 0);
      continue;
    }
    warnings.push(`${st.cur.u.name}: ignored line "${line}"`);
  }

  // The last block has no heading after it to close it.
  closeAttachBlock();
  for (const t of units) finishUnit(t, warnings);
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
 * Turns the raw groups of one unit into model groups: each group is partitioned by profile (explicit, or spread
 * over the datasheet's profiles when only the unit size was given) and by wargear, and the two partitions are
 * overlaid. Wargear that names no weapon of the datasheet is kept but reported — silently dropping it downstream
 * would leave the unit simulating with its default loadout and nothing to show for the mis-parsed line.
 */
function finishUnit(t: TextUnit, warnings: string[]): void {
  const ds = t.u.ds;
  // no groups and no unit size: leave it to `defaultGroups` in the context's build step
  const groups: RawGroup[] = t.groups.length ? t.groups : t.headerCount ? [{ count: t.headerCount, items: [] }] : [];
  const out: PendingUnit["groups"] = [];
  for (const g of groups) {
    const count = Math.max(1, g.count);
    const profiles = g.modelProfileId ? [{ modelProfileId: g.modelProfileId, count, wargear: [] }] : profileGroups(ds, count);
    for (const sub of zipModelGroups(profiles, wargearGroups(count, g.items))) mergeGroup(out, sub);
  }
  t.u.groups = out;
  const unknown = [...new Set(out.flatMap((g) => g.wargear))].filter((w) => !isWeaponOf(ds, normaliseName(w)));
  for (const w of unknown) warnings.push(`${t.u.name}: unknown wargear "${w}".`);
}
