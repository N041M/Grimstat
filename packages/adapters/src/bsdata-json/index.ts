import type { Ability, Datasheet, Detachment, Enhancement, Faction, GameSystem, ModelProfile, PriceRule, Publication, SourceRef, WargearPrice, WeaponProfile } from "@grimstat/schema";
import { DEFAULT_GAME_SYSTEM_ID, asFileMap, fetchedAtOrNow, type Adapter, type AdapterInput, type AdapterOutput, type DatasheetStub, type ParseOptions } from "../types";
import {
  coreAbilityId,
  datasheetAbilityId,
  datasheetId,
  detachmentAbilityId,
  detachmentId,
  enhancementId,
  factionAbilityId,
  factionId,
  factionSlug,
  modelProfileId,
  slugify,
  uniqueId,
  weaponProfileId,
} from "../util/ids";
import { parseAP, parseDice, parseInches, parseInt0, parseTargetNumber, parseWeaponRange } from "../util/values";
import { parseWeaponKeywords } from "../util/weapon-keywords";
import { parseCoreAbility } from "../util/core-abilities";

export const BSDATA_REPO = "BSData/wh40k-11e";
export const BSDATA_RAW_URL = `https://raw.githubusercontent.com/${BSDATA_REPO}/`;
export const BSDATA_TREE_URL = `https://api.github.com/repos/${BSDATA_REPO}/git/trees/main`;

// ---- loosely typed BattleScribe object model (JSON flavour, as published by BSData) -------------
export interface BsCharacteristic {
  name: string;
  $text?: string;
  typeId?: string;
}
export interface BsProfile {
  id?: string;
  name: string;
  typeName?: string;
  typeId?: string;
  hidden?: boolean;
  characteristics?: BsCharacteristic[];
}
export interface BsRule {
  id?: string;
  name: string;
  description?: string;
  hidden?: boolean;
}
export interface BsCost {
  name?: string;
  typeId?: string;
  value?: number;
}
export interface BsCondition {
  childId?: string;
  childName?: string;
  field?: string;
  scope?: string;
  type?: string;
  value?: number;
}
export interface BsConditionGroup {
  type?: string;
  conditions?: BsCondition[];
  conditionGroups?: BsConditionGroup[];
}
export interface BsModifier {
  field?: string;
  type?: string;
  value?: unknown;
  conditions?: BsCondition[];
  conditionGroups?: BsConditionGroup[];
}
export interface BsModifierGroup {
  modifiers?: BsModifier[];
  modifierGroups?: BsModifierGroup[];
  conditions?: BsCondition[];
  conditionGroups?: BsConditionGroup[];
}
export interface BsConstraint {
  id?: string;
  field?: string;
  scope?: string;
  type?: string;
  value?: number;
}
/** New Recruit extension: a unit's Leader / Support relations. */
export interface BsAssociation {
  name?: string;
  label?: string;
  min?: number;
  max?: number;
  scope?: string;
  conditions?: BsCondition[];
  conditionGroups?: BsConditionGroup[];
}
export interface BsLink {
  id?: string;
  name?: string;
  targetId: string;
  type?: string;
  hidden?: boolean;
}
export interface BsCategoryLink {
  name?: string;
  targetId?: string;
  primary?: boolean;
}
export interface BsEntry {
  id?: string;
  name?: string;
  type?: string;
  hidden?: boolean;
  comment?: string;
  profiles?: BsProfile[];
  rules?: BsRule[];
  infoLinks?: BsLink[];
  infoGroups?: BsEntry[];
  entryLinks?: BsLink[];
  selectionEntries?: BsEntry[];
  selectionEntryGroups?: BsEntry[];
  categoryLinks?: BsCategoryLink[];
  costs?: BsCost[];
  constraints?: BsConstraint[];
  modifiers?: BsModifier[];
  modifierGroups?: BsModifierGroup[];
  associations?: BsAssociation[];
}
export interface BsCatalogue extends BsEntry {
  revision?: number;
  library?: boolean;
  gameSystemId?: string;
  gameSystemRevision?: number;
  catalogueLinks?: { targetId: string; name?: string; importRootEntries?: boolean }[];
  categoryEntries?: { id: string; name: string }[];
  costTypes?: { id: string; name: string }[];
  profileTypes?: { id: string; name: string }[];
  publications?: { id: string; name: string; shortName?: string; publisherUrl?: string }[];
  sharedSelectionEntries?: BsEntry[];
  sharedSelectionEntryGroups?: BsEntry[];
  sharedRules?: BsRule[];
  sharedProfiles?: BsProfile[];
  sharedInfoGroups?: BsEntry[];
}

/** Loosely typed extras for the future army builder. */
export interface BsdataStaging {
  catalogues: { file: string; id: string; name: string; library: boolean; revision?: number; factionId?: string }[];
  /** canonical datasheet id -> raw selection entry (links inside are NOT resolved) */
  entries: Record<string, BsEntry>;
  /** canonical datasheet id -> upstream entry id */
  upstreamIds: Record<string, string>;
  detachmentEntries: Record<string, BsEntry>;
  unresolvedLinks: { catalogue: string; name: string; targetId: string }[];
  unlinkedEnhancements: string[];
  skippedRootEntries: string[];
}

interface Doc {
  file: string;
  kind: "gameSystem" | "catalogue";
  root: BsCatalogue;
}

interface Indexed {
  node: Record<string, unknown>;
  doc: Doc;
  /** container key the node was found under: sharedSelectionEntries, selectionEntryGroups, sharedRules, profiles, categoryEntries, ... */
  kind: string;
}

