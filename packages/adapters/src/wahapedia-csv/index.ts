import type {
  Ability,
  AbilityScope,
  Datasheet,
  Detachment,
  Enhancement,
  Faction,
  ModelProfile,
  PriceRule,
  Publication,
  SourceRef,
  Stratagem,
  WargearPrice,
  WeaponProfile,
} from "@grimstat/schema";
import {
  DEFAULT_GAME_SYSTEM_ID,
  fetchedAtOrNow,
  type Adapter,
  type AdapterInput,
  type AdapterOutput,
  type DatasheetStub,
  type ParseOptions,
} from "../types";
import { parsePipeCsv } from "../util/pipe-csv";
import { stripHtml } from "../util/html";
import { parseWeaponKeywords } from "../util/weapon-keywords";
import { parseCopyRangeLabel, type CopyRange } from "../util/interval";
import { parseCoreAbility } from "../util/core-abilities";
import { parseAP, parseDice, parseInches, parseInt0, parseInvSave, parseTargetNumber, parseWeaponRange } from "../util/values";
import {
  coreAbilityId,
  datasheetAbilityId,
  datasheetId,
  detachmentAbilityId,
  detachmentId,
  enhancementId,
  factionAbilityId,
  factionId,
  modelProfileId,
  stratagemId,
  uniqueId,
  weaponProfileId,
} from "../util/ids";

export const WAHAPEDIA_BASE_URL = "https://wahapedia.ru/wh40k11ed/";

export const WAHAPEDIA_TABLES = [
  "Factions",
  "Source",
  "Datasheets",
  "Datasheets_models",
  "Datasheets_wargear",
  "Datasheets_abilities",
  "Datasheets_keywords",
  "Datasheets_unit_composition",
  "Datasheets_models_cost",
  "Datasheets_options",
  "Datasheets_leader",
  "Datasheets_stratagems",
  "Datasheets_enhancements",
  "Datasheets_detachment_abilities",
  "Stratagems",
  "Abilities",
  "Enhancements",
  "Detachment_abilities",
  "Last_update",
] as const;
export type WahapediaTable = (typeof WAHAPEDIA_TABLES)[number];

type Row = Record<string, string>;
const col = (r: Row, k: string): string => (r[k] ?? "").trim();
const bool = (v: string): boolean => v.trim().toLowerCase() === "true";

/** Loosely typed extras kept for the future army builder. */
export interface WahapediaStaging {
  /** canonical datasheet id -> upstream Wahapedia datasheet id */
  upstreamDatasheetIds: Record<string, string>;
  /** canonical datasheet id -> stratagem ids usable by that datasheet */
  datasheetStratagems: Record<string, string[]>;
  /** canonical datasheet id -> enhancement ids available to that datasheet */
  datasheetEnhancements: Record<string, string[]>;
  lastUpdate?: string;
}

function tableKey(name: string): string {
  return name
    .replace(/^.*[\\/]/, "")
    .replace(/\.csv$/i, "")
    .toLowerCase();
}

function parseAbilityParameter(p: string): number | string | undefined {
  const s = p.trim();
  if (!s) return undefined;
  const tn = parseTargetNumber(s);
  if (tn !== null) return tn;
  const inches = /^(\d+)"$/.exec(s);
  if (inches) return Number(inches[1]);
  const dice = parseDice(s);
  if (dice !== null) return dice;
  return s;
}

function mapScope(type: string): AbilityScope {
  const t = type.toLowerCase();
  if (t.startsWith("core")) return "core";
  if (t.startsWith("faction")) return "faction";
  if (t.startsWith("wargear")) return "wargear";
  return "datasheet"; // Datasheet, Special, Fortification, Primarch, Psychic, untitled
}

function mapTurn(t: string): Stratagem["turn"] | undefined {
  const s = t.toLowerCase();
  if (!s) return undefined;
  if (s.startsWith("your")) return "your";
  if (s.startsWith("opponent")) return "opponent";
  if (s.startsWith("either")) return "either";
  return undefined;
}

