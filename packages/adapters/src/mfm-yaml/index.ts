import { parse as parseYaml } from "yaml";
import type { Detachment, Enhancement, Faction, PriceRule, SourceRef, WargearPrice } from "@grimstat/schema";
import {
  DEFAULT_GAME_SYSTEM_ID,
  asFileMap,
  fetchedAtOrNow,
  type Adapter,
  type AdapterInput,
  type AdapterOutput,
  type DatasheetStub,
  type ParseOptions,
} from "../types";
import { datasheetId, detachmentId, enhancementId, factionId, factionSlug, slugify, uniqueId } from "../util/ids";
import { parseCopyRangeLabel, parseInterval } from "../util/interval";

/** Shape of one `data/<slug>.yaml` file in BSData/wh40k-11e-mfm (see its specs/data-model.md). */
export interface MfmCost {
  models: number;
  points: number;
  desc?: string;
  addon?: true;
}
export interface MfmPricingTier {
  range: string;
  label?: string;
  costs: MfmCost[];
}
export interface MfmUnit {
  name: string;
  groupTitle?: string;
  pricing: MfmPricingTier[];
  leaderTo?: string[];
  supportTo?: string[];
  wargear?: { item: string; points: number }[];
  legends?: true;
}
export interface MfmEnhancement {
  name: string;
  points: number;
  leaderTo?: string[];
  supportTo?: string[];
}
export interface MfmDetachment {
  name: string;
  dp: number | null;
  objectives?: string[];
  unique?: string;
  enhancements?: MfmEnhancement[];
}
export interface MfmFactionFile {
  name: string;
  slug: string;
  version?: string;
  firstSeen?: string;
  parent?: string;
  detachments?: MfmDetachment[];
  units?: MfmUnit[];
}
export interface MfmMetaFile {
  version?: string;
  lastUpdated?: string;
  notes?: string;
  factions?: string[];
}

export const MFM_DEFAULT_URL = "https://raw.githubusercontent.com/BSData/wh40k-11e-mfm/main/data/";

function isFactionFile(doc: unknown): doc is MfmFactionFile {
  return !!doc && typeof doc === "object" && typeof (doc as MfmFactionFile).name === "string" && typeof (doc as MfmFactionFile).slug === "string" && Array.isArray((doc as MfmFactionFile).units);
}

/** Reads as a faction file but carries no `slug`, which the faction order is taken from. Reported and skipped. */
function isSluglessFactionFile(doc: unknown): boolean {
  return !!doc && typeof doc === "object" && typeof (doc as MfmFactionFile).name === "string" && Array.isArray((doc as MfmFactionFile).units);
}

/**
 * The entries of a list in a faction file that this parser can read. The MFM is scraped every day, so a
 * row that came back malformed has to cost that row and nothing else. `keyed` rows need a `name` as well,
 * because their id is built from it.
 */
function rows<T>(list: unknown, what: string, file: string, warnings: string[], keyed = false): T[] {
  const out: T[] = [];
  for (const row of Array.isArray(list) ? list : []) {
    if (!row || typeof row !== "object" || Array.isArray(row)) warnings.push(`${file}: malformed ${what}, ignored`);
    else if (keyed && typeof (row as { name?: unknown }).name !== "string") warnings.push(`${file}: ${what} without a name, ignored`);
    else out.push(row as T);
  }
  return out;
}

/** The plain names in a list of references, for the fields that hold them. */
function refNames(list: unknown): string[] {
  return Array.isArray(list) ? list.filter((n): n is string => typeof n === "string") : [];
}

/** The faction a unit entry belongs to: the file's parent when the entry's group names it, else the file's own. */
function ownerOf(u: MfmUnit, faction: string, parent: string | undefined): string {
  return parent && u.groupTitle && factionSlug(u.groupTitle) === factionSlug(parent) ? parent : faction;
}

/** The objects in a list, for the pass that reads every file before any row has been reported on. */
function objects<T = Record<string, unknown>>(list: unknown): T[] {
  return Array.isArray(list) ? list.filter((r): r is T => !!r && typeof r === "object" && !Array.isArray(r)) : [];
}

