import type { Ability, AbilityScope, Datasheet, ModelProfile, Snapshot, WeaponProfile } from "@grimstat/schema";
import { baseWeaponName, pointsFor } from "@grimstat/game-40k-11e";
import { compositionBounds, groupsFromDatasheet, isBattlelineSheet, isCharacterSheet, isTransportSheet, PICKER_GROUP_ORDER, pickerGroupOf, type ModelBounds, type PickerGroup } from "./roster";

/**
 * The Codex screen's model: how the active snapshot's datasheets are browsed, how one is laid out
 * as a sheet, and how several are laid side by side. Everything here is derived from the snapshot;
 * the screen owns only the selection, the compare set and the filters.
 *
 * No DOM, no React, no strings for people — labels stay in the components, so the maths and the
 * grouping can be tested against the synthetic snapshot directly.
 */

/** Dexie `settings` keys the screen remembers itself under. */
export const CODEX_COMPARE_KEY = "codex.compare";
export const CODEX_FACTION_KEY = "codex.faction";
export const CODEX_DIFF_KEY = "codex.diffOnly";
export const CODEX_FILTERS_KEY = "codex.filters";

/** How many datasheets stand side by side before the compare view refuses another. */
export const COMPARE_CAP = 6;

export type CodexView = "sheets" | "compare";

/** The faction filter's "every faction" value — remembered as such, unlike "not chosen yet". */
export const ALL_FACTIONS = "*";

/* ---- remembered state ------------------------------------------------------------------------- */

export function parseCompareSet(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw) || !raw.every((x): x is string => typeof x === "string")) return undefined;
  return [...new Set(raw)].slice(0, COMPARE_CAP);
}

export const parseFaction = (raw: unknown): string | undefined => (typeof raw === "string" ? raw : undefined);
export const parseFlag = (raw: unknown): boolean | undefined => (typeof raw === "boolean" ? raw : undefined);

/**
 * Add a datasheet to the compare set or take it out again, in place order. A full set is left
 * as it is (the same array back, so callers can tell nothing happened).
 */
export function toggleCompare(set: string[], id: string): string[] {
  if (set.includes(id)) return set.filter((x) => x !== id);
  if (set.length >= COMPARE_CAP) return set;
  return [...set, id];
}

/* ---- browsing --------------------------------------------------------------------------------- */

export interface CodexFaction {
  id: string;
  name: string;
  /** Datasheets of this faction in the snapshot. */
  count: number;
}

/**
 * The factions worth listing: those with at least one datasheet, by name. A datasheet whose faction
 * the snapshot never recorded is listed under its faction id, so nothing is unreachable.
 */
