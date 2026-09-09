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
  return !!doc && typeof doc === "object" && typeof (doc as MfmFactionFile).name === "string" && Array.isArray((doc as MfmFactionFile).units);
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
    else warnings.push(`${file}: not an MFM faction or meta file, ignored`);
  }
  factionDocs.sort((a, b) => a.doc.slug.localeCompare(b.doc.slug));

  const factions: Faction[] = [];
  const datasheets: DatasheetStub[] = [];
  const detachments: Detachment[] = [];
  const enhancements: Enhancement[] = [];
  const priceRules: PriceRule[] = [];
  const wargearPrices: WargearPrice[] = [];
  const seenRules = new Set<string>();
  const seenWargear = new Set<string>();
  const seenDatasheets = new Set<string>();
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
    // belong to the parent faction so that the same datasheet has one id everywhere.
    const ownerFaction = (u: MfmUnit): string => (parentName && u.groupTitle && factionSlug(u.groupTitle) === factionSlug(parentName) ? parentName : fName);
    const unitNames = new Map<string, string>(); // slug -> datasheet id (for leaderTo/supportTo resolution)
    for (const u of doc.units ?? []) unitNames.set(slugify(u.name), datasheetId(ownerFaction(u), u.name));

    const resolveRef = (name: string, ctx: string): string => {
      const hit = unitNames.get(slugify(name));
      if (hit) return hit;
      // Not in this file: assume the parent faction (chapter -> Space Marines) or same faction.
      const target = parentName ? datasheetId(parentName, name) : datasheetId(fName, name);
      warnings.push(`${file}: ${ctx} references unknown unit "${name}" -> ${target}`);
      return target;
    };

    for (const u of doc.units ?? []) {
      const owner = ownerFaction(u);
      const dsId = datasheetId(owner, u.name);
      if (!seenDatasheets.has(dsId)) {
        seenDatasheets.add(dsId);
        const stub: DatasheetStub = { id: dsId, gameSystemId, factionId: factionId(owner), name: u.name, isLegends: u.legends === true };
        if (u.leaderTo?.length) stub.leaderTo = u.leaderTo.map((n) => resolveRef(n, `${u.name}.leaderTo`));
        if (u.supportTo?.length) stub.supportTo = u.supportTo.map((n) => resolveRef(n, `${u.name}.supportTo`));
        datasheets.push(stub);
      }
      for (const tier of u.pricing ?? []) {
        const range = parseInterval(tier.range) ?? (tier.label ? parseCopyRangeLabel(tier.label) : null);
        if (!range) {
          warnings.push(`${file}: ${u.name}: cannot parse pricing range "${tier.range}" (${tier.label ?? ""})`);
          continue;
        }
        const tiers: { models: number; points: number }[] = [];
        for (const c of tier.costs ?? []) {
          if (c.addon) {
            // "+ 1 Something" rows are extras on top of a base option: model them as wargear prices.
            const item = c.desc ?? `${c.models} model add-on`;
            const key = `${dsId}|${item}`;
            if (!seenWargear.has(key)) {
              seenWargear.add(key);
              wargearPrices.push({ datasheetId: dsId, item, points: c.points });
            }
            continue;
          }
          if (c.models > 0) tiers.push({ models: c.models, points: c.points });
          else warnings.push(`${file}: ${u.name}: cost row with 0 models skipped (${c.desc ?? ""})`);
        }
        if (tiers.length === 0) continue;
        const rule: PriceRule = { datasheetId: dsId, copyRange: range.max === undefined ? { min: range.min } : { min: range.min, max: range.max }, tiers };
        if (tier.label) rule.label = tier.label;
        const key = `${dsId}|${range.min}|${range.max ?? ""}`;
        if (seenRules.has(key)) continue;
        seenRules.add(key);
        priceRules.push(rule);
      }
      for (const w of u.wargear ?? []) {
        const key = `${dsId}|${w.item}`;
        if (seenWargear.has(key)) continue;
        seenWargear.add(key);
        wargearPrices.push({ datasheetId: dsId, item: w.item, points: w.points });
      }
    }

    for (const d of doc.detachments ?? []) {
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
        forceDispositions: d.objectives ?? [],
        ruleAbilityIds: [],
        enhancementIds: [],
        stratagemIds: [],
      };
      if (d.unique) det.uniqueTag = d.unique;
      for (const e of d.enhancements ?? []) {
        const enhId = uniqueId(enhancementId(fName, e.name), enhIds);
        const enh: Enhancement = {
          id: enhId,
          detachmentId: detId,
          name: e.name,
          cost: e.points,
          text: "",
          supportOnly: (e.supportTo?.length ?? 0) > 0,
          isLegends: false,
        };
        const restr: string[] = [];
        if (e.leaderTo?.length) restr.push(`LEADER: ${e.leaderTo.join(", ")}`);
        if (e.supportTo?.length) restr.push(`SUPPORT: ${e.supportTo.join(", ")}`);
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
