/**
 * BattleScribe / New Recruit army-list importer.
 *
 * A `.rosz` file is a zip archive holding one `.ros` document: XML in the http://www.battlescribe.net/schema/rosterSchema
 * namespace (`roster` → `forces/force` → `selections/selection`, each selection typed `unit`, `model` or `upgrade`).
 * Units become RosterUnits by matching selection names against the snapshot with `normaliseName`; anything that does
 * not resolve (units, detachments, enhancements, hosts of a leader) is reported in `warnings` and skipped, never thrown.
 * Only structural problems throw: a zip without a roster document, malformed XML, or XML without a `<roster>` root.
 */
import { strFromU8, unzipSync } from "fflate";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import type { Datasheet, ModelProfile, Roster, RosterUnit, Snapshot } from "@grimstat/schema";
import { normaliseName } from "@grimstat/snapshot";
import { catalogueFactionName } from "../bsdata-json/index";
import { defaultGroups, POINTS_BY_SIZE, RosterImportContext, SIZE_BY_LABEL, type AttachRole, type PendingUnit } from "./import-common";

export interface RoszImportOptions {
  /** Roster name; defaults to the `name` attribute of the roster element, then "Imported army". */
  name?: string;
}

// ---- XML shapes (attributes are plain string properties; child lists are arrays, see `parser`) ------------------

interface XmlCategory {
  name?: string;
  primary?: string;
}
interface XmlAssociation {
  name?: string;
  label?: string;
  targetId?: string;
  childId?: string;
  selectionId?: string;
  ids?: string;
}
interface XmlSelection {
  id?: string;
  name?: string;
  customName?: string;
  type?: string;
  number?: string;
  selections?: unknown;
  categories?: unknown;
  associations?: unknown;
}
interface XmlForce {
  name?: string;
  catalogueName?: string;
  selections?: unknown;
  forces?: unknown;
}
interface XmlRoster {
  name?: string;
  forces?: unknown;
}

const ARRAY_TAGS = new Set(["selection", "force", "category", "cost", "association", "profile", "rule"]);
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  parseAttributeValue: false,
  parseTagValue: false,
  removeNSPrefix: true,
  isArray: (tag) => ARRAY_TAGS.has(tag),
});

function list<T>(container: unknown, key: string): T[] {
  if (!container || typeof container !== "object") return [];
  const v = (container as Record<string, unknown>)[key];
  return Array.isArray(v) ? (v as T[]) : [];
}
const children = (s: XmlSelection | XmlForce): XmlSelection[] => list<XmlSelection>(s.selections, "selection");
const categories = (s: XmlSelection): XmlCategory[] => list<XmlCategory>(s.categories, "category");
const associations = (s: XmlSelection): XmlAssociation[] => list<XmlAssociation>(s.associations, "association");
const hasCategory = (s: XmlSelection, key: string): boolean => categories(s).some((c) => normaliseName(c.name ?? "") === key);
const selType = (s: XmlSelection): string => (s.type ?? "").toLowerCase();

/** Positive integer attribute, else `dflt`. */
function num(v: string | undefined, dflt: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : dflt;
}

/** Strips list-export decorations that sometimes leak into selection names: "4x Warden", "Warden [10 pts]", "Warden (10 points)". */
function cleanLabel(name: string): string {
  return name
    .replace(/^\s*\d+\s*[x×]\s+/i, "")
    .replace(/\s*\[[^\]]*\]\s*$/, "")
    .replace(/\s*\(\s*\d+\s*(?:pts?|points?)\s*\)\s*$/i, "")
    .trim();
}

function flattenForces(node: { forces?: unknown }): XmlForce[] {
  const out: XmlForce[] = [];
  for (const f of list<XmlForce>(node.forces, "force")) out.push(f, ...flattenForces(f));
  return out;
}

// ---- configuration selections --------------------------------------------------------------------------------

const SIZE_RE = /\b(combat\s+patrol|incursion|strike\s+force|onslaught)\b/i;
const LIMIT_RE = /(\d{3,5})\s*(?:pts?|points?)\b/i;