/** Everything one unit entry says about points, as one string. Two entries with the same string cost the same. */
function priceSignature(u: MfmUnit): string {
  const tiers = objects(u.pricing).map((t) => {
    const costs = objects(t["costs"]).map((c) => `${String(c["models"])}=${String(c["points"])}${c["addon"] ? "+" : ""}${String(c["desc"] ?? "")}`);
    return `${String(t["range"] ?? "")}/${String(t["label"] ?? "")}/${costs.join(",")}`;
  });
  return [...tiers, ...objects(u.wargear).map((w) => `${String(w["item"])}=${String(w["points"])}`)].join(";");
}

/**
 * The units a chapter prices differently from the faction whose id they would share.
 *
 * A chapter file lists the whole shared roster under the parent's group, and nearly every entry
 * repeats what the parent's own file says. The handful that do not are the units that chapter pays
 * different points for, and a price rule can only name one datasheet, so those entries keep an id of
 * their own. The result holds `<datasheet id>|<faction slug>` for each entry that needs one.
 */
function chapterPriced(docs: { doc: MfmFactionFile }[]): Set<string> {
  const entries = new Map<string, { faction: string; owner: string; sig: string }[]>();
  for (const { doc } of docs) {
    for (const u of objects<MfmUnit>(doc.units)) {
      if (typeof u.name !== "string") continue;
      const owner = ownerOf(u, doc.name, doc.parent);
      const id = datasheetId(owner, u.name);
      entries.set(id, [...(entries.get(id) ?? []), { faction: doc.name, owner, sig: priceSignature(u) }]);
    }
  }
  const out = new Set<string>();
  for (const [id, list] of entries) {
    if (new Set(list.map((e) => e.sig)).size < 2) continue;
    // The faction the id names keeps it. When that faction's own file is silent, the first file keeps it.
    const keeper = list.find((e) => factionSlug(e.faction) === factionSlug(e.owner)) ?? list[0]!;
    for (const e of list) if (e.sig !== keeper.sig && factionSlug(e.faction) !== factionSlug(e.owner)) out.add(`${id}|${factionSlug(e.faction)}`);
  }
  return out;
}

/** How a price reads in a warning: "75 for 1 model", "95 for 5 models, 180 for 10 models". */
function priceText(tiers: { models: number; points: number }[]): string {
  return tiers.map((t) => `${t.points} for ${t.models} model${t.models === 1 ? "" : "s"}`).join(", ");
}

function isMetaFile(doc: unknown): doc is MfmMetaFile {
  return !!doc && typeof doc === "object" && !("units" in (doc as object)) && ("factions" in (doc as object) || "lastUpdated" in (doc as object));
}

/**
 * Parse MFM YAML (meta.yaml + one file per faction). Emits price rules, wargear prices, detachments,
 * enhancements and datasheet stubs (no model profiles: the MFM only carries points).
 */