export function codexFactions(snapshot: Snapshot): CodexFaction[] {
  const counts = new Map<string, number>();
  for (const d of snapshot.data.datasheets) counts.set(d.factionId, (counts.get(d.factionId) ?? 0) + 1);
  const names = new Map(snapshot.data.factions.map((f) => [f.id, f.name] as const));
  return [...counts.entries()].map(([id, count]) => ({ id, name: names.get(id) ?? id, count })).sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The faction the browser shows: the remembered one while the snapshot still has it, otherwise the
 * open sheet's faction, otherwise every faction. `ALL_FACTIONS` is kept.
 *
 * Nothing remembered means the reader has not chosen a faction, so a search covers all of them.
 * Settling on the first faction by name instead hid every other army behind a filter the reader
 * never set.
 */
export function effectiveFaction(stored: string, factions: readonly CodexFaction[], selected: Datasheet | undefined): string {
  if (stored === ALL_FACTIONS) return ALL_FACTIONS;
  if (stored && factions.some((f) => f.id === stored)) return stored;
  return selected?.factionId ?? ALL_FACTIONS;
}

export interface CodexGroup {
  group: PickerGroup;
  sheets: Datasheet[];
}

/* ---- filtering ------------------------------------------------------------------------------- */

/**
 * What a datasheet is, ignoring whether it is Legends.
 *
 * `pickerGroupOf` answers Legends first, because that is how the list is laid out, and a filter
 * that borrowed it would drop a Legends character from a search for characters. Whether a sheet is
 * Legends is its own question, and its own switch.
 */
export type SheetType = "character" | "battleline" | "transport" | "fortification" | "other";
export const SHEET_TYPES: readonly SheetType[] = ["character", "battleline", "transport", "fortification", "other"];

const isFortification = (ds: Datasheet): boolean => /fortification/i.test(ds.role ?? "") || ds.keywords.includes("FORTIFICATION");

export function sheetType(ds: Datasheet): SheetType {
  if (isCharacterSheet(ds)) return "character";
  if (isBattlelineSheet(ds)) return "battleline";
  if (isTransportSheet(ds)) return "transport";
  if (isFortification(ds)) return "fortification";
  return "other";
}

/** Every filter the codex offers beyond the faction and the search box. */
export interface CodexFilters {
  /** What the unit is, or every kind. */
  type: SheetType | "any";
  /** Legends datasheets listed. A third of a full snapshot is Legends. */
  legends: boolean;
  /** Keywords the sheet must carry, all of them. */
  keywords: string[];
  /** Points at the smallest legal size. */
  minPoints?: number;
  maxPoints?: number;
  /** The representative model's characteristics, at least this much. */
  minM?: number;
  minT?: number;
  minW?: number;
  minOC?: number;
  /** A save of this value or better, so 3 admits 3+ and 2+. */
  maxSv?: number;
  /** Only sheets whose representative model has an invulnerable save. */
  invuln: boolean;
}

export const NO_FILTERS: CodexFilters = { type: "any", legends: true, keywords: [], invuln: false };

/** How many filters are on, for the button that opens them. */
export function filterCount(f: CodexFilters): number {
  let n = f.keywords.length;
  if (f.type !== "any") n++;
  if (!f.legends) n++;
  if (f.invuln) n++;
  for (const v of [f.minPoints, f.maxPoints, f.minM, f.minT, f.minW, f.minOC, f.maxSv]) if (v !== undefined) n++;
  return n;
}

export const anyFilter = (f: CodexFilters): boolean => filterCount(f) > 0;

function parseNumber(raw: unknown): number | undefined {
  return typeof raw === "number" && Number.isFinite(raw) ? raw : undefined;
}

/** A remembered filter set, read back only as far as it still makes sense. */
export function parseFilters(raw: unknown): CodexFilters | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const r = raw as Record<string, unknown>;
  const type = SHEET_TYPES.find((t) => t === r.type) ?? "any";
  const keywords = Array.isArray(r.keywords) ? [...new Set(r.keywords.filter((k): k is string => typeof k === "string"))] : [];
  return {
    type,
    legends: r.legends !== false,
    keywords,
    invuln: r.invuln === true,
    minPoints: parseNumber(r.minPoints),
    maxPoints: parseNumber(r.maxPoints),
    minM: parseNumber(r.minM),
    minT: parseNumber(r.minT),
    minW: parseNumber(r.minW),
    minOC: parseNumber(r.minOC),
    maxSv: parseNumber(r.maxSv),
  };
}