/** "Battle Size" → child "2. Strike Force (2000 Point limit)", or a bare "Strike Force" selection. */
function readBattleSize(s: XmlSelection): { size: Roster["battleSize"]; points: number } | undefined {
  const name = s.name ?? "";
  const cands = /battle\s*size/i.test(name) ? [...children(s).map((c) => c.name ?? ""), name] : SIZE_RE.test(name) ? [name] : [];
  for (const c of cands) {
    const m = SIZE_RE.exec(c);
    if (!m) continue;
    const size = SIZE_BY_LABEL[m[1]!.toLowerCase().replace(/\s+/g, " ")];
    if (!size) continue;
    const lm = LIMIT_RE.exec(c);
    return { size, points: lm ? Number(lm[1]) : POINTS_BY_SIZE[size] };
  }
  return undefined;
}

/** A selection named after a detachment, or a "Detachment" wrapper whose child (or grandchild) is. Returns true when handled. */
function readDetachment(s: XmlSelection, ctx: RosterImportContext): boolean {
  const name = cleanLabel(s.name ?? "");
  if (ctx.findDetachment(name)) {
    ctx.addDetachment(name);
    return true;
  }
  const wrapper = /detachment/i.test(name);
  let handled = false;
  for (const k of children(s)) {
    const kn = cleanLabel(k.name ?? "");
    const hit = ctx.findDetachment(kn) ? kn : children(k).map((g) => cleanLabel(g.name ?? "")).find((gn) => ctx.findDetachment(gn));
    if (hit) {
      ctx.addDetachment(hit);
      handled = true;
    } else if (wrapper) {
      ctx.warnings.push(`Unknown detachment "${kn}".`);
      handled = true;
    }
  }
  return handled;
}

function isUnitSelection(s: XmlSelection, ctx: RosterImportContext): boolean {
  const t = selType(s);
  if (t === "unit" || t === "model") return true;
  return t === "upgrade" && !!ctx.findDatasheet(cleanLabel(s.name ?? ""));
}

// ---- units --------------------------------------------------------------------------------------------------

interface Item {
  name: string;
  /** Number of models carrying the item; 0 = every model in the group. */
  n: number;
}
interface RawGroup {
  label: string;
  profile: ModelProfile | undefined;
  count: number;
  items: Item[];
}
/** A leader/host relation found in the XML, resolved once every unit is known. */
interface Link {
  from: PendingUnit;
  fromIs: "leader" | "host" | "unknown";
  toId?: string;
  toName?: string;
  source: string;
}

const LEADER_SIDE_RE = /^(?:attached(?:\s+to)?|leads|leader\s+of|joins|joined\s+to)\b\s*[:\-–—]?\s*(.*)$/i;
const HOST_SIDE_RE = /^(?:led\s+by|leader)\b\s*[:\-–—]?\s*(.*)$/i;

/** Model profile for a BattleScribe model selection name: exact, singular/plural, "Warden w/ …" prefix, or "Sergeant" suffix. */
function matchProfile(ds: Datasheet, label: string): ModelProfile | undefined {
  const key = normaliseName(label);
  if (!key) return undefined;
  const exact = ds.models.find((m) => normaliseName(m.name) === key);
  if (exact) return exact;
  const loose = ds.models.find((m) => normaliseName(m.name).replace(/s$/, "") === key.replace(/s$/, ""));
  if (loose) return loose;
  if (ds.models.length === 1 && normaliseName(ds.name) === key) return ds.models[0];
  const scored = ds.models
    .map((m) => ({ m, k: normaliseName(m.name) }))
    .filter((x) => key.startsWith(`${x.k} `) || x.k.endsWith(` ${key}`))
    .sort((a, b) => b.k.length - a.k.length);
  return scored[0]?.m;
}

function isWeaponOf(ds: Datasheet, key: string): boolean {
  return ds.weapons.some((w) => normaliseName(w.name) === key || (w.groupName !== undefined && normaliseName(w.groupName) === key));
}

/** True when `name` is an enhancement of the roster's faction (or of a detachment already added) and not a weapon of `ds`. */
function isEnhancementOf(ctx: RosterImportContext, ds: Datasheet, name: string): boolean {
  const key = normaliseName(name);
  const enh = ctx.findEnhancement(name);
  if (!enh || isWeaponOf(ds, key)) return false;
  const det = ctx.snapshot.data.detachments.find((d) => d.id === enh.detachmentId);
  return !!det && (det.factionId === ctx.factionId || ctx.detachments.some((d) => d.detachmentId === det.id));
}