export function parse(input: AdapterInput, opts: ParseOptions = {}): AdapterOutput {
  const files = asFileMap(input, "faction.yaml");
  const gameSystemId = opts.gameSystemId ?? DEFAULT_GAME_SYSTEM_ID;
  const warnings: string[] = [];

  let meta: MfmMetaFile | undefined;
  const factionDocs: { file: string; doc: MfmFactionFile }[] = [];
  for (const [file, text] of Object.entries(files)) {
    let doc: unknown;
    try {
      doc = parseYaml(text);
    } catch (e) {
      warnings.push(`${file}: YAML parse error: ${(e as Error).message}`);
      continue;
    }
    if (isFactionFile(doc)) factionDocs.push({ file, doc });
    else if (isMetaFile(doc)) meta = doc;
    else if (isSluglessFactionFile(doc)) warnings.push(`${file}: faction file without a slug, ignored`);
    else warnings.push(`${file}: not an MFM faction or meta file, ignored`);
  }
  factionDocs.sort((a, b) => a.doc.slug.localeCompare(b.doc.slug));

  const factions: Faction[] = [];
  const datasheets: DatasheetStub[] = [];
  const detachments: Detachment[] = [];
  const enhancements: Enhancement[] = [];
  const priceRules: PriceRule[] = [];
  const wargearPrices: WargearPrice[] = [];
  /** datasheet + copy range -> the price already taken, so a second entry can be compared with it. */
  const seenRules = new Map<string, string>();
  /** datasheet + item -> the points already taken. */
  const seenWargear = new Map<string, number>();
  const seenDatasheets = new Set<string>();
  const chapterIds = chapterPriced(factionDocs);
  const detIds = new Set<string>();
  const enhIds = new Set<string>();

  for (const { file, doc } of factionDocs) {
    const fName = doc.name;
    const fId = factionId(fName);
    const parentName = doc.parent;
    const faction: Faction = { id: fId, gameSystemId, name: fName, keywords: [] };
    if (parentName) faction.parentFactionId = factionId(parentName);
    factions.push(faction);

    // Units listed under the parent's group (e.g. the shared Space Marines roster on a chapter page)
    // belong to the parent faction so that the same datasheet has one id everywhere. A unit this file
    // charges different points for stays with this faction, because the points follow the id.
    const ownerFaction = (u: MfmUnit): string => {
      const owner = ownerOf(u, fName, parentName);
      return chapterIds.has(`${datasheetId(owner, u.name)}|${factionSlug(fName)}`) ? fName : owner;
    };
    const units = rows<MfmUnit>(doc.units, "unit", file, warnings, true);
    const unitNames = new Map<string, string>(); // slug -> datasheet id (for leaderTo/supportTo resolution)
    for (const u of units) unitNames.set(slugify(u.name), datasheetId(ownerFaction(u), u.name));

    const resolveRef = (name: string, ctx: string): string => {
      const hit = unitNames.get(slugify(name));
      if (hit) return hit;
      // Not in this file: assume the parent faction (chapter -> Space Marines) or same faction.
      const target = parentName ? datasheetId(parentName, name) : datasheetId(fName, name);
      warnings.push(`${file}: ${ctx} references unknown unit "${name}" -> ${target}`);
      return target;
    };

    for (const u of units) {
      const owner = ownerFaction(u);
      const dsId = datasheetId(owner, u.name);
      if (!seenDatasheets.has(dsId)) {
        seenDatasheets.add(dsId);
        const stub: DatasheetStub = { id: dsId, gameSystemId, factionId: factionId(owner), name: u.name, isLegends: u.legends === true };
        const leaderTo = refNames(u.leaderTo);
        const supportTo = refNames(u.supportTo);
        if (leaderTo.length) stub.leaderTo = leaderTo.map((n) => resolveRef(n, `${u.name}.leaderTo`));
        if (supportTo.length) stub.supportTo = supportTo.map((n) => resolveRef(n, `${u.name}.supportTo`));
        datasheets.push(stub);
      }
      // Where a second entry for the same unit sits, so that a warning can point at it.
      const group = u.groupTitle ? ` under "${u.groupTitle}"` : "";
      const takeWargear = (item: string, points: number): void => {
        const key = `${dsId}|${item}`;
        const taken = seenWargear.get(key);
        if (taken !== undefined) {
          if (taken !== points) warnings.push(`${file}: ${u.name} gives two prices for "${item}", ${taken} and ${points}${group}. The first price is used and the second is dropped.`);
          return;
        }
        seenWargear.set(key, points);
        wargearPrices.push({ datasheetId: dsId, item, points });
      };
      for (const tier of rows<MfmPricingTier>(u.pricing, `pricing tier of "${u.name}"`, file, warnings)) {
        const range = parseInterval(tier.range) ?? (typeof tier.label === "string" ? parseCopyRangeLabel(tier.label) : null);
        if (!range) {
          warnings.push(`${file}: ${u.name}: cannot parse pricing range "${tier.range}" (${tier.label ?? ""})`);
          continue;
        }
        const tiers: { models: number; points: number }[] = [];
        for (const c of rows<MfmCost>(tier.costs, `cost of "${u.name}"`, file, warnings)) {
          if (c.addon) {
            // "+ 1 Something" rows are extras on top of a base option: model them as wargear prices.
            takeWargear(c.desc ?? `${c.models} model add-on`, c.points);
            continue;
          }
          if (c.models > 0) tiers.push({ models: c.models, points: c.points });
          else warnings.push(`${file}: ${u.name}: cost row with 0 models skipped (${c.desc ?? ""})`);
        }
        if (tiers.length === 0) continue;
        const rule: PriceRule = { datasheetId: dsId, copyRange: range.max === undefined ? { min: range.min } : { min: range.min, max: range.max }, tiers };
        if (tier.label) rule.label = tier.label;
        const key = `${dsId}|${range.min}|${range.max ?? ""}`;
        const priced = priceText(tiers);
        const taken = seenRules.get(key);
        if (taken !== undefined) {
          // Several files list the same shared unit at the same price, so only a price that differs is reported.
          if (taken !== priced) warnings.push(`${file}: ${u.name} is priced twice, at ${taken} and at ${priced}${group}. The first price is used and the second is dropped.`);
          continue;
        }
        seenRules.set(key, priced);
        priceRules.push(rule);
      }
      for (const w of rows<{ item: string; points: number }>(u.wargear, `wargear row of "${u.name}"`, file, warnings)) {
        takeWargear(w.item, w.points);
      }
    }

    for (const d of rows<MfmDetachment>(doc.detachments, "detachment", file, warnings, true)) {
      const detId = uniqueId(detachmentId(fName, d.name), detIds);
      let dp = d.dp;
      if (dp === null || dp === undefined) {
        warnings.push(`${file}: detachment "${d.name}" has no DP; defaulting to 1`);
        dp = 1;
      }
      const det: Detachment = {
        id: detId,
        factionId: fId,
        name: d.name,
        dp,
        forceDispositions: refNames(d.objectives),
        ruleAbilityIds: [],
        enhancementIds: [],
        stratagemIds: [],
      };
      if (d.unique) det.uniqueTag = d.unique;
      for (const e of rows<MfmEnhancement>(d.enhancements, `enhancement of "${d.name}"`, file, warnings, true)) {
        const enhId = uniqueId(enhancementId(fName, e.name), enhIds);
        const enhLeaderTo = refNames(e.leaderTo);
        const enhSupportTo = refNames(e.supportTo);
        const enh: Enhancement = {
          id: enhId,
          detachmentId: detId,
          name: e.name,
          cost: e.points,
          text: "",
          supportOnly: enhSupportTo.length > 0,
          isLegends: false,
        };
        const restr: string[] = [];
        if (enhLeaderTo.length) restr.push(`LEADER: ${enhLeaderTo.join(", ")}`);
        if (enhSupportTo.length) restr.push(`SUPPORT: ${enhSupportTo.join(", ")}`);
        if (restr.length) enh.restrictions = restr.join("; ");
        enhancements.push(enh);
        det.enhancementIds.push(enhId);
      }
      detachments.push(det);
    }
  }

  const refParts: string[] = [];
  if (meta?.version) refParts.push(`mfm-v${meta.version}`);
  else {
    const v = factionDocs[0]?.doc.version;
    if (v) refParts.push(`mfm-v${v}`);
  }
  if (meta?.lastUpdated) refParts.push(String(meta.lastUpdated));
  const sourceRef: SourceRef = {
    adapter: "mfm-yaml",
    fetchedAt: fetchedAtOrNow(opts),
    ref: refParts.length ? refParts.join("@") : opts.ref,
    url: opts.url ?? MFM_DEFAULT_URL,
    notes: "BSData/wh40k-11e-mfm (MIT); points (c) Games Workshop",
  };
  if (sourceRef.ref === undefined) delete sourceRef.ref;

  return { sourceRef, warnings, factions, datasheets, detachments, enhancements, priceRules, wargearPrices };
}

export const mfmYamlAdapter: Adapter = { id: "mfm-yaml", parse };