const VALUE_REQUIRED = new Set(["FEEL NO PAIN", "SCOUTS", "FIRING DECK", "DAMAGED"]);
const FORCE_DISPOSITIONS = new Set(["TAKE AND HOLD", "PURGE THE FOE", "PRIORITY ASSETS", "RECONNAISSANCE", "DISRUPTION"]);
/** Groups/links under a unit that are not part of the datasheet (Crusade bookkeeping, list-building plumbing). */
const SKIP_RE = /^(crusade|weapon modifications|codex battle traits|battle traits|battle scars|(codex )?crusade relics|relics|specialisms|enhancements?|warlord|detachment|order of battle|legendary veterans|experience points|battle honours|battle size|show\/hide options)$/i;
const CONTAINER_KEYS = ["sharedSelectionEntries", "sharedSelectionEntryGroups", "selectionEntries", "selectionEntryGroups", "entryLinks", "infoLinks", "infoGroups", "sharedInfoGroups", "profiles", "sharedProfiles", "rules", "sharedRules", "categoryEntries", "costTypes", "profileTypes", "publications", "catalogueLinks", "categoryLinks", "forceEntries"];

export function catalogueFactionName(name: string): string {
  let n = name.trim();
  n = n.replace(/\s*-\s*Library$/i, "").replace(/^Library\s*-\s*/i, "").replace(/\s+Library$/i, "");
  const m = /^(Imperium|Chaos|Xenos|Aeldari)\s*-\s*(.+)$/i.exec(n);
  if (m) n = (m[2] as string).trim();
  return n;
}

function isLibrary(doc: Doc): boolean {
  return doc.kind === "catalogue" && (doc.root.library === true || /library/i.test(doc.root.name ?? ""));
}

function charMap(p: BsProfile): Record<string, string> {
  const out: Record<string, string> = {};
  for (const c of p.characteristics ?? []) out[c.name] = (c.$text ?? "").trim();
  return out;
}

type ProfileKind = "unit" | "weapon" | "ability" | "transport" | "other";
function classifyProfile(p: BsProfile): ProfileKind {
  const t = (p.typeName ?? "").toLowerCase();
  const names = new Set((p.characteristics ?? []).map((c) => c.name));
  if (t === "unit" || (names.has("T") && names.has("Sv") && names.has("W"))) return "unit";
  if (names.has("A") && names.has("S") && names.has("AP") && names.has("D")) return "weapon";
  if (t === "transport" || names.has("Capacity")) return "transport";
  if (/abilit|power|trait|effect/i.test(t) || (names.size === 1 && /^(description|descriptions|effect|text)$/i.test([...names][0] ?? ""))) return "ability";
  return "other";
}

function abilityText(p: BsProfile): string {
  const c = charMap(p);
  return (c["Description"] ?? c["Descriptions"] ?? c["Effect"] ?? Object.values(c)[0] ?? "").trim();
}

function* conditionsOf(m: { conditions?: BsCondition[]; conditionGroups?: BsConditionGroup[] } | undefined): Generator<BsCondition> {
  if (!m) return;
  for (const c of m.conditions ?? []) yield c;
  for (const g of m.conditionGroups ?? []) yield* conditionsOf(g);
}

function* modifiersOf(e: { modifiers?: BsModifier[]; modifierGroups?: BsModifierGroup[] } | undefined): Generator<BsModifier> {
  if (!e) return;
  for (const m of e.modifiers ?? []) yield m;
  for (const g of e.modifierGroups ?? []) yield* modifiersOf(g);
}

function cleanName(raw: string): { name: string; tags: string[] } {
  const tags: string[] = [];
  const name = raw
    .replace(/\s*\[([^\]]*)\]/g, (_m, t: string) => {
      tags.push(t.trim());
      return "";
    })
    .replace(/\s+/g, " ")
    .trim();
  return { name, tags };
}

class Warnings {
  private buckets = new Map<string, string[]>();
  add(bucket: string, msg: string): void {
    const list = this.buckets.get(bucket) ?? [];
    list.push(msg);
    this.buckets.set(bucket, list);
  }
  flush(into: string[], limit = 5): void {
    for (const [bucket, list] of this.buckets) {
      for (const m of list.slice(0, limit)) into.push(`${bucket}: ${m}`);
      if (list.length > limit) into.push(`${bucket}: ... and ${list.length - limit} more`);
    }
  }
}

interface Collected {
  unitProfiles: Map<string, BsProfile>;
  weapons: Map<string, { p: BsProfile; melee: boolean }>;
  abilityProfiles: { p: BsProfile; wargear: boolean }[];
  rules: { r: BsRule; shared: boolean }[];
  transports: string[];
  associations: BsAssociation[];
  wargearCosts: Map<string, number>;
  composition: { description: string; min?: number; max?: number }[];
}

/**
 * Parse a set of BSData wh40k-11e JSON files (the game system plus catalogues and their libraries).
 * Thin faction catalogues import "Library" catalogues via `catalogueLinks`; all `entryLinks` are
 * resolved across the whole set. Constraint/modifier semantics are NOT evaluated — the raw entries
 * are kept in `staging` for the army builder.
 */