/**
 * Splits a model group by the items only some of its models carry (an upgrade with number < model count):
 * items carried by every model go to all sub-groups, partial items peel off their own sub-group.
 */
function splitByWargear(count: number, items: Item[]): { count: number; wargear: string[] }[] {
  const subs: { count: number; wargear: string[] }[] = [{ count, wargear: [] }];
  const add = (w: string[], name: string) => {
    if (!w.includes(name)) w.push(name);
  };
  for (const it of items) if (it.n === 0 || it.n >= count) add(subs[0]!.wargear, it.name);
  for (const it of items) {
    if (it.n === 0 || it.n >= count) continue;
    let remaining = it.n;
    for (const sub of [...subs]) {
      if (remaining <= 0) break;
      if (sub.wargear.includes(it.name)) continue;
      if (sub.count <= remaining) {
        add(sub.wargear, it.name);
        remaining -= sub.count;
      } else {
        sub.count -= remaining;
        subs.push({ count: remaining, wargear: [...sub.wargear, it.name] });
        remaining = 0;
      }
    }
  }
  return subs;
}

function mergeGroup(out: RosterUnit["models"], g: RosterUnit["models"][number]): void {
  const sameGear = (a: string[], b: string[]) => a.length === b.length && [...a].sort().every((x, i) => x === [...b].sort()[i]);
  const existing = out.find((o) => o.modelProfileId === g.modelProfileId && sameGear(o.wargear, g.wargear));
  if (existing) existing.count += g.count;
  else out.push(g);
}

function importUnit(s: XmlSelection, ctx: RosterImportContext, bySelectionId: Map<string, PendingUnit>, links: Link[]): void {
  const { warnings } = ctx;
  const label = cleanLabel(s.name ?? "");
  const ds = ctx.findDatasheet(label);
  if (!ds) {
    warnings.push(`Unknown unit "${label}" — skipped.`);
    return;
  }
  const u = ctx.newUnit(ds);
  if (s.customName?.trim()) u.customName = s.customName.trim();
  if (s.id) bySelectionId.set(s.id, u);
  if (hasCategory(s, "warlord")) u.warlord = true;

  const groups: RawGroup[] = [];
  const unitItems: Item[] = [];
  const setEnhancement = (name: string) => {
    if (!name) return;
    if (!u.enhancementName) u.enhancementName = name;
    else if (normaliseName(u.enhancementName) !== normaliseName(name)) warnings.push(`${u.name}: more than one enhancement ("${u.enhancementName}", "${name}"); kept the first.`);
  };
  const addAssociations = (sel: XmlSelection) => {
    for (const a of associations(sel)) {
      const text = a.name ?? a.label ?? "";
      const toId = a.targetId ?? a.childId ?? a.selectionId ?? a.ids?.split(/[\s,]+/).find(Boolean);
      const leaderSide = LEADER_SIDE_RE.exec(text);
      const hostSide = HOST_SIDE_RE.exec(text);
      const toName = (leaderSide?.[1] ?? hostSide?.[1] ?? "").trim() || undefined;
      if (!toId && !toName) continue;
      links.push({ from: u, fromIs: hostSide ? "host" : leaderSide ? "leader" : "unknown", toId, toName, source: text || toId || "association" });
    }
  };
  const walk = (sel: XmlSelection, group: RawGroup | null) => {
    addAssociations(sel);
    for (const c of children(sel)) {
      const name = cleanLabel(c.name ?? "");
      const key = normaliseName(name);
      if (hasCategory(c, "warlord")) u.warlord = true;
      if (selType(c) === "model") {
        const g: RawGroup = { label: name, profile: matchProfile(ds, name), count: num(c.number, 1), items: [] };
        groups.push(g);
        walk(c, g);
        continue;
      }
      if (key === "warlord") {
        u.warlord = true;
        continue;
      }
      const leaderSide = LEADER_SIDE_RE.exec(name);
      if (leaderSide) {
        const host = leaderSide[1]!.trim() || cleanLabel(children(c)[0]?.name ?? "");
        links.push({ from: u, fromIs: "leader", toName: host || undefined, source: name });
        continue;
      }
      const hostSide = HOST_SIDE_RE.exec(name);
      if (hostSide) {
        const leader = hostSide[1]!.trim() || cleanLabel(children(c)[0]?.name ?? "");
        links.push({ from: u, fromIs: "host", toName: leader || undefined, source: name });
        continue;
      }
      if (/^enhancements?$/.test(key)) {
        for (const k of children(c)) setEnhancement(cleanLabel(k.name ?? ""));
        continue;
      }
      if (hasCategory(c, "enhancement") || hasCategory(c, "enhancements") || isEnhancementOf(ctx, ds, name)) {
        setEnhancement(name);
        continue;
      }
      if (children(c).length) {
        // wrapper (e.g. "Wargear", a model-group holder): its leaves are what matter
        walk(c, group);
        continue;
      }
      if (!name) continue;
      (group ? group.items : unitItems).push({ name, n: num(c.number, 0) });
    }
  };
  walk(s, null);

  if (!groups.length) {
    if (selType(s) === "model") groups.push({ label, profile: matchProfile(ds, label) ?? ds.models[0], count: num(s.number, 1), items: unitItems.splice(0) });
    else for (const g of defaultGroups(ds)) groups.push({ label: "", profile: ds.models.find((m) => m.id === g.modelProfileId), count: g.count, items: [] });
  }
  // unit-level upgrades: every model when the number covers the unit, otherwise the first group
  const total = groups.reduce((sum, g) => sum + g.count, 0);
  for (const it of unitItems) {
    if (it.n === 0 || it.n >= total) for (const g of groups) g.items.push({ name: it.name, n: 0 });
    else groups[0]!.items.push(it);
  }
  const out: RosterUnit["models"] = [];
  for (const g of groups) {
    let profile = g.profile;
    if (!profile) {
      profile = ds.models[0]!;
      if (ds.models.length > 1) warnings.push(`${u.name}: model "${g.label}" not found; used the first profile.`);
    }
    for (const sub of splitByWargear(g.count, g.items)) mergeGroup(out, { modelProfileId: profile.id, count: sub.count, wargear: sub.wargear });
  }
  u.groups = out;
}