/** Whether one datasheet passes the filters. Points need the snapshot; the rest are on the sheet. */
export function passesFilters(ds: Datasheet, snapshot: Snapshot | undefined, f: CodexFilters): boolean {
  if (!f.legends && ds.isLegends) return false;
  if (f.type !== "any" && sheetType(ds) !== f.type) return false;
  for (const k of f.keywords) if (!ds.keywords.includes(k) && !ds.factionKeywords.includes(k)) return false;
  if (f.minPoints !== undefined || f.maxPoints !== undefined) {
    const pts = snapshot ? minPoints(ds, snapshot) : undefined;
    if (pts === undefined) return false;
    if (f.minPoints !== undefined && pts < f.minPoints) return false;
    if (f.maxPoints !== undefined && pts > f.maxPoints) return false;
  }
  const rep = representativeProfile(ds);
  // A sheet with no model profile cannot answer a question about one, so it is not an answer to it.
  const atLeast = (v: number | null | undefined, floor: number | undefined): boolean => floor === undefined || (typeof v === "number" && v >= floor);
  if (!atLeast(rep?.M, f.minM)) return false;
  if (!atLeast(rep?.T, f.minT)) return false;
  if (!atLeast(rep?.W, f.minW)) return false;
  if (!atLeast(rep?.OC, f.minOC)) return false;
  if (f.maxSv !== undefined && !(typeof rep?.Sv === "number" && rep.Sv <= f.maxSv)) return false;
  if (f.invuln && !rep?.InvSv) return false;
  return true;
}

/** A keyword the picker offers, and how many of the sheets in view carry it. */
export interface CodexKeyword {
  name: string;
  count: number;
}

/**
 * The keywords carried by the sheets a faction filter admits, by name, with their counts.
 *
 * By name because that is the order to read a long list in, and counted because a half-typed
 * keyword has to settle on one: "psy" means PSYKER, which a hundred and forty sheets carry, not
 * PSYCHOMANCER, which one does and which happens to come first in the alphabet.
 */
export function codexKeywords(datasheets: readonly Datasheet[], factionId: string): CodexKeyword[] {
  const every = !factionId || factionId === ALL_FACTIONS;
  const counts = new Map<string, number>();
  for (const d of datasheets) {
    if (!every && d.factionId !== factionId) continue;
    for (const k of new Set([...d.keywords, ...d.factionKeywords])) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return [...counts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name));
}

function matches(d: Datasheet, q: string): boolean {
  return d.name.toLowerCase().includes(q) || (d.role ?? "").toLowerCase().includes(q) || d.keywords.some((k) => k.toLowerCase().includes(q));
}

/**
 * The datasheets of one faction — or of every faction for `ALL_FACTIONS` — that match the query on
 * name, role or keyword and pass the filters, grouped the way the army builder's picker groups them.
 */
export function codexGroups(snapshot: Snapshot | undefined, factionId: string, query: string, filters: CodexFilters = NO_FILTERS): CodexGroup[] {
  if (!snapshot) return [];
  const q = query.trim().toLowerCase();
  const every = !factionId || factionId === ALL_FACTIONS;
  const rows = snapshot.data.datasheets
    .filter((d) => (every || d.factionId === factionId) && (!q || matches(d, q)) && passesFilters(d, snapshot, filters))
    .sort((a, b) => a.name.localeCompare(b.name));
  return PICKER_GROUP_ORDER.map((group) => ({ group, sheets: rows.filter((d) => pickerGroupOf(d) === group) })).filter((g) => g.sheets.length > 0);
}

/** A group as far as it has been drawn, beside the number of sheets it holds in all. */
export interface ShownGroup extends CodexGroup {
  total: number;
}

/** How many sheets a codex list draws before the reader scrolls, and how many more each time. */
export const CODEX_PAGE = 80;

/**
 * The first `limit` sheets of the groups, in group order, each group told how many it holds in all.
 *
 * With no faction chosen a list covers the whole snapshot, and drawing seventeen hundred of
 * anything takes long enough to see. The groups are cut to what the reader has scrolled to; the
 * totals beside the headings stay the real ones, so the list still says how much is there.
 */
export function shownGroups(groups: readonly CodexGroup[], limit: number): ShownGroup[] {
  const out: ShownGroup[] = [];
  let left = Math.max(0, limit);
  for (const g of groups) {
    if (left <= 0) break;
    out.push({ group: g.group, sheets: g.sheets.slice(0, left), total: g.sheets.length });
    left -= g.sheets.length;
  }
  return out;
}