export function parse(input: AdapterInput, opts: ParseOptions = {}): AdapterOutput {
  const files = asFileMap(input, "catalogue.json");
  const gameSystemId = opts.gameSystemId ?? DEFAULT_GAME_SYSTEM_ID;
  const warnings: string[] = [];
  const bucket = new Warnings();

  // ---- load documents --------------------------------------------------------------------------
  const docs: Doc[] = [];
  for (const [file, text] of Object.entries(files)) {
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch (e) {
      warnings.push(`${file}: JSON parse error: ${(e as Error).message}`);
      continue;
    }
    if (!json || typeof json !== "object") {
      warnings.push(`${file}: not a BSData document, ignored`);
      continue;
    }
    const obj = json as Record<string, unknown>;
    if (obj["gameSystem"] && typeof obj["gameSystem"] === "object") docs.push({ file, kind: "gameSystem", root: obj["gameSystem"] as BsCatalogue });
    else if (obj["catalogue"] && typeof obj["catalogue"] === "object") docs.push({ file, kind: "catalogue", root: obj["catalogue"] as BsCatalogue });
    else warnings.push(`${file}: neither "gameSystem" nor "catalogue" root key, ignored`);
  }
  docs.sort((a, b) => (a.kind === b.kind ? (a.root.name ?? "").localeCompare(b.root.name ?? "") : a.kind === "gameSystem" ? -1 : 1));
  const gsDoc = docs.find((d) => d.kind === "gameSystem");

  // ---- global id index --------------------------------------------------------------------------
  const index = new Map<string, Indexed>();
  const walkIndex = (node: unknown, doc: Doc, kind: string): void => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const n of node) walkIndex(n, doc, kind);
      return;
    }
    const obj = node as Record<string, unknown>;
    const id = obj["id"];
    if (typeof id === "string" && kind !== "root" && !index.has(id)) index.set(id, { node: obj, doc, kind });
    for (const key of CONTAINER_KEYS) if (Array.isArray(obj[key])) walkIndex(obj[key], doc, key);
  };
  for (const d of docs) walkIndex(d.root, d, "root");
  const docById = new Map<string, Doc>();
  for (const d of docs) if (d.root.id) docById.set(d.root.id, d);

  const costTypes = new Map<string, string>(); // name -> id
  for (const d of docs) for (const ct of d.root.costTypes ?? []) costTypes.set(ct.name.toLowerCase(), ct.id);
  const ptsTypeId = costTypes.get("pts");
  const dpTypeId = costTypes.get("detachment points");
  const costValue = (costs: BsCost[] | undefined, name: string, typeId: string | undefined): number | undefined => {
    for (const c of costs ?? []) {
      if ((typeId && c.typeId === typeId) || (c.name ?? "").toLowerCase() === name) return typeof c.value === "number" ? c.value : undefined;
    }
    return undefined;
  };

  // ---- output containers -----------------------------------------------------------------------
  const factions: Faction[] = [];
  const datasheets: Datasheet[] = [];
  const abilities: Ability[] = [];
  const abilityIds = new Set<string>();
  const detachments: Detachment[] = [];
  const enhancements: Enhancement[] = [];
  const priceRules: PriceRule[] = [];
  const wargearPrices: WargearPrice[] = [];
  const publications: Publication[] = [];
  const dsIds = new Set<string>();
  const detIds = new Set<string>();
  const enhIds = new Set<string>();
  const staging: BsdataStaging = { catalogues: [], entries: {}, upstreamIds: {}, detachmentEntries: {}, unresolvedLinks: [], unlinkedEnhancements: [], skippedRootEntries: [] };
  const addAbility = (a: Ability): Ability => {
    if (!abilityIds.has(a.id)) {
      abilityIds.add(a.id);
      abilities.push(a);
    }
    return a;
  };

  /** category entry id -> datasheet ids whose root entry links that category */
  const dsByCategory = new Map<string, string[]>();
  /** root entry id -> datasheet id */
  const dsByEntryId = new Map<string, string>();
  const pendingAssociations: { ds: Datasheet; factionName: string; assoc: BsAssociation[] }[] = [];
  /** detachment entry id -> detachment */
  const detByEntryId = new Map<string, Detachment>();

  // ---- game system ------------------------------------------------------------------------------
  let gameSystem: GameSystem | undefined;
  if (gsDoc) {
    gameSystem = {
      id: gameSystemId,
      name: (gsDoc.root.name ?? "Warhammer 40,000").replace(/\s*11th Edition\s*$/i, ""),
      edition: "11",
      version: gsDoc.root.revision !== undefined ? `r${gsDoc.root.revision}` : "",
      costTypes: (gsDoc.root.costTypes ?? []).map((c) => ({ id: c.id, name: c.name })),
    };
    if (!gameSystem.version) delete gameSystem.version;
    for (const p of gsDoc.root.publications ?? []) {
      const pub: Publication = { id: `pub:bsdata:${p.id}`, name: p.name };
      publications.push(pub);
    }
  } else warnings.push("no game system file (root key \"gameSystem\") in input; cost types resolved by name only");

  // ---- helpers ----------------------------------------------------------------------------------
  const resolve = (targetId: string): Indexed | undefined => index.get(targetId);

  /** Root-level selectable entries of a faction catalogue, including entries imported from linked libraries. */
  const rootEntries = (doc: Doc, seen = new Set<string>()): { entry: BsEntry; via: Doc }[] => {
    const out: { entry: BsEntry; via: Doc }[] = [];
    if (doc.root.id) {
      if (seen.has(doc.root.id)) return out;
      seen.add(doc.root.id);
    }
    for (const e of doc.root.selectionEntries ?? []) out.push({ entry: e, via: doc });
    for (const link of doc.root.entryLinks ?? []) {
      const hit = resolve(link.targetId);
      if (!hit) {
        staging.unresolvedLinks.push({ catalogue: doc.root.name ?? doc.file, name: link.name ?? "", targetId: link.targetId });
        continue;
      }
      out.push({ entry: hit.node as BsEntry, via: hit.doc });
    }
    for (const cl of doc.root.catalogueLinks ?? []) {
      const target = docById.get(cl.targetId);
      if (!target) {
        staging.unresolvedLinks.push({ catalogue: doc.root.name ?? doc.file, name: cl.name ?? "(catalogue)", targetId: cl.targetId });
        continue;
      }
      if (!isLibrary(target)) continue; // allied faction catalogue: its units belong to that faction
      if (cl.importRootEntries === false) continue;
      out.push(...rootEntries(target, seen));
    }
    return out;
  };

  const collect = (entry: BsEntry, col: Collected, visited: Set<object>, inUpgrade: boolean, isRoot: boolean): void => {
    if (visited.has(entry)) return;
    visited.add(entry);
    const takeProfile = (p: BsProfile): void => {
      switch (classifyProfile(p)) {
        case "unit":
          if (!col.unitProfiles.has(p.name)) col.unitProfiles.set(p.name, p);
          break;
        case "weapon": {
          const c = charMap(p);
          const melee = /melee/i.test(p.typeName ?? "") || "WS" in c || /^melee$/i.test(c["Range"] ?? "");
          const key = `${melee ? "m" : "r"}:${p.name}`;
          if (!col.weapons.has(key)) col.weapons.set(key, { p, melee });
          break;
        }
        case "ability":
          col.abilityProfiles.push({ p, wargear: inUpgrade });
          break;
        case "transport":
          col.transports.push(abilityText(p));
          break;
        default:
          break;
      }
    };
    for (const p of entry.profiles ?? []) takeProfile(p);
    if (!inUpgrade) for (const r of entry.rules ?? []) col.rules.push({ r, shared: false });
    const takeInfoGroup = (g: BsEntry): void => {
      if (visited.has(g)) return;
      visited.add(g);
      if (/detachment/i.test(g.name ?? "")) return; // detachment rules are not unit abilities
      for (const p of g.profiles ?? []) takeProfile(p);
      if (!inUpgrade) for (const r of g.rules ?? []) col.rules.push({ r, shared: false });
      for (const l of g.infoLinks ?? []) takeInfoLink(l);
      for (const sub of g.infoGroups ?? []) takeInfoGroup(sub);
    };
    const takeInfoLink = (l: BsLink): void => {
      const hit = resolve(l.targetId);
      if (!hit) return;
      if (l.type === "rule" || hit.kind === "sharedRules" || hit.kind === "rules") {
        if (!inUpgrade) col.rules.push({ r: hit.node as unknown as BsRule, shared: true });
      } else if (l.type === "profile" || hit.kind === "sharedProfiles" || hit.kind === "profiles") takeProfile(hit.node as unknown as BsProfile);
      else if (l.type === "infoGroup" || hit.kind === "sharedInfoGroups" || hit.kind === "infoGroups") {
        if (/detachment/i.test(l.name ?? "")) return;
        takeInfoGroup(hit.node as BsEntry);
      }
    };
    for (const l of entry.infoLinks ?? []) takeInfoLink(l);
    for (const g of entry.infoGroups ?? []) takeInfoGroup(g);
    for (const a of entry.associations ?? []) col.associations.push(a);
    if (!isRoot && entry.type === "upgrade") {
      const pts = costValue(entry.costs, "pts", ptsTypeId);
      if (pts && pts > 0 && entry.name && !col.wargearCosts.has(entry.name)) col.wargearCosts.set(entry.name, pts);
    }

    const minMax = (constraints: BsConstraint[] | undefined): { min?: number; max?: number } => {
      const out: { min?: number; max?: number } = {};
      for (const c of constraints ?? []) {
        if (c.field !== "selections" || typeof c.value !== "number") continue;
        if (c.type === "min" && c.value >= 0) out.min = c.value;
        if (c.type === "max" && c.value >= 0) out.max = c.value;
      }
      return out;
    };
    const isModelEntry = (e: BsEntry): boolean => e.type === "model";
    const isModelLink = (l: BsLink): boolean => (resolve(l.targetId)?.node as BsEntry | undefined)?.type === "model";
    if (isRoot) {
      for (const g of entry.selectionEntryGroups ?? []) {
        const name = g.name ?? "";
        if (SKIP_RE.test(name)) continue;
        const models = [...(g.selectionEntries ?? []).filter(isModelEntry), ...(g.entryLinks ?? []).filter(isModelLink).map((l) => resolve(l.targetId)?.node as BsEntry)];
        if (!models.length) continue;
        let mm = minMax(g.constraints);
        if (mm.min === undefined && mm.max === undefined) {
          let min = 0;
          let max = 0;
          let any = false;
          for (const m of models) {
            const c = minMax(m.constraints);
            if (c.min !== undefined) min += c.min;
            if (c.max !== undefined) max += c.max;
            if (c.min !== undefined || c.max !== undefined) any = true;
          }
          if (any) mm = { min, max: max || undefined };
        }
        const comp: { description: string; min?: number; max?: number } = { description: /^\d/.test(name) ? name : describeRange(mm, name) };
        if (mm.min !== undefined) comp.min = mm.min;
        if (mm.max !== undefined) comp.max = mm.max;
        col.composition.push(comp);
      }
      for (const m of (entry.selectionEntries ?? []).filter(isModelEntry)) {
        const mm = minMax(m.constraints);
        const comp: { description: string; min?: number; max?: number } = { description: describeRange(mm, m.name ?? "model") };
        if (mm.min !== undefined) comp.min = mm.min;
        if (mm.max !== undefined) comp.max = mm.max;
        col.composition.push(comp);
      }
    }

    for (const child of entry.selectionEntries ?? []) {
      if (SKIP_RE.test(child.name ?? "")) continue;
      collect(child, col, visited, inUpgrade || child.type === "upgrade", false);
    }
    for (const g of entry.selectionEntryGroups ?? []) {
      if (SKIP_RE.test(g.name ?? "")) continue;
      collect(g, col, visited, inUpgrade, false);
    }
    for (const link of entry.entryLinks ?? []) {
      if (SKIP_RE.test(link.name ?? "")) continue;
      const hit = resolve(link.targetId);
      if (!hit) continue;
      const target = hit.node as BsEntry;
      if (target.type === "unit") continue; // another datasheet
      if (SKIP_RE.test(target.name ?? "")) continue;
      collect(target, col, visited, inUpgrade || target.type === "upgrade", false);
    }
  };

  const buildModel = (dsId: string, p: BsProfile, used: Set<string>): ModelProfile | null => {
    const c = charMap(p);
    const T = parseInt0(c["T"]);
    const Sv = parseTargetNumber(c["Sv"]);
    const W = parseInt0(c["W"]);
    if (T === null || Sv === null || W === null) return null;
    const mp: ModelProfile = {
      id: uniqueId(modelProfileId(dsId, p.name), used),
      name: p.name,
      M: parseInches(c["M"]),
      T,
      Sv,
      InvSv: parseTargetNumber(c["InSv"] ?? c["Inv"] ?? c["InvSv"]),
      W,
      Ld: parseTargetNumber(c["LD"] ?? c["Ld"]),
      OC: parseInt0(c["OC"]),
    };
    return mp;
  };

  const buildWeapon = (dsId: string, p: BsProfile, melee: boolean, used: Set<string>): WeaponProfile | null => {
    const c = charMap(p);
    const rg = parseWeaponRange(c["Range"]);
    const kind: "ranged" | "melee" = melee || rg.kind === "melee" ? "melee" : "ranged";
    const A = parseDice(c["A"]);
    const S = parseInt0(c["S"]);
    const D = parseDice(c["D"]);
    if (A === null || S === null || D === null) return null;
    const wp: WeaponProfile = {
      id: uniqueId(weaponProfileId(dsId, p.name), used),
      name: p.name,
      kind,
      range: kind === "melee" ? null : rg.range,
      A,
      skill: parseTargetNumber(c["BS"] ?? c["WS"]),
      S,
      AP: parseAP(c["AP"]) ?? 0,
      D,
      keywords: parseWeaponKeywords(c["Keywords"]),
    };
    const sep = / [-–] /.exec(p.name);
    if (sep) wp.groupName = p.name.slice(0, sep.index).trim();
    return wp;
  };

  // ---- factions & datasheets --------------------------------------------------------------------
  const factionDocs = docs.filter((d) => d.kind === "catalogue" && !isLibrary(d));
  for (const d of docs) {
    if (d.kind !== "catalogue") continue;
    staging.catalogues.push({ file: d.file, id: d.root.id ?? "", name: d.root.name ?? d.file, library: isLibrary(d), revision: d.root.revision });
  }
  const factionByIdOut = new Map<string, Faction>();
  const ensureFaction = (name: string): Faction => {
    const id = factionId(name);
    let f = factionByIdOut.get(id);
    if (!f) {
      f = { id, gameSystemId, name, keywords: [] };
      factionByIdOut.set(id, f);
      factions.push(f);
    }
    return f;
  };
  const GENERIC_FACTION_CATEGORIES = new Set(["imperium", "chaos"]);
  const factionCategories = (entry: BsEntry): string[] =>
    (entry.categoryLinks ?? [])
      .map((cl) => (cl.name ?? "").trim())
      .filter((n) => /^faction:\s*/i.test(n))
      .map((n) => n.replace(/^faction:\s*/i, "").trim())
      .filter((n) => n && !GENERIC_FACTION_CATEGORIES.has(factionSlug(n)));
  /**
   * Which faction a root entry belongs to. Entries defined in the faction's own catalogue belong to it;
   * entries imported from a library belong to the faction named by their "Faction: X" category (shared
   * libraries such as Unaligned Forces or Titans are imported by several factions), falling back to the
   * importing faction for private libraries and finally to the library's own name.
   */
  const attributeFaction = (entry: BsEntry, via: Doc, owner: Doc, ownerName: string): string => {
    if (via === owner) return ownerName;
    const cats = factionCategories(entry);
    const ownerSlug = factionSlug(ownerName);
    if (cats.some((c) => factionSlug(c) === ownerSlug)) return ownerName;
    if (cats.length === 1) return cats[0] as string;
    const libName = catalogueFactionName(via.root.name ?? via.file);
    if (factionSlug(libName) === ownerSlug || libName.toLowerCase().includes(ownerName.toLowerCase())) return ownerName;
    if (cats.length > 1) return cats[0] as string;
    return libName;
  };
  const emitted = new Set<string>(); // `${factionSlug}|${entryId}`
  const enhancementNames = new Set<string>();
  for (const d of docs) for (const g of d.root.sharedSelectionEntryGroups ?? []) if (/^enhancements$/i.test(g.name ?? "")) for (const e of g.selectionEntries ?? []) if (e.name) enhancementNames.add(cleanName(e.name).name.toLowerCase());

  for (const doc of factionDocs) {
    const ownerName = catalogueFactionName(doc.root.name ?? doc.file);
    const ownerFaction = ensureFaction(ownerName);
    const cat = staging.catalogues.find((c) => c.file === doc.file);
    if (cat) cat.factionId = ownerFaction.id;

    const detachmentRoots: BsEntry[] = [];
    for (const { entry, via } of rootEntries(doc)) {
      const rawName = entry.name ?? "";
      if (entry.type === "upgrade" && /^detachment$/i.test(rawName)) {
        detachmentRoots.push(entry);
        continue;
      }
      if (entry.type !== "unit" && entry.type !== "model") {
        staging.skippedRootEntries.push(`${ownerName}: ${rawName}`);
        continue;
      }
      const { name, tags } = cleanName(rawName);
      if (!name) continue;
      const factionName = attributeFaction(entry, via, doc, ownerName);
      const faction = ensureFaction(factionName);
      const fId = faction.id;
      const emitKey = `${factionSlug(factionName)}|${entry.id ?? rawName}`;
      if (emitted.has(emitKey)) continue;
      emitted.add(emitKey);
      const col: Collected = { unitProfiles: new Map(), weapons: new Map(), abilityProfiles: [], rules: [], transports: [], associations: [], wargearCosts: new Map(), composition: [] };
      collect(entry, col, new Set(), false, true);
      if (col.unitProfiles.size === 0) {
        bucket.add("no Unit profile", `${factionName}/${name}`);
        continue;
      }
      const id = uniqueId(datasheetId(factionName, name), dsIds);
      const ds: Datasheet = {
        id,
        gameSystemId,
        factionId: fId,
        name,
        isLegends: tags.some((t) => /legends/i.test(t)),
        isCharacter: false,
        isEpicHero: false,
        isBattleline: false,
        isSupport: false,
        keywords: [],
        factionKeywords: [],
        models: [],
        weapons: [],
        abilityIds: [],
        stratagemIds: [],
        leaderTo: [],
        supportTo: [],
        composition: col.composition,
        wargearOptions: [],
      };
      for (const t of tags) if (!/legends/i.test(t)) ds.keywords.push(t.toUpperCase());
      for (const cl of entry.categoryLinks ?? []) {
        const n = (cl.name ?? "").trim();
        if (!n) continue;
        if (/^faction:\s*/i.test(n)) {
          const k = n.replace(/^faction:\s*/i, "").toUpperCase();
          if (!ds.factionKeywords.includes(k)) ds.factionKeywords.push(k);
        } else if (/^allies:/i.test(n) || /^\d+\s*DP\b/i.test(n)) continue;
        else if (/^legends$/i.test(n)) ds.isLegends = true;
        else {
          const k = n.toUpperCase();
          if (!ds.keywords.includes(k)) ds.keywords.push(k);
        }
        if (cl.targetId) {
          const list = dsByCategory.get(cl.targetId) ?? [];
          list.push(id);
          dsByCategory.set(cl.targetId, list);
        }
      }
      ds.isCharacter = ds.keywords.includes("CHARACTER");
      ds.isEpicHero = ds.keywords.includes("EPIC HERO");
      ds.isBattleline = ds.keywords.includes("BATTLELINE");
      if (col.transports.length) ds.transportCapacity = col.transports.join(" ");

      const modelIds = new Set<string>();
      for (const p of col.unitProfiles.values()) {
        const mp = buildModel(id, p, modelIds);
        if (mp) ds.models.push(mp);
        else bucket.add("unparsable Unit profile", `${factionName}/${name}/${p.name}`);
      }
      if (!ds.models.length) {
        bucket.add("no Unit profile", `${factionName}/${name}`);
        continue;
      }
      const weaponIds = new Set<string>();
      const orderedWeapons = [...col.weapons.values()].sort((a, b) => Number(a.melee) - Number(b.melee) || a.p.name.localeCompare(b.p.name));
      for (const { p, melee } of orderedWeapons) {
        const wp = buildWeapon(id, p, melee, weaponIds);
        if (wp) ds.weapons.push(wp);
        else bucket.add("unparsable weapon profile", `${factionName}/${name}/${p.name}`);
      }

      // abilities: profiles (datasheet / wargear scope) + rules (core / faction / datasheet scope)
      const localAbilityIds = new Set<string>();
      const attach = (a: Ability): void => {
        const added = addAbility(a);
        if (!ds.abilityIds.includes(added.id)) ds.abilityIds.push(added.id);
        localAbilityIds.add(added.id);
        if (added.coreKeyword === "SUPPORT") ds.isSupport = true;
      };
      for (const { p, wargear } of col.abilityProfiles) {
        const text = abilityText(p);
        const core = parseCoreAbility(p.name);
        if (core) {
          const a: Ability = { id: coreAbilityId(core.keyword, core.value), name: p.name, scope: "core", text, coreKeyword: core.keyword, isLegends: false };
          if (core.value !== undefined) a.coreValue = core.value;
          attach(a);
          continue;
        }
        const a: Ability = { id: uniqueId(datasheetAbilityId(id, p.name), abilityIds), name: p.name, scope: wargear ? "wargear" : "datasheet", text, factionId: fId, isLegends: ds.isLegends };
        abilities.push(a);
        ds.abilityIds.push(a.id);
        localAbilityIds.add(a.id);
      }
      for (const { r, shared } of col.rules) {
        const text = (r.description ?? "").trim();
        const core = parseCoreAbility(r.name);
        if (core) {
          const a: Ability = { id: coreAbilityId(core.keyword, core.value), name: r.name, scope: "core", text, coreKeyword: core.keyword, isLegends: false };
          if (core.value !== undefined) a.coreValue = core.value;
          attach(a);
        } else if (shared) {
          attach({ id: factionAbilityId(factionName, r.name), name: r.name, scope: "faction", text, factionId: fId, isLegends: false });
        } else {
          const a: Ability = { id: uniqueId(datasheetAbilityId(id, r.name), abilityIds), name: r.name, scope: "datasheet", text, factionId: fId, isLegends: ds.isLegends };
          abilities.push(a);
          ds.abilityIds.push(a.id);
          localAbilityIds.add(a.id);
        }
      }
      // a value-less core ability ("Deadly Demise" rule) is redundant next to a valued one ("Deadly Demise D3" profile);
      // value-carrying keywords without a value (a generic "Feel No Pain" rule reference) are unusable and dropped.
      const byId = new Map(abilities.map((a) => [a.id, a] as const));
      const valued = new Set(ds.abilityIds.map((x) => byId.get(x)).filter((a) => a?.coreKeyword && a.coreValue !== undefined).map((a) => a!.coreKeyword as string));
      ds.abilityIds = ds.abilityIds.filter((x) => {
        const a = byId.get(x);
        if (!a?.coreKeyword || a.coreValue !== undefined) return true;
        if (valued.has(a.coreKeyword)) return false;
        if (VALUE_REQUIRED.has(a.coreKeyword)) {
          bucket.add("value-less core ability dropped", `${factionName}/${name}: ${a.name}`);
          return false;
        }
        return true;
      });

      // points
      const base = costValue(entry.costs, "pts", ptsTypeId);
      if (base !== undefined && base > 0) {
        const mins = ds.composition.map((c) => c.min).filter((m): m is number => typeof m === "number" && m > 0);
        const maxes = ds.composition.map((c) => c.max ?? c.min).filter((m): m is number => typeof m === "number" && m > 0);
        const minModels = mins.length ? mins.reduce((a, b) => a + b, 0) : 1;
        const maxModels = maxes.length ? maxes.reduce((a, b) => a + b, 0) : minModels;
        const tiers = new Map<number, number>([[minModels, base]]);
        for (const m of modifiersOf(entry)) {
          if (m.type !== "set" || typeof m.value !== "number" || !ptsTypeId || m.field !== ptsTypeId) continue;
          for (const c of conditionsOf(m)) {
            if (c.childId !== "model" || c.type !== "atLeast" || typeof c.value !== "number") continue;
            const models = c.value <= maxModels ? maxModels : c.value;
            if (!tiers.has(models)) tiers.set(models, m.value);
          }
        }
        const rule: PriceRule = {
          datasheetId: id,
          copyRange: { min: 1 },
          tiers: [...tiers.entries()].sort((a, b) => a[0] - b[0]).map(([models, points]) => ({ models, points })),
        };
        priceRules.push(rule);
        ds.fallbackPoints = base;
      }
      for (const [item, points] of col.wargearCosts) wargearPrices.push({ datasheetId: id, item, points });

      datasheets.push(ds);
      if (entry.id) {
        dsByEntryId.set(entry.id, id);
        staging.upstreamIds[id] = entry.id;
      }
      staging.entries[id] = entry;
      if (col.associations.length) pendingAssociations.push({ ds, factionName, assoc: col.associations });
    }

    // ---- detachments ---------------------------------------------------------------------------
    const factionName = ownerName;
    const fId = ownerFaction.id;
    for (const root of detachmentRoots) {
      const leaves: BsEntry[] = [];
      const seen = new Set<object>();
      const dig = (node: BsEntry, depth: number): void => {
        if (seen.has(node) || depth > 4) return;
        seen.add(node);
        for (const e of node.selectionEntries ?? []) {
          if (e.type === "upgrade" && !(e.selectionEntries?.length || e.selectionEntryGroups?.length)) leaves.push(e);
          else dig(e, depth + 1);
        }
        for (const g of node.selectionEntryGroups ?? []) dig(g, depth + 1);
        for (const l of node.entryLinks ?? []) {
          const hit = resolve(l.targetId);
          if (hit) dig(hit.node as BsEntry, depth + 1);
        }
      };
      dig(root, 0);
      for (const e of leaves) {
        const name = cleanName(e.name ?? "").name;
        if (!name) continue;
        const detId = uniqueId(detachmentId(factionName, name), detIds);
        let dp = costValue(e.costs, "detachment points", dpTypeId);
        if (dp === undefined || dp <= 0) {
          bucket.add("detachment without DP (defaulted to 1)", `${factionName}/${name}`);
          dp = 1;
        }
        const det: Detachment = { id: detId, factionId: fId, name, dp, forceDispositions: [], ruleAbilityIds: [], enhancementIds: [], stratagemIds: [] };
        for (const cl of e.categoryLinks ?? []) {
          const n = (cl.name ?? "").trim();
          if (!n || /^\d+\s*DP\b/i.test(n)) continue;
          if (FORCE_DISPOSITIONS.has(n.toUpperCase())) det.forceDispositions.push(n.toUpperCase());
          else if (!det.uniqueTag) det.uniqueTag = n;
        }
        const addDetRule = (rname: string, text: string): void => {
          const a: Ability = { id: uniqueId(detachmentAbilityId(detId, rname), abilityIds), name: rname, scope: "detachment", text, factionId: fId, isLegends: false };
          abilities.push(a);
          det.ruleAbilityIds.push(a.id);
        };
        for (const r of e.rules ?? []) addDetRule(r.name, (r.description ?? "").trim());
        for (const l of e.infoLinks ?? []) {
          const hit = resolve(l.targetId);
          if (!hit) continue;
          if (hit.kind === "sharedRules" || hit.kind === "rules" || l.type === "rule") {
            const r = hit.node as unknown as BsRule;
            addDetRule(r.name, (r.description ?? "").trim());
          } else if (hit.kind === "sharedProfiles" || l.type === "profile") {
            const p = hit.node as unknown as BsProfile;
            if (classifyProfile(p) === "ability") addDetRule(p.name, abilityText(p));
          }
        }
        for (const p of e.profiles ?? []) if (classifyProfile(p) === "ability") addDetRule(p.name, abilityText(p));
        detachments.push(det);
        if (e.id) {
          detByEntryId.set(e.id, det);
          staging.detachmentEntries[detId] = e;
        }
      }
    }

    // ---- enhancements (shared groups in this catalogue and its libraries) ----------------------
    const enhancementDocs: Doc[] = [doc];
    for (const cl of doc.root.catalogueLinks ?? []) {
      const t = docById.get(cl.targetId);
      if (t && isLibrary(t)) enhancementDocs.push(t);
    }
    for (const ed of enhancementDocs) {
      for (const g of ed.root.sharedSelectionEntryGroups ?? []) {
        if (!/^enhancements$/i.test(g.name ?? "")) continue;
        for (const e of g.selectionEntries ?? []) {
          const name = cleanName(e.name ?? "").name;
          if (!name) continue;
          let det: Detachment | undefined;
          for (const m of modifiersOf(e)) {
            for (const c of conditionsOf(m)) {
              if (c.childId && detByEntryId.has(c.childId)) det = detByEntryId.get(c.childId);
              if (det) break;
            }
            if (det) break;
          }
          if (!det) {
            staging.unlinkedEnhancements.push(`${factionName}: ${name}`);
            bucket.add("enhancement without detachment link (skipped)", `${factionName}/${name}`);
            continue;
          }
          const cost = costValue(e.costs, "pts", ptsTypeId) ?? 0;
          const textProfile = (e.profiles ?? []).find((p) => classifyProfile(p) === "ability");
          const enh: Enhancement = {
            id: uniqueId(enhancementId(factionName, name), enhIds),
            detachmentId: det.id,
            name,
            cost,
            text: textProfile ? abilityText(textProfile) : "",
            supportOnly: false,
            isLegends: false,
          };
          enhancements.push(enh);
          det.enhancementIds.push(enh.id);
        }
      }
    }
  }

  // ---- leader / support associations ------------------------------------------------------------
  for (const { ds, factionName, assoc } of pendingAssociations) {
    for (const a of assoc) {
      const label = `${a.name ?? ""} ${a.label ?? ""}`;
      const list = /support/i.test(label) ? ds.supportTo : ds.leaderTo;
      if (/support/i.test(label)) ds.isSupport = true;
      for (const c of conditionsOf(a)) {
        let targets: string[] = [];
        if (c.childId) {
          const byCat = dsByCategory.get(c.childId) ?? [];
          if (byCat.length > 0 && byCat.length <= 12) targets = byCat;
          const direct = dsByEntryId.get(c.childId);
          if (direct) targets = [direct];
        }
        if (!targets.length && c.childName) {
          const guess = datasheetId(factionName, cleanName(c.childName).name);
          if (dsIds.has(guess)) targets = [guess];
          else {
            const bySlug = datasheets.find((d) => slugify(d.name) === slugify(cleanName(c.childName ?? "").name));
            if (bySlug) targets = [bySlug.id];
          }
        }
        if (!targets.length) {
          if (c.childName && enhancementNames.has(cleanName(c.childName).name.toLowerCase())) continue; // granted by an enhancement, not a unit
          bucket.add("unresolved association target", `${ds.name} -> ${c.childName ?? c.childId ?? "?"}`);
          continue;
        }
        for (const t of targets) if (t !== ds.id && !list.includes(t)) list.push(t);
      }
    }
  }

  // ---- housekeeping ------------------------------------------------------------------------------
  if (staging.unresolvedLinks.length) {
    const sample = staging.unresolvedLinks.slice(0, 5).map((u) => `${u.catalogue}: ${u.name}`).join(", ");
    warnings.push(`${staging.unresolvedLinks.length} unresolved entry links (catalogue not in input?): ${sample}${staging.unresolvedLinks.length > 5 ? ", ..." : ""}`);
  }
  bucket.flush(warnings);

  const catRevs = factionDocs.map((d) => `${slugify(catalogueFactionName(d.root.name ?? d.file))}@r${d.root.revision ?? "?"}`);
  const sourceRef: SourceRef = {
    adapter: "bsdata-json",
    fetchedAt: fetchedAtOrNow(opts),
    url: opts.url ?? `${BSDATA_RAW_URL}main/`,
    notes: `BSData/wh40k-11e (no licence; data (c) Games Workshop). catalogues: ${catRevs.join(", ")}`,
  };
  const ref = opts.ref ?? (gsDoc?.root.revision !== undefined ? `gs-r${gsDoc.root.revision}` : undefined);
  if (ref) sourceRef.ref = ref;

  const stubs: DatasheetStub[] = datasheets;
  const out: AdapterOutput = { sourceRef, warnings, factions, datasheets: stubs, abilities, detachments, enhancements, priceRules, wargearPrices, publications, staging };
  if (gameSystem) out.gameSystem = gameSystem;
  return out;
}

function describeRange(mm: { min?: number; max?: number }, name: string): string {
  if (mm.min !== undefined && mm.max !== undefined && mm.max !== mm.min) return `${mm.min}-${mm.max} ${name}`;
  if (mm.min !== undefined) return `${mm.min} ${name}`;
  if (mm.max !== undefined) return `up to ${mm.max} ${name}`;
  return name;
}

export const bsdataJsonAdapter: Adapter = { id: "bsdata-json", parse };