function roleFor(leader: Datasheet, host: Datasheet): AttachRole {
  if (leader.supportTo.includes(host.id) && !leader.leaderTo.includes(host.id)) return "support";
  if (leader.isSupport && !leader.leaderTo.length) return "support";
  return "leader";
}

function findUnitByName(ctx: RosterImportContext, name: string, exclude: PendingUnit): PendingUnit | undefined {
  const key = normaliseName(cleanLabel(name));
  const cands = ctx.units.filter((h) => h !== exclude && (normaliseName(h.name) === key || (h.customName !== undefined && normaliseName(h.customName) === key)));
  return cands.find((h) => !ctx.units.some((o) => o.attachHost?.unitId === h.id)) ?? cands[0];
}

function resolveLinks(links: Link[], ctx: RosterImportContext, bySelectionId: Map<string, PendingUnit>): void {
  for (const l of links) {
    const to = (l.toId ? bySelectionId.get(l.toId) : undefined) ?? (l.toName ? findUnitByName(ctx, l.toName, l.from) : undefined);
    if (!to || to === l.from) {
      ctx.warnings.push(`${l.from.name}: host unit "${l.toName ?? l.source}" not found.`);
      continue;
    }
    let fromIs = l.fromIs;
    if (fromIs === "unknown") {
      const fromLeads = l.from.ds.leaderTo.includes(to.ds.id) || l.from.ds.supportTo.includes(to.ds.id);
      const toLeads = to.ds.leaderTo.includes(l.from.ds.id) || to.ds.supportTo.includes(l.from.ds.id);
      fromIs = fromLeads ? "leader" : toLeads ? "host" : to.ds.isCharacter && !l.from.ds.isCharacter ? "host" : "leader";
    }
    const [leader, host] = fromIs === "leader" ? [l.from, to] : [to, l.from];
    if (leader.attachHost && leader.attachHost.unitId !== host.id) {
      ctx.warnings.push(`${leader.name}: attached to more than one unit; kept the first.`);
      continue;
    }
    leader.attachHost = { unitId: host.id, role: roleFor(leader.ds, host.ds) };
  }
}