/**
 * Datasheets for the compare view's "add" box, best match first: a name that starts with the
 * query outranks one that merely contains it, and the sheets already in the set are left out.
 */
export function searchDatasheets(datasheets: readonly Datasheet[], query: string, exclude: readonly string[], limit = 8): Datasheet[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const skip = new Set(exclude);
  const scored = datasheets
    .filter((d) => !skip.has(d.id) && matches(d, q))
    .map((d) => ({ d, rank: d.name.toLowerCase().startsWith(q) ? 0 : d.name.toLowerCase().includes(q) ? 1 : 2 }))
    .sort((a, b) => a.rank - b.rank || a.d.name.localeCompare(b.d.name));
  return scored.slice(0, limit).map((x) => x.d);
}

/* ---- one sheet -------------------------------------------------------------------------------- */

export const sizeBounds = (ds: Datasheet): ModelBounds => compositionBounds(ds);

/** Points at the smallest legal size — what a list pays for the first copy. */
export const minPoints = (ds: Datasheet, snapshot: Snapshot): number | undefined => pointsFor(ds, snapshot, compositionBounds(ds).min);

/** Points at the largest legal size; undefined when the size is open-ended. */
export function maxPoints(ds: Datasheet, snapshot: Snapshot): number | undefined {
  const b = compositionBounds(ds);
  return b.max === undefined ? undefined : pointsFor(ds, snapshot, b.max);
}

export interface PointsTier {
  models: number;
  points: number;
}

export interface PointsLine {
  /** The rule's own wording, e.g. "Your 3rd + Unit Costs"; absent for a flat price. */
  label: string | undefined;
  tiers: PointsTier[];
}

/**
 * Every price the snapshot holds for the sheet, first copies first, each rule's tiers by size.
 * A sheet with no price rule but a fallback price is one flat line at its minimum size.
 */
export function pointsLines(ds: Datasheet, snapshot: Snapshot): PointsLine[] {
  const rules = snapshot.data.priceRules.filter((r) => r.datasheetId === ds.id).sort((a, b) => a.copyRange.min - b.copyRange.min);
  if (!rules.length) return ds.fallbackPoints === undefined ? [] : [{ label: undefined, tiers: [{ models: compositionBounds(ds).min, points: ds.fallbackPoints }] }];
  return rules.map((r) => ({ label: r.label, tiers: [...r.tiers].sort((a, b) => a.models - b.models).map((t) => ({ models: t.models, points: t.points })) }));
}

export interface WargearPriceLine {
  item: string;
  points: number;
}

export const wargearPrices = (ds: Datasheet, snapshot: Snapshot): WargearPriceLine[] => snapshot.data.wargearPrices.filter((w) => w.datasheetId === ds.id).map((w) => ({ item: w.item, points: w.points }));

export interface WeaponRow {
  profile: WeaponProfile;
  /** What sets this profile apart inside its weapon ("supercharge"); undefined for a plain weapon. */
  label: string | undefined;
}

export interface WeaponGroup {
  name: string;
  profiles: WeaponRow[];
}

function profileLabel(name: string, group: string): string | undefined {
  if (name.toLowerCase() === group.toLowerCase()) return undefined;
  if (!name.toLowerCase().startsWith(group.toLowerCase())) return name;
  const rest = name
    .slice(group.length)
    .replace(/^\s*[–—-]\s*/, "")
    .trim();
  return rest || undefined;
}

/**
 * The ranged or the melee half of a sheet's weapons, in datasheet order, a multi-profile weapon
 * folded under its own name with each profile labelled by what differs.
 */
