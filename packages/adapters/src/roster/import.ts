import type { Roster, RosterDetachment, Snapshot } from "@grimstat/schema";
import type { AttachRole } from "./import-common";
import { normaliseName } from "@grimstat/snapshot";
import {
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
}

interface TextUnit {
  u: PendingUnit;
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

/**
 * `Char1: 2x Canis Rex (415 pts): Warlord` / `10x Squad (110 pts)` / `Unit [80pts]: …` / `Unit - 80 pts`.
 * Points are written by the dialects in parentheses, in brackets or after a dash, with or without thousands
 * separators and with any of pt/pts/point/points, so all of that has to be one pattern.
 */
const UNIT_HEADER = /^(?:([A-Za-z]+\d+):\s*)?(?:(\d+)\s*[x×]\s+)?(.+?)\s*(?:[([]|[-–—]\s*)(\d[\d,]*)\s*(?:points?|pts?)\s*[)\]]?\s*(?::\s*(.*))?$/i;
const COUNT_ITEM = /^(\d+)\s*[x×]\s+(.+)$/i;

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

/**
 * `Ember Vanguard`, `Ember Vanguard [2 DP] (TAKE AND HOLD)`, `Ember Vanguard (2 DP, TAKE AND HOLD)`,
 * `Ember Vanguard (3 Detachment Points)`.
 *
 * The last form is the official app's, and therefore the one most pasted lists use; only New Recruit
 * abbreviates to DP.
 */
const DET_SPEC = /^(.+?)\s*(?:[[(]\s*(\d+)\s*(?:DP|Detachment\s+Points?)\s*(?:,\s*([^)\]]+?))?\s*[\])]?)?\s*(?:\(\s*([^)]*?)\s*\))?\s*$/i;

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
      if (m) out.push({ name: m[2]!.trim(), n, copies: Math.max(1, Math.min(20, Number(m[1]))) });
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
    const m = DET_SPEC.exec(spec.trim().replace(/\s*\+*$/, ""));
    if (!m) return;
    // a trailing "(…)" is a disposition only next to a DP count; otherwise it is a variant label the snapshot ignores
    const disposition = m[3]?.trim() || (m[2] ? m[4]?.trim() : undefined) || forceDisposition;
    const label = m[1]!.trim();
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
    const g: RawGroup = { count: Math.max(1, size), items: [] };
    t.groups.push(g);
    return g;
  };

  /**
   * A wargear line under a model group states how many *models* carry the item ("• 5x Warden" / "2x Shock maul"
   * = two of the five). Only when the count exceeds the group does it mean copies per model, which is how a
   * single-model unit writes "2x Twin hail gun".
   */
  const addWargear = (g: RawGroup, itemName: string, count: number) => {
    g.items.push({ name: itemName, n: count >= g.count ? 0 : count, copies: Math.max(1, Math.floor(count / Math.max(1, g.count))) });
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
    const chunks = groupsPart.split(/,\s*(?=\d+\s*[x×]\s+[^(),]+(?:\(|,|$))/);
    const specs = chunks.map((c) => parseGroupSpec(c.trim()));
    const asGroups = chunks.length > 0 && specs.every((spec, i) => spec && (chunks[i]!.includes("(") || ctx.profileFor(ds, spec.name)));
    if (asGroups) {
      for (const spec of specs) {
        const prof = ctx.profileFor(ds, spec!.name);
        const g: RawGroup = { count: Number(spec!.count), items: spec!.body ? parseWargearItems(spec!.body) : [] };
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
      const spec = DET_SPEC.exec(line);
      const detName = spec?.[1]?.trim();
      if (detName && (spec![2] || detName === line) && ctx.findDetachment(detName)) {
        addDetachmentSpec(line);
        continue;
      }
    }

    // ---- unit header
    m = isBullet ? null : UNIT_HEADER.exec(line);
    if (m) {
      const [, ref, countStr, label, , rest] = m;
      const looksLikeUnit = !!ref || !!countStr || !!ctx.matchDatasheet(label!);
      if (!headerSeen && !looksLikeUnit && !units.length) {
        // "My list (2000 points)" — the roster name line
        name = name || label!.trim();
        headerSeen = true;
        continue;
      }
      headerSeen = true;
      startUnit(ref, countStr ? Number(countStr) : undefined, label!.trim(), rest);
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
      else addWargear(wargearTarget(st.cur), body, count);
      continue;
    }
    if (isBullet) {
      // "• Bolt pistol" style single wargear line
      addWargear(wargearTarget(st.cur), line, 0);
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