function mapPhases(p: string): string[] {
  const s = p.trim();
  if (!s) return [];
  if (/^ability\s+"/i.test(s)) return [s];
  const core = s.replace(/\s+phases?$/i, "");
  return core
    .split(/\s+or\s+|,/)
    .map((x) => x.trim())
    .filter(Boolean);
}

/** Split a stratagem description into its WHEN / TARGET / EFFECT / RESTRICTIONS sections. */
function decomposeStratagem(text: string): { when?: string; target?: string; effect?: string; restrictions?: string } {
  const out: { when?: string; target?: string; effect?: string; restrictions?: string } = {};
  const re = /(^|\n)\s*(WHEN|TARGET|EFFECT|RESTRICTIONS):\s*/g;
  const marks: { key: string; start: number; end: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) marks.push({ key: (m[2] as string).toLowerCase(), start: m.index, end: m.index + m[0].length });
  marks.forEach((mk, i) => {
    const next = marks[i + 1];
    const body = text.slice(mk.end, next ? next.start : undefined).trim();
    if (mk.key === "when") out.when = body;
    else if (mk.key === "target") out.target = body;
    else if (mk.key === "effect") out.effect = body;
    else out.restrictions = body;
  });
  return out;
}

function parseCompositionRange(desc: string): { min?: number; max?: number } {
  const m = /^(\d+)(?:\s*[-–]\s*(\d+))?\s+/.exec(desc);
  if (!m) return {};
  const min = Number(m[1]);
  const max = m[2] !== undefined ? Number(m[2]) : min;
  return { min, max };
}

function parseModelsCount(desc: string): number | null {
  const m = /^(\d+)\s+models?\b/i.exec(desc.trim());
  return m ? Number(m[1]) : null;
}

/**
 * Parse the Wahapedia 11th-edition CSV export (pipe-delimited tables). Input keys are table names
 * ("Datasheets", "Datasheets.csv", or a path ending in the table name).
 */
export function parse(input: AdapterInput, opts: ParseOptions = {}): AdapterOutput {
  if (typeof input === "string") throw new Error("wahapedia-csv: input must be a map of table name -> CSV text");
  const gameSystemId = opts.gameSystemId ?? DEFAULT_GAME_SYSTEM_ID;
  const warnings: string[] = [];
  const tables = new Map<string, Row[]>();
  for (const [name, text] of Object.entries(input)) {
    const key = tableKey(name);
    const res = parsePipeCsv(text);
    for (const w of res.warnings) warnings.push(`${key}: ${w}`);
    tables.set(key, res.rows);
  }
  const rows = (t: WahapediaTable): Row[] => tables.get(t.toLowerCase()) ?? [];
  for (const t of ["Datasheets", "Datasheets_models", "Datasheets_wargear"] as const) {
    if (!tables.has(t.toLowerCase())) warnings.push(`missing table ${t}`);
  }

  // ---- factions -------------------------------------------------------------------------------
  const factionByWahId = new Map<string, { id: string; name: string }>();
  const factions: Faction[] = [];
  for (const r of rows("Factions")) {
    const wid = col(r, "id");
    const name = col(r, "name");
    if (!wid || !name) continue;
    const f = { id: factionId(name), name };
    factionByWahId.set(wid, f);
    factions.push({ id: f.id, gameSystemId, name, keywords: [] });
  }
  const factionOf = (wid: string, ctx: string): { id: string; name: string } | undefined => {
    if (!wid) return undefined;
    const f = factionByWahId.get(wid);
    if (!f) {
      const placeholder = { id: factionId(wid), name: wid };
      factionByWahId.set(wid, placeholder);
      factions.push({ id: placeholder.id, gameSystemId, name: wid, keywords: [] });
      warnings.push(`${ctx}: unknown faction id "${wid}", placeholder faction created`);
      return placeholder;
    }
    return f;
  };

  // ---- publications ---------------------------------------------------------------------------
  const publications: Publication[] = [];
  const legendsSources = new Set<string>();
  const pubIdByWah = new Map<string, string>();
  for (const r of rows("Source")) {
    const wid = col(r, "id");
    if (!wid) continue;
    const name = col(r, "name");
    const pub: Publication = { id: `pub:wahapedia:${wid}`, name };
    const type = col(r, "type");
    const edition = col(r, "edition");
    const version = col(r, "version");
    const errataDate = col(r, "errata_date");
    const errataLink = col(r, "errata_link");
    if (type) pub.type = type;
    if (edition) pub.edition = edition;
    if (version) pub.version = version;
    if (errataDate) pub.errataDate = errataDate;
    if (errataLink) pub.errataLink = errataLink;
    publications.push(pub);
    pubIdByWah.set(wid, pub.id);
    if (/legends/i.test(name)) legendsSources.add(wid);
  }

  // ---- detachments (from Detachment_abilities, Enhancements and Stratagems) --------------------
  const detByWahId = new Map<string, Detachment>();
  const detachments: Detachment[] = [];
  const detIds = new Set<string>();
  const ensureDetachment = (wahDetId: string, detName: string, faction: { id: string; name: string } | undefined, ctx: string): Detachment | undefined => {
    const key = wahDetId || `name:${faction?.id ?? ""}:${detName}`;
    const existing = detByWahId.get(key);
    if (existing) return existing;
    if (!detName || !faction) {
      warnings.push(`${ctx}: cannot create detachment (name="${detName}", faction=${faction?.id ?? "?"})`);
      return undefined;
    }
    const det: Detachment = {
      id: uniqueId(detachmentId(faction.name, detName), detIds),
      factionId: faction.id,
      name: detName,
      dp: 1,
      forceDispositions: [],
      ruleAbilityIds: [],
      enhancementIds: [],
      stratagemIds: [],
    };
    detByWahId.set(key, det);
    detachments.push(det);
    return det;
  };

  // ---- abilities catalogue --------------------------------------------------------------------
  const abilityRows = new Map<string, Row>();
  for (const r of rows("Abilities")) {
    const wid = col(r, "id");
    if (wid) abilityRows.set(wid, r);
  }
  const abilities: Ability[] = [];
  const abilityIds = new Set<string>();
  const addAbility = (a: Ability): Ability => {
    if (!abilityIds.has(a.id)) {
      abilityIds.add(a.id);
      abilities.push(a);
    }
    return a;
  };

  // ---- datasheets -----------------------------------------------------------------------------
  const dsByWahId = new Map<string, Datasheet>();
  const datasheets: Datasheet[] = [];
  const dsIds = new Set<string>();
  const staging: WahapediaStaging = { upstreamDatasheetIds: {}, datasheetStratagems: {}, datasheetEnhancements: {} };
  const dsFaction = new Map<string, { id: string; name: string }>();

  for (const r of rows("Datasheets")) {
    const wid = col(r, "id");
    const name = col(r, "name");
    if (!wid || !name) continue;
    if (bool(col(r, "virtual"))) {
      warnings.push(`Datasheets: skipped virtual datasheet "${name}" (${wid})`);
      continue;
    }
    const faction = factionOf(col(r, "faction_id"), `Datasheets ${wid} ${name}`);
    if (!faction) {
      warnings.push(`Datasheets: "${name}" (${wid}) has no faction, skipped`);
      continue;
    }
    const id = uniqueId(datasheetId(faction.name, name), dsIds);
    const sourceWid = col(r, "source_id");
    const ds: Datasheet = {
      id,
      gameSystemId,
      factionId: faction.id,
      name,
      isLegends: legendsSources.has(sourceWid),
      isCharacter: false,
      isEpicHero: false,
      isBattleline: false,
      isSupport: bool(col(r, "is_support")),
      keywords: [],
      factionKeywords: [],
      models: [],
      weapons: [],
      abilityIds: [],
      stratagemIds: [],
      leaderTo: [],
      supportTo: [],
      composition: [],
      wargearOptions: [],
    };
    const role = col(r, "role");
    if (role) ds.role = role;
    const loadout = stripHtml(col(r, "loadout"));
    if (loadout) ds.loadout = loadout;
    const transport = stripHtml(col(r, "transport"));
    if (transport) ds.transportCapacity = transport;
    const dmgW = col(r, "damaged_w");
    if (dmgW) ds.damagedProfile = { threshold: dmgW, description: stripHtml(col(r, "damaged_description")) };
    const pubId = pubIdByWah.get(sourceWid);
    if (pubId) ds.sourceId = pubId;
    dsByWahId.set(wid, ds);
    dsFaction.set(id, faction);
    datasheets.push(ds);
    staging.upstreamDatasheetIds[id] = wid;
  }
  const unknownDs = new Set<string>();
  const dsOf = (wid: string, ctx: string): Datasheet | undefined => {
    const ds = dsByWahId.get(wid);
    if (!ds && wid && !unknownDs.has(`${ctx}|${wid}`)) {
      unknownDs.add(`${ctx}|${wid}`);
      warnings.push(`${ctx}: unknown datasheet id ${wid}`);
    }
    return ds;
  };

  // ---- keywords -------------------------------------------------------------------------------
  for (const r of rows("Datasheets_keywords")) {
    const ds = dsByWahId.get(col(r, "datasheet_id"));
    if (!ds) continue;
    const kw = stripHtml(col(r, "keyword")).toUpperCase();
    if (!kw) continue;
    const list = bool(col(r, "is_faction_keyword")) ? ds.factionKeywords : ds.keywords;
    if (!list.includes(kw)) list.push(kw);
  }
  for (const ds of datasheets) {
    ds.isCharacter = ds.keywords.includes("CHARACTER");
    ds.isEpicHero = ds.keywords.includes("EPIC HERO");
    ds.isBattleline = ds.keywords.includes("BATTLELINE");
  }

  // ---- model profiles -------------------------------------------------------------------------
  const modelIds = new Set<string>();
  const modelRows = rows("Datasheets_models").slice().sort((a, b) => Number(col(a, "line")) - Number(col(b, "line")));
  for (const r of modelRows) {
    const ds = dsOf(col(r, "datasheet_id"), "Datasheets_models");
    if (!ds) continue;
    const name = col(r, "name") || ds.name;
    const T = parseInt0(col(r, "T"));
    const Sv = parseTargetNumber(col(r, "Sv"));
    const W = parseInt0(col(r, "W"));
    if (T === null || Sv === null || W === null) {
      warnings.push(`Datasheets_models: ${ds.name}/${name}: unparsable T/Sv/W (${col(r, "T")}/${col(r, "Sv")}/${col(r, "W")}), skipped`);
      continue;
    }
    const mp: ModelProfile = {
      id: uniqueId(modelProfileId(ds.id, name), modelIds),
      name,
      M: parseInches(col(r, "M")),
      T,
      Sv,
      InvSv: parseInvSave(col(r, "inv_sv")),
      W,
      Ld: parseTargetNumber(col(r, "Ld")),
      OC: parseInt0(col(r, "OC")),
    };
    const base = col(r, "base_size");
    if (base) mp.baseSize = base;
    ds.models.push(mp);
  }

  // ---- weapons --------------------------------------------------------------------------------
  const weaponIds = new Set<string>();
  const wargearRows = rows("Datasheets_wargear")
    .slice()
    .sort((a, b) => Number(col(a, "line")) - Number(col(b, "line")) || Number(col(a, "line_in_wargear")) - Number(col(b, "line_in_wargear")));
  for (const r of wargearRows) {
    const name = col(r, "name");
    if (!name) continue;
    const ds = dsOf(col(r, "datasheet_id"), "Datasheets_wargear");
    if (!ds) continue;
    const typeCol = col(r, "type").toLowerCase();
    const rg = parseWeaponRange(col(r, "range"));
    const kind: "ranged" | "melee" = typeCol === "melee" ? "melee" : typeCol === "ranged" ? "ranged" : rg.kind;
    const A = parseDice(col(r, "A"));
    const S = parseInt0(col(r, "S"));
    const D = parseDice(col(r, "D"));
    if (A === null || S === null || D === null) {
      warnings.push(`Datasheets_wargear: ${ds.name}/${name}: unparsable A/S/D (${col(r, "A")}/${col(r, "S")}/${col(r, "D")}), skipped`);
      continue;
    }
    let AP = parseAP(col(r, "AP"));
    if (AP === null) {
      warnings.push(`Datasheets_wargear: ${ds.name}/${name}: unparsable AP "${col(r, "AP")}", using 0`);
      AP = 0;
    }
    const wp: WeaponProfile = {
      id: uniqueId(weaponProfileId(ds.id, name), weaponIds),
      name,
      kind,
      range: kind === "melee" ? null : rg.range,
      A,
      skill: parseTargetNumber(col(r, "BS_WS")),
      S,
      AP,
      D,
      keywords: parseWeaponKeywords(stripHtml(col(r, "description"))),
    };
    const sep = / [-–] /.exec(name);
    if (sep) wp.groupName = name.slice(0, sep.index).trim();
    ds.weapons.push(wp);
  }

  // ---- abilities per datasheet ----------------------------------------------------------------
  const abilityRowsSorted = rows("Datasheets_abilities").slice().sort((a, b) => Number(col(a, "line")) - Number(col(b, "line")));
  for (const r of abilityRowsSorted) {
    const ds = dsOf(col(r, "datasheet_id"), "Datasheets_abilities");
    if (!ds) continue;
    const refId = col(r, "ability_id");
    const type = col(r, "type");
    const scope = mapScope(type);
    const parameter = parseAbilityParameter(col(r, "parameter"));
    let ability: Ability | undefined;
    if (refId) {
      const src = abilityRows.get(refId);
      if (!src) {
        warnings.push(`Datasheets_abilities: ${ds.name}: unknown ability id ${refId}`);
        continue;
      }
      const baseName = col(src, "name");
      const text = stripHtml(col(src, "description"));
      if (scope === "core") {
        const rawParam = col(r, "parameter");
        const name = rawParam ? `${baseName} ${rawParam}` : baseName;
        let core = parseCoreAbility(name) ?? { keyword: baseName.toUpperCase(), value: parameter };
        if (core.keyword === "DAMAGED" && typeof core.value === "number") core = { ...core, value: `1-${core.value}` };
        const a: Ability = { id: coreAbilityId(core.keyword, core.value), name, scope: "core", text, coreKeyword: core.keyword, isLegends: false };
        if (core.value !== undefined) a.coreValue = core.value;
        ability = addAbility(a);
      } else {
        const abilityFaction = factionOf(col(src, "faction_id"), `Abilities ${refId}`) ?? dsFaction.get(ds.id);
        const a: Ability = {
          id: abilityFaction ? factionAbilityId(abilityFaction.name, baseName) : coreAbilityId(baseName),
          name: baseName,
          scope: scope === "faction" ? "faction" : scope,
          text,
          isLegends: false,
        };
        if (abilityFaction) a.factionId = abilityFaction.id;
        ability = addAbility(a);
      }
    } else {
      const name = col(r, "name") || `Ability ${col(r, "line")}`;
      const text = stripHtml(col(r, "description"));
      if (!text && !col(r, "name")) continue;
      const a: Ability = { id: uniqueId(datasheetAbilityId(ds.id, name), abilityIds), name, scope, text, isLegends: ds.isLegends };
      const core = parseCoreAbility(name);
      if (core) {
        a.coreKeyword = core.keyword;
        if (core.value !== undefined) a.coreValue = core.value;
      } else if (parameter !== undefined) a.coreValue = parameter;
      const f = dsFaction.get(ds.id);
      if (f) a.factionId = f.id;
      abilities.push(a);
      ability = a;
    }
    if (ability && !ds.abilityIds.includes(ability.id)) ds.abilityIds.push(ability.id);
    if (ability?.coreKeyword === "SUPPORT") ds.isSupport = true;
  }

  // ---- leader / support joins -----------------------------------------------------------------
  for (const r of rows("Datasheets_leader")) {
    const leader = dsOf(col(r, "leader_id"), "Datasheets_leader");
    const target = dsOf(col(r, "attached_id"), "Datasheets_leader");
    if (!leader || !target) continue;
    const list = leader.isSupport ? leader.supportTo : leader.leaderTo;
    if (!list.includes(target.id)) list.push(target.id);
  }

  // ---- composition / options ------------------------------------------------------------------
  for (const r of rows("Datasheets_unit_composition").slice().sort((a, b) => Number(col(a, "line")) - Number(col(b, "line")))) {
    const ds = dsByWahId.get(col(r, "datasheet_id"));
    if (!ds) continue;
    const description = stripHtml(col(r, "description"));
    if (!description) continue;
    const range = parseCompositionRange(description);
    const comp: { description: string; min?: number; max?: number } = { description };
    if (range.min !== undefined) comp.min = range.min;
    if (range.max !== undefined) comp.max = range.max;
    ds.composition.push(comp);
  }
  for (const r of rows("Datasheets_options").slice().sort((a, b) => Number(col(a, "line")) - Number(col(b, "line")))) {
    const ds = dsByWahId.get(col(r, "datasheet_id"));
    if (!ds) continue;
    const description = stripHtml(col(r, "description"));
    if (description) ds.wargearOptions.push(description);
  }

  // ---- points (Datasheets_models_cost) --------------------------------------------------------
  const priceRules: PriceRule[] = [];
  const wargearPrices: WargearPrice[] = [];
  const seenRules = new Set<string>();
  const seenWargear = new Set<string>();
  const costByDs = new Map<string, Row[]>();
  for (const r of rows("Datasheets_models_cost")) {
    const wid = col(r, "datasheet_id");
    const list = costByDs.get(wid) ?? [];
    list.push(r);
    costByDs.set(wid, list);
  }
  for (const [wid, list] of costByDs) {
    const ds = dsByWahId.get(wid);
    if (!ds) continue;
    list.sort((a, b) => Number(col(a, "line")) - Number(col(b, "line")));
    let range: CopyRange = { min: 1 };
    let label: string | undefined;
    let wargearMode = false;
    let tiers: { models: number; points: number }[] = [];
    const flush = (): void => {
      if (tiers.length === 0) return;
      const key = `${ds.id}|${range.min}|${range.max ?? ""}`;
      if (!seenRules.has(key)) {
        seenRules.add(key);
        const rule: PriceRule = { datasheetId: ds.id, copyRange: range.max === undefined ? { min: range.min } : { min: range.min, max: range.max }, tiers };
        if (label) rule.label = label;
        priceRules.push(rule);
      }
      tiers = [];
    };
    for (const r of list) {
      const desc = stripHtml(col(r, "description"));
      const cost = col(r, "cost");
      if (!cost) {
        // heading row
        flush();
        if (/wargear/i.test(desc)) {
          wargearMode = true;
          continue;
        }
        wargearMode = false;
        const parsed = parseCopyRangeLabel(desc);
        if (parsed) {
          range = parsed;
          label = desc;
        } else {
          warnings.push(`Datasheets_models_cost: ${ds.name}: unknown heading "${desc}"`);
          range = { min: 1 };
          label = desc;
        }
        continue;
      }
      const points = parseInt0(cost.replace(/[^0-9]/g, ""));
      if (points === null) continue;
      if (wargearMode || /^per\s+/i.test(desc)) {
        const item = desc.replace(/^per\s+/i, "");
        const key = `${ds.id}|${item}`;
        if (!seenWargear.has(key)) {
          seenWargear.add(key);
          wargearPrices.push({ datasheetId: ds.id, item, points });
        }
        continue;
      }
      const models = parseModelsCount(desc);
      if (models === null) {
        warnings.push(`Datasheets_models_cost: ${ds.name}: unparsable cost row "${desc}"`);
        continue;
      }
      if (!tiers.some((t) => t.models === models)) tiers.push({ models, points }); // the export repeats rows for some datasheets
    }
    flush();
  }
  for (const ds of datasheets) {
    const first = priceRules.find((p) => p.datasheetId === ds.id && p.copyRange.min === 1) ?? priceRules.find((p) => p.datasheetId === ds.id);
    const tier = first?.tiers[0];
    if (tier) ds.fallbackPoints = tier.points;
  }

  // ---- detachment abilities -------------------------------------------------------------------
  for (const r of rows("Detachment_abilities")) {
    const name = col(r, "name");
    if (!name) continue;
    const faction = factionOf(col(r, "faction_id"), `Detachment_abilities ${name}`);
    const det = ensureDetachment(col(r, "detachment_id"), col(r, "detachment"), faction, `Detachment_abilities ${name}`);
    if (!det) continue;
    const a: Ability = { id: uniqueId(detachmentAbilityId(det.id, name), abilityIds), name, scope: "detachment", text: stripHtml(col(r, "description")), isLegends: false };
    if (faction) a.factionId = faction.id;
    abilities.push(a);
    det.ruleAbilityIds.push(a.id);
  }

  // ---- enhancements ---------------------------------------------------------------------------
  const enhancements: Enhancement[] = [];
  const enhIds = new Set<string>();
  const enhByWahId = new Map<string, Enhancement>();
  for (const r of rows("Enhancements")) {
    const name = col(r, "name");
    if (!name) continue;
    const faction = factionOf(col(r, "faction_id"), `Enhancements ${name}`);
    const det = ensureDetachment(col(r, "detachment_id"), col(r, "detachment"), faction, `Enhancements ${name}`);
    if (!det || !faction) {
      warnings.push(`Enhancements: "${name}" has no detachment, skipped`);
      continue;
    }
    const cost = parseInt0(col(r, "cost")) ?? 0;
    const supportLeader = stripHtml(col(r, "support_leader"));
    const enh: Enhancement = {
      id: uniqueId(enhancementId(faction.name, name), enhIds),
      detachmentId: det.id,
      name,
      cost,
      text: stripHtml(col(r, "description")),
      supportOnly: /\bSUPPORT:/i.test(supportLeader),
      isLegends: false,
    };
    if (supportLeader) enh.restrictions = supportLeader.replace(/\s*\n\s*/g, "; ");
    enhancements.push(enh);
    det.enhancementIds.push(enh.id);
    const wid = col(r, "id");
    if (wid) enhByWahId.set(wid, enh);
  }

  // ---- stratagems -----------------------------------------------------------------------------
  const stratagems: Stratagem[] = [];
  const stratIds = new Set<string>();
  const stratByWahId = new Map<string, Stratagem>();
  for (const r of rows("Stratagems")) {
    const name = col(r, "name");
    const cp = parseInt0(col(r, "cp_cost"));
    if (!name || cp === null) {
      if (name) warnings.push(`Stratagems: "${name}": unparsable cp_cost "${col(r, "cp_cost")}", skipped`);
      continue;
    }
    const factionWid = col(r, "faction_id");
    const faction = factionWid ? factionOf(factionWid, `Stratagems ${name}`) : undefined;
    const detName = col(r, "detachment");
    const det = detName ? ensureDetachment(col(r, "detachment_id"), detName, faction, `Stratagems ${name}`) : undefined;
    const text = stripHtml(col(r, "description"));
    const parts = decomposeStratagem(text);
    const s: Stratagem = {
      id: uniqueId(stratagemId(faction?.name, det?.name, name), stratIds),
      name,
      cpCost: cp,
      phases: mapPhases(col(r, "phase")),
      text,
    };
    if (faction) s.factionId = faction.id;
    if (det) s.detachmentId = det.id;
    const type = col(r, "type");
    if (type) s.type = type;
    const turn = mapTurn(col(r, "turn"));
    if (turn) s.turn = turn;
    if (parts.when) s.when = parts.when;
    if (parts.target) s.target = parts.target;
    if (parts.effect) s.effect = parts.effect;
    if (parts.restrictions) s.restrictions = parts.restrictions;
    stratagems.push(s);
    if (det) det.stratagemIds.push(s.id);
    const wid = col(r, "id");
    if (wid) stratByWahId.set(wid, s);
  }

  // ---- datasheet -> stratagem / enhancement availability (staging only) -----------------------
  for (const r of rows("Datasheets_stratagems")) {
    const ds = dsByWahId.get(col(r, "datasheet_id"));
    const s = stratByWahId.get(col(r, "stratagem_id"));
    if (!ds || !s) continue;
    (staging.datasheetStratagems[ds.id] ??= []).push(s.id);
    // Also on the datasheet itself, so a snapshot can say which units a stratagem is for.
    if (!ds.stratagemIds.includes(s.id)) ds.stratagemIds.push(s.id);
  }
  for (const r of rows("Datasheets_enhancements")) {
    const ds = dsByWahId.get(col(r, "datasheet_id"));
    const e = enhByWahId.get(col(r, "enhancement_id"));
    if (!ds || !e) continue;
    (staging.datasheetEnhancements[ds.id] ??= []).push(e.id);
  }

  // ---- housekeeping ---------------------------------------------------------------------------
  const noModels = datasheets.filter((d) => d.models.length === 0);
  if (noModels.length) warnings.push(`${noModels.length} datasheets have no model profile: ${noModels.slice(0, 5).map((d) => d.name).join(", ")}${noModels.length > 5 ? ", ..." : ""}`);
  if (detachments.length) warnings.push(`Wahapedia carries no Detachment Points; ${detachments.length} detachments defaulted to dp=1`);

  const lastUpdate = col(rows("Last_update")[0] ?? {}, "last_update");
  staging.lastUpdate = lastUpdate || undefined;
  const sourceRef: SourceRef = {
    adapter: "wahapedia-csv",
    fetchedAt: fetchedAtOrNow(opts),
    url: opts.url ?? WAHAPEDIA_BASE_URL,
    notes: "Powered by Wahapedia (https://wahapedia.ru); text (c) Games Workshop",
  };
  const ref = lastUpdate || opts.ref;
  if (ref) sourceRef.ref = ref;

  const stubs: DatasheetStub[] = datasheets;
  return { sourceRef, warnings, factions, publications, datasheets: stubs, abilities, detachments, enhancements, stratagems, priceRules, wargearPrices, staging };
}

export const wahapediaCsvAdapter: Adapter = { id: "wahapedia-csv", parse };