export function weaponGroups(ds: Datasheet, kind: WeaponProfile["kind"]): WeaponGroup[] {
  const out: WeaponGroup[] = [];
  const byKey = new Map<string, WeaponGroup>();
  for (const w of ds.weapons) {
    if (w.kind !== kind) continue;
    const name = w.groupName ?? baseWeaponName(w.name);
    const key = name.toLowerCase();
    let g = byKey.get(key);
    if (!g) {
      g = { name, profiles: [] };
      byKey.set(key, g);
      out.push(g);
    }
    g.profiles.push({ profile: w, label: profileLabel(w.name, name) });
  }
  return out;
}

export type AbilityBucket = "core" | "faction" | "datasheet" | "wargear" | "other";
export const ABILITY_BUCKETS: readonly AbilityBucket[] = ["core", "faction", "datasheet", "wargear", "other"];

const bucketOf = (scope: AbilityScope): AbilityBucket => (scope === "core" || scope === "faction" || scope === "datasheet" || scope === "wargear" ? scope : "other");

export interface AbilityGroup {
  bucket: AbilityBucket;
  abilities: Ability[];
}

export interface SheetAbilities {
  groups: AbilityGroup[];
  /** Ability ids the sheet names that the snapshot does not carry. */
  missing: string[];
}

/** A sheet's abilities resolved and bucketed as a datasheet prints them: core, faction, then its own. */
export function abilityGroups(ds: Datasheet, snapshot: Snapshot): SheetAbilities {
  const byId = new Map(snapshot.data.abilities.map((a) => [a.id, a] as const));
  const buckets = new Map<AbilityBucket, Ability[]>();
  const missing: string[] = [];
  for (const id of ds.abilityIds) {
    const a = byId.get(id);
    if (!a) {
      missing.push(id);
      continue;
    }
    const b = bucketOf(a.scope);
    buckets.set(b, [...(buckets.get(b) ?? []), a]);
  }
  return { groups: ABILITY_BUCKETS.filter((b) => buckets.has(b)).map((b) => ({ bucket: b, abilities: buckets.get(b)! })), missing };
}

/** Datasheets that can lead this one — the converse of the sheet's own `leaderTo`. */
export const ledBy = (ds: Datasheet, snapshot: Snapshot): Datasheet[] => snapshot.data.datasheets.filter((d) => d.id !== ds.id && d.leaderTo.includes(ds.id)).sort((a, b) => a.name.localeCompare(b.name));

export const supportedBy = (ds: Datasheet, snapshot: Snapshot): Datasheet[] => snapshot.data.datasheets.filter((d) => d.id !== ds.id && d.supportTo.includes(ds.id)).sort((a, b) => a.name.localeCompare(b.name));

/** Datasheets by id, in the order asked for; ids the snapshot lacks are dropped. */
export function sheetsById(snapshot: Snapshot, ids: readonly string[]): Datasheet[] {
  const byId = new Map(snapshot.data.datasheets.map((d) => [d.id, d] as const));
  return ids.map((id) => byId.get(id)).filter((d): d is Datasheet => d !== undefined);
}

/* ---- the unit as a whole ---------------------------------------------------------------------- */

/**
 * Wounds across the unit at its smallest size, models distributed over the profiles the way the
 * army builder distributes them (one of each named model, the rank and file take the rest).
 */
export function unitWounds(ds: Datasheet): number {
  const byId = new Map(ds.models.map((m) => [m.id, m] as const));
  return groupsFromDatasheet(ds).reduce((s, g) => s + g.count * (byId.get(g.modelProfileId)?.W ?? 0), 0);
}

/**
 * The profile that stands for the unit when one number is wanted: the most numerous model at the
 * smallest size, the later profile on a tie — the same convention that makes the last profile the
 * rank and file in the army builder.
 */
export function representativeProfile(ds: Datasheet): ModelProfile | undefined {
  const groups = groupsFromDatasheet(ds);
  let best: { id: string; count: number } | undefined;
  for (const g of groups) if (!best || g.count >= best.count) best = { id: g.modelProfileId, count: g.count };
  return ds.models.find((m) => m.id === best?.id) ?? ds.models[0];
}