// ---- entry points -------------------------------------------------------------------------------------------

/** Imports a raw `.ros` document (BattleScribe roster XML). */
export function importRosterXml(xml: string, snapshot: Snapshot, opts: RoszImportOptions = {}): { roster: Roster; warnings: string[] } {
  const text = xml.replace(/^﻿/, "");
  const valid = XMLValidator.validate(text);
  if (valid !== true) throw new Error(`Invalid roster XML: ${valid.err.msg} (line ${valid.err.line}).`);
  const doc = parser.parse(text) as Record<string, unknown>;
  const root = doc.roster as XmlRoster | undefined;
  if (!root || typeof root !== "object") throw new Error("Not a BattleScribe roster: the document has no <roster> root element.");

  const ctx = new RosterImportContext(snapshot);
  const { warnings } = ctx;
  let battleSize: Roster["battleSize"] = "strike-force";
  let pointsLimit = POINTS_BY_SIZE[battleSize];
  const bySelectionId = new Map<string, PendingUnit>();
  const links: Link[] = [];

  for (const force of flattenForces(root)) {
    if (!ctx.factionId) {
      const labels = [force.catalogueName ? catalogueFactionName(force.catalogueName) : "", force.catalogueName ?? "", force.name ?? ""].filter(Boolean);
      for (const l of labels) {
        const f = ctx.findFaction(l);
        if (f) {
          ctx.factionId = f.id;
          break;
        }
      }
    }
    const sels = children(force);
    let detFound = false;
    for (const s of sels) {
      if (isUnitSelection(s, ctx)) continue;
      const size = readBattleSize(s);
      if (size) {
        battleSize = size.size;
        pointsLimit = size.points;
        continue;
      }
      if (readDetachment(s, ctx)) detFound = true;
    }
    if (!detFound && force.name && ctx.findDetachment(force.name)) {
      ctx.addDetachment(force.name);
      detFound = true;
    }
    if (!detFound) warnings.push(`No detachment found in force "${force.name || force.catalogueName || "?"}".`);
    for (const s of sels) if (isUnitSelection(s, ctx)) importUnit(s, ctx, bySelectionId, links);
  }
  if (!ctx.units.length) warnings.push("No units found in the roster.");
  resolveLinks(links, ctx, bySelectionId);
  const name = opts.name ?? (root.name?.trim() || "Imported army");
  return ctx.build({ name, battleSize, pointsLimit });
}

function isZip(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b;
}

/** The roster document inside a `.rosz` archive; raw `.ros` bytes are accepted as well. */
function extractRosterXml(bytes: Uint8Array): string {
  if (!isZip(bytes)) {
    const text = strFromU8(bytes);
    if (/^﻿?\s*<(\?xml|roster)\b/i.test(text)) return text;
    throw new Error("Not a .rosz archive (no zip signature) and not a .ros XML document.");
  }
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes);
  } catch (e) {
    throw new Error(`Could not read the .rosz archive: ${e instanceof Error ? e.message : String(e)}`);
  }
  const names = Object.keys(entries).filter((n) => !n.endsWith("/"));
  const pick = names.find((n) => /\.ros$/i.test(n)) ?? names.find((n) => /\.xml$/i.test(n)) ?? names.find((n) => /^﻿?\s*<\?xml/.test(strFromU8(entries[n]!.subarray(0, 64))));
  if (!pick) throw new Error(`No .ros roster found in the .rosz archive${names.length ? ` (entries: ${names.join(", ")})` : " (the archive is empty)"}.`);
  return strFromU8(entries[pick]!);
}

/** Imports a `.rosz` archive (BattleScribe / New Recruit). Raw `.ros` XML bytes are accepted too. */
export function importRosz(bytes: Uint8Array, snapshot: Snapshot, opts: RoszImportOptions = {}): { roster: Roster; warnings: string[] } {
  return importRosterXml(extractRosterXml(bytes), snapshot, opts);
}