/* ---- comparing -------------------------------------------------------------------------------- */

export type CharacteristicKey = "M" | "T" | "Sv" | "InvSv" | "W" | "Ld" | "OC";
export type Better = "higher" | "lower";

export interface CharacteristicDef {
  key: CharacteristicKey;
  better: Better;
}

/** The profile line in datasheet order, and which way each number is better. */
export const CHARACTERISTICS: readonly CharacteristicDef[] = [
  { key: "M", better: "higher" },
  { key: "T", better: "higher" },
  { key: "Sv", better: "lower" },
  { key: "InvSv", better: "lower" },
  { key: "W", better: "higher" },
  { key: "Ld", better: "lower" },
  { key: "OC", better: "higher" },
];

export function characteristic(m: ModelProfile, key: CharacteristicKey): number | null {
  const v = m[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** A characteristic as the sheet prints it: `6"`, `3+`, `2`; an em dash when the model has none. */
export function characteristicText(key: CharacteristicKey, v: number | null): string {
  if (v === null) return "—";
  if (key === "M") return `${v}"`;
  if (key === "Sv" || key === "InvSv" || key === "Ld") return `${v}+`;
  return String(v);
}

/** Distinct values across a sheet's profiles, in profile order — `2 / 1` for a boss and his mob. */
export function characteristicCell(ds: Datasheet, key: CharacteristicKey): string {
  const texts = [...new Set(ds.models.map((m) => characteristicText(key, characteristic(m, key))))];
  return texts.join(" / ");
}

/**
 * Which columns hold the best value: empty when fewer than two columns have one, or when every
 * column that has one agrees. A missing value never wins and never stops the others from winning.
 */
export function bestIndices(values: ReadonlyArray<number | null | undefined>, better: Better): number[] {
  const have = values.map((v, i) => ({ v, i })).filter((x): x is { v: number; i: number } => typeof x.v === "number" && Number.isFinite(x.v));
  if (have.length < 2) return [];
  const best = have.reduce((acc, x) => (better === "higher" ? Math.max(acc, x.v) : Math.min(acc, x.v)), have[0]!.v);
  const winners = have.filter((x) => x.v === best).map((x) => x.i);
  return winners.length === have.length ? [] : winners;
}

/** True when the cells do not all read the same — the "differences only" filter's test. */
export function differs(cells: readonly string[]): boolean {
  if (cells.length < 2) return false;
  const first = cells[0]!.trim();
  return cells.some((c) => c.trim() !== first);
}

export interface CompareNumberRow {
  key: CharacteristicKey;
  cells: string[];
  best: number[];
  differs: boolean;
}

/** One profile characteristic across the compared sheets, the representative model deciding who is best. */
export function characteristicRow(sheets: readonly Datasheet[], def: CharacteristicDef): CompareNumberRow {
  const cells = sheets.map((d) => characteristicCell(d, def.key));
  const reps = sheets.map((d) => {
    const m = representativeProfile(d);
    return m ? characteristic(m, def.key) : null;
  });
  return { key: def.key, cells, best: bestIndices(reps, def.better), differs: differs(cells) };
}

export interface UnitFigures {
  minModels: number;
  maxModels: number | undefined;
  minPoints: number | undefined;
  maxPoints: number | undefined;
  wounds: number;
  /** Points paid per wound at the smallest size; undefined without a price. */
  pointsPerWound: number | undefined;
}

export function unitFigures(ds: Datasheet, snapshot: Snapshot): UnitFigures {
  const b = compositionBounds(ds);
  const min = minPoints(ds, snapshot);
  const wounds = unitWounds(ds);
  return {
    minModels: b.min,
    maxModels: b.max,
    minPoints: min,
    maxPoints: maxPoints(ds, snapshot),
    wounds,
    pointsPerWound: min === undefined || wounds <= 0 ? undefined : min / wounds,
  };
}
