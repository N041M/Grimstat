import { Roster, type BattleSize, type Datasheet, type RosterUnit, type Snapshot } from "@grimstat/schema";
import { BATTLE_SIZES, baseWeaponName, parseLoadout } from "@grimstat/game-40k-11e";
import { rosterSummary } from "@grimstat/resolver";
import { newId, nowIso } from "./ids";

/** Pure roster helpers shared by the Armies pages. No DOM, no storage. */

/** One model group of a roster unit (the schema exports `ModelGroup` only as a zod value). */
export type ModelGroup = RosterUnit["models"][number];

export const BATTLE_SIZE_ORDER: BattleSize[] = ["combat-patrol", "incursion", "strike-force", "onslaught", "custom"];

export function pointsLimitFor(size: BattleSize, customLimit = 2000): number {
  return size === "custom" ? customLimit : BATTLE_SIZES[size].points;
}

export function detachmentPointsFor(size: BattleSize): number {
  // Mirrors constraints11e: a custom size is validated with Strike Force budgets.
  return size === "custom" ? BATTLE_SIZES["strike-force"].detachmentPoints : BATTLE_SIZES[size].detachmentPoints;
}

/** Enhancements a battle size allows (same custom-size rule as the Detachment Points budget). */
export function enhancementsFor(size: BattleSize): number {
  return size === "custom" ? BATTLE_SIZES["strike-force"].enhancements : BATTLE_SIZES[size].enhancements;
}

export function newRoster(opts: { snapshot: Snapshot; factionId: string; battleSize: BattleSize; name?: string; pointsLimit?: number }): Roster {
  const now = nowIso();
  const faction = opts.snapshot.data.factions.find((f) => f.id === opts.factionId);
  return Roster.parse({
    id: newId("roster"),
    ownerId: "local",
    createdAt: now,
    updatedAt: now,
    revision: 0,
    name: opts.name ?? `${faction?.name ?? opts.factionId} list`,
    gameSystemId: opts.snapshot.gameSystemId,
    snapshotId: opts.snapshot.id,
    factionId: opts.factionId,
    battleSize: opts.battleSize,
    pointsLimit: opts.pointsLimit ?? pointsLimitFor(opts.battleSize),
    detachments: [],
    units: [],
  });
}

export function touchRoster(r: Roster): Roster {
  return { ...r, updatedAt: nowIso(), revision: r.revision + 1 };
}

/** Deep copy with fresh identity; used by Duplicate and by permalinks that collide with a local id. */
export function cloneRoster(r: Roster, name: string): Roster {
  const now = nowIso();
  const copy = JSON.parse(JSON.stringify(r)) as Roster;
  return { ...copy, id: newId("roster"), name, createdAt: now, updatedAt: now, revision: 0 };
}

// ---------- datasheet classification ----------

export type UnitSection = "character" | "battleline" | "transport" | "other" | "allied";
export const SECTION_ORDER: UnitSection[] = ["character", "battleline", "transport", "other", "allied"];

const hasKeyword = (ds: Datasheet, kw: string) => ds.keywords.some((k) => k.trim().toUpperCase() === kw);

export function isCharacterSheet(ds: Datasheet): boolean {
  return ds.isCharacter || /character/i.test(ds.role ?? "") || hasKeyword(ds, "CHARACTER");
}

export function isBattlelineSheet(ds: Datasheet): boolean {
  return ds.isBattleline || /battleline/i.test(ds.role ?? "") || hasKeyword(ds, "BATTLELINE");
}

export function isTransportSheet(ds: Datasheet): boolean {
  return /dedicated\s+transport/i.test(ds.role ?? "") || hasKeyword(ds, "DEDICATED TRANSPORT");
}

/** Section of the units list a datasheet belongs to (via role flags, `role` text or keywords). */
export function sectionOf(ds: Datasheet | undefined, roster: Roster): UnitSection {
  if (!ds) return "other";
  if (ds.factionId !== roster.factionId) return "allied";
  if (isCharacterSheet(ds)) return "character";
  if (isBattlelineSheet(ds)) return "battleline";
  if (isTransportSheet(ds)) return "transport";
  return "other";
}

// ---------- model counts ----------

export interface ModelBounds {
  min: number;
  /** undefined when the datasheet does not say. */
  max: number | undefined;
}

/**
 * Total model-count bounds of a datasheet. A single composition line gives the bounds directly;
 * several lines (one per model profile, e.g. "1 Sergeant" + "4-9 Troopers") are summed.
 */
export function compositionBounds(ds: Datasheet): ModelBounds {
  const lines = ds.composition;
  const mins = lines.map((c) => c.min).filter((m): m is number => typeof m === "number" && m >= 0);
  const maxs = lines.map((c) => c.max).filter((m): m is number => typeof m === "number" && m >= 0);
  const fallbackMin = ds.models.length > 1 ? ds.models.length : 1;
  if (lines.length <= 1) {
    const min = mins[0] ?? fallbackMin;
    const max = maxs[0];
    return { min: Math.max(1, min), max: max !== undefined ? Math.max(max, min, 1) : undefined };
  }
  const min = mins.length === lines.length ? mins.reduce((s, m) => s + m, 0) : mins.length ? Math.max(...mins) : fallbackMin;
  const max = maxs.length === lines.length ? maxs.reduce((s, m) => s + m, 0) : maxs.length ? Math.max(...maxs) : undefined;
  return { min: Math.max(1, min), max: max !== undefined ? Math.max(max, min, 1) : undefined };
}

export function modelCountOf(unit: RosterUnit): number {
  return unit.models.reduce((s, g) => s + g.count, 0);
}

/**
 * Change a unit's total model count to `target`, keeping the "one of each leading profile, the
 * rest on the last profile" shape: leading groups keep their counts (never below 1) and the last
 * group absorbs the difference. When `target` is smaller than the leading groups allow, they are
 * trimmed from the end down to 1 each. Returns new objects; the input is untouched.
 */
export function distributeModelCount(groups: ModelGroup[], target: number): ModelGroup[] {
  if (groups.length === 0) return groups;
  const n = Math.max(groups.length, Math.floor(target) || 0);
  const out = groups.map((g) => ({ ...g, wargear: [...g.wargear] }));
  if (out.length === 1) {
    out[0]!.count = n;
    return out;
  }
  const last = out[out.length - 1]!;
  const leading = out.slice(0, -1);
  for (const g of leading) g.count = Math.max(1, g.count);
  const remainder = n - leading.reduce((s, g) => s + g.count, 0);
  if (remainder >= 1) {
    last.count = remainder;
    return out;
  }
  last.count = 1;
  let deficit = 1 - remainder;
  for (let i = leading.length - 1; i >= 0 && deficit > 0; i--) {
    const g = leading[i]!;
    const give = Math.min(deficit, g.count - 1);
    g.count -= give;
    deficit -= give;
  }
  return out;
}

// ---------- wargear ----------

/**
 * Weapon base names mentioned in the datasheet's default-loadout prose (case-insensitive substring
 * match on the part of the weapon name before " – "), in weapon order, de-duplicated.
 */
export function loadoutWargear(ds: Datasheet): string[] {
  const parsed = parseLoadout(ds);
  const wanted = new Set([...parsed.all, ...Object.values(parsed.byProfile).flat()]);
  return weaponBaseNames(ds).filter((b) => wanted.has(b.toLowerCase()));
}

/** Default wargear for one model profile: every-model weapons plus that profile's own. */
export function loadoutWargearFor(ds: Datasheet, profileName: string): string[] {
  const parsed = parseLoadout(ds);
  const wanted = new Set([...parsed.all, ...(parsed.byProfile[profileName.toLowerCase()] ?? [])]);
  return weaponBaseNames(ds).filter((b) => wanted.has(b.toLowerCase()));
}

/** Distinct weapon base names of a datasheet (multi-profile weapons collapse to one entry). */
export function weaponBaseNames(ds: Datasheet): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const w of ds.weapons) {
    const base = baseWeaponName(w.name);
    const key = base.toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(base);
  }
  return out;
}

/**
 * Model groups for a fresh unit: one model on every leading profile, the remainder on the last
 * (a single profile takes the whole count). Every group starts with the loadout-derived wargear.
 */
export function groupsFromDatasheet(ds: Datasheet, count?: number): ModelGroup[] {
  const bounds = compositionBounds(ds);
  const total = Math.max(1, count ?? bounds.min);
  const profiles = ds.models;
  if (profiles.length <= 1) return [{ modelProfileId: profiles[0]?.id ?? ds.id, count: total, wargear: loadoutWargear(ds) }];
  const base = profiles.map((p) => ({ modelProfileId: p.id, count: 1, wargear: loadoutWargearFor(ds, p.name) }));
  return distributeModelCount(base, total);
}

export function newRosterUnit(ds: Datasheet): RosterUnit {
  return { id: newId("u"), datasheetId: ds.id, models: groupsFromDatasheet(ds), isWarlord: false };
}

/** Copy of a unit with fresh identity; attachment, warlord and (unique) enhancement are not copied. */
export function duplicateUnit(u: RosterUnit): RosterUnit {
  const { attachedTo: _a, enhancementId: _e, ...rest } = JSON.parse(JSON.stringify(u)) as RosterUnit;
  return { ...rest, id: newId("u"), isWarlord: false };
}

/**
 * Move the unit `id` by `delta` places in `roster.units`, clamped to the ends of the list. The same
 * roster object comes back when nothing moves, so callers can skip a save.
 */
export function moveUnit(roster: Roster, id: string, delta: number): Roster {
  const from = roster.units.findIndex((u) => u.id === id);
  if (from < 0 || !Number.isFinite(delta)) return roster;
  const to = Math.max(0, Math.min(roster.units.length - 1, from + Math.trunc(delta)));
  if (to === from) return roster;
  const units = [...roster.units];
  const [unit] = units.splice(from, 1);
  units.splice(to, 0, unit!);
  return { ...roster, units };
}

export type UnitAttachment = NonNullable<RosterUnit["attachedTo"]>;

/** One unit taken out of a roster, with what `restoreUnits` needs to put it back where it was. */
export interface RemovedUnit {
  unit: RosterUnit;
  /** Index in `roster.units` before the removal. */
  index: number;
  /** Characters that were attached to this unit and lost the attachment when it went. */
  detached: Array<{ id: string; attachedTo: UnitAttachment }>;
}

/**
 * Take the units with the given ids out of the roster. Characters attached to a removed unit stay
 * in the list and lose their attachment. `removed` records the former indices and attachments.
 */
export function removeUnits(roster: Roster, ids: Iterable<string>): { roster: Roster; removed: RemovedUnit[] } {
  const gone = new Set(ids);
  const removed: RemovedUnit[] = [];
  roster.units.forEach((unit, index) => {
    if (gone.has(unit.id)) removed.push({ unit, index, detached: [] });
  });
  if (removed.length === 0) return { roster, removed };
  const byId = new Map(removed.map((r) => [r.unit.id, r] as const));
  const units: RosterUnit[] = [];
  for (const u of roster.units) {
    if (gone.has(u.id)) continue;
    const host = u.attachedTo ? byId.get(u.attachedTo.unitId) : undefined;
    if (host && u.attachedTo) {
      host.detached.push({ id: u.id, attachedTo: u.attachedTo });
      const { attachedTo: _a, ...rest } = u;
      units.push(rest);
    } else units.push(u);
  }
  return { roster: { ...roster, units }, removed };
}

/**
 * Undo of `removeUnits`: each unit goes back at its former index (clamped to the current length)
 * and the characters it had re-attach to it. A unit that is already present is left alone, and a
 * character that has since attached elsewhere or left the list keeps its current state.
 */
export function restoreUnits(roster: Roster, removed: RemovedUnit[]): Roster {
  const units = [...roster.units];
  const present = new Set(units.map((u) => u.id));
  for (const r of [...removed].sort((a, b) => a.index - b.index)) {
    if (present.has(r.unit.id)) continue;
    units.splice(Math.min(r.index, units.length), 0, r.unit);
    present.add(r.unit.id);
  }
  const reattach = new Map<string, UnitAttachment>();
  for (const r of removed) for (const d of r.detached) reattach.set(d.id, d.attachedTo);
  return {
    ...roster,
    units: units.map((u) => {
      const a = reattach.get(u.id);
      return a && !u.attachedTo && present.has(a.unitId) ? { ...u, attachedTo: a } : u;
    }),
  };
}

export function hasWargear(group: ModelGroup, item: string): boolean {
  const key = item.toLowerCase();
  return group.wargear.some((w) => w.toLowerCase() === key);
}

export function toggleWargear(group: ModelGroup, item: string, on: boolean): ModelGroup {
  const key = item.toLowerCase();
  const without = group.wargear.filter((w) => w.toLowerCase() !== key);
  return { ...group, wargear: on ? [...without, item] : without };
}

// ---------- diff ----------

export interface DiffEntry {
  id: string;
  name: string;
  points: number;
}
export interface DiffChange extends DiffEntry {
  before: number;
}
export interface RosterDiff {
  added: DiffEntry[];
  removed: DiffEntry[];
  changed: DiffChange[];
  pointsBefore: number;
  pointsAfter: number;
}

/** Unit-level comparison of two revisions (name + points), using the resolver's costing. */
export function diffRosters(prev: Roster, next: Roster, snapshot: Snapshot): RosterDiff {
  const a = rosterSummary(prev, snapshot);
  const b = rosterSummary(next, snapshot);
  const byIdA = new Map(a.units.map((u) => [u.id, u] as const));
  const byIdB = new Map(b.units.map((u) => [u.id, u] as const));
  const unitA = new Map(prev.units.map((u) => [u.id, u] as const));
  const unitB = new Map(next.units.map((u) => [u.id, u] as const));
  const added: DiffEntry[] = [];
  const removed: DiffEntry[] = [];
  const changed: DiffChange[] = [];
  for (const u of b.units) {
    const old = byIdA.get(u.id);
    if (!old) added.push({ id: u.id, name: u.name, points: u.cost.total });
    else if (old.cost.total !== u.cost.total || JSON.stringify(unitA.get(u.id)) !== JSON.stringify(unitB.get(u.id))) changed.push({ id: u.id, name: u.name, points: u.cost.total, before: old.cost.total });
  }
  for (const u of a.units) if (!byIdB.has(u.id)) removed.push({ id: u.id, name: u.name, points: u.cost.total });
  return { added, removed, changed, pointsBefore: a.points, pointsAfter: b.points };
}

/**
 * What one saved revision did, for the editor's history list. Deliberately coarse: a revision is
 * one auto-save, so a single unit change is the common case and anything busier is just a count.
 * Revisions that touched no unit are told apart by what else moved: the detachments, the name,
 * the battle size or points limit, the unit order, or something smaller (notes). `unreadable` is
 * never produced here; the dock uses it for a stored revision that fails to parse.
 */
export type RevisionChange =
  | { kind: "created" }
  | { kind: "added" | "removed" | "changed"; name: string }
  | { kind: "detachments" }
  | { kind: "renamed"; name: string }
  | { kind: "settings" }
  | { kind: "reordered" }
  | { kind: "other" }
  | { kind: "multi"; n: number }
  | { kind: "unreadable" };

export function describeRevisionChange(prev: Roster | undefined, next: Roster, snapshot: Snapshot): RevisionChange {
  if (!prev) return { kind: "created" };
  const d = diffRosters(prev, next, snapshot);
  const total = d.added.length + d.removed.length + d.changed.length;
  if (total > 1) return { kind: "multi", n: total };
  if (d.added.length) return { kind: "added", name: d.added[0]!.name };
  if (d.removed.length) return { kind: "removed", name: d.removed[0]!.name };
  if (d.changed.length) return { kind: "changed", name: d.changed[0]!.name };
  if (JSON.stringify(prev.detachments) !== JSON.stringify(next.detachments)) return { kind: "detachments" };
  if (prev.name !== next.name) return { kind: "renamed", name: next.name };
  if (prev.battleSize !== next.battleSize || prev.pointsLimit !== next.pointsLimit) return { kind: "settings" };
  if (prev.units.map((u) => u.id).join("\n") !== next.units.map((u) => u.id).join("\n")) return { kind: "reordered" };
  return { kind: "other" };
}

/** "/units/3" → 3; anything else → undefined. */
export function unitIndexFromPath(path: string | undefined): number | undefined {
  const m = path ? /^\/units\/(\d+)(?:\/|$)/.exec(path) : null;
  return m ? Number(m[1]) : undefined;
}

// ---------- display helpers (units list, picker, header) ----------

export function unitDisplayName(unit: RosterUnit, ds: Datasheet | undefined): string {
  return unit.customName?.trim() || ds?.name || unit.datasheetId;
}

export interface WargearSummaryItem {
  name: string;
  /** Number of models carrying the item (sum of the group counts that have it). */
  count: number;
  /** Not a weapon of the datasheet ("other wargear" typed by the user). */
  extra: boolean;
}

/**
 * Wargear carried by a unit, aggregated over its model groups: datasheet weapons first (in datasheet
 * order, cased as on the datasheet), then anything else the user added. Names are de-duplicated
 * case-insensitively; a group counts each item once.
 */
export function wargearSummaryItems(unit: RosterUnit, ds: Datasheet | undefined): WargearSummaryItem[] {
  const counts = new Map<string, { name: string; count: number }>();
  for (const g of unit.models) {
    const seen = new Set<string>();
    for (const raw of g.wargear) {
      const name = raw.trim();
      const key = name.toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const cur = counts.get(key);
      if (cur) cur.count += g.count;
      else counts.set(key, { name, count: g.count });
    }
  }
  const out: WargearSummaryItem[] = [];
  for (const name of ds ? weaponBaseNames(ds) : []) {
    const key = name.toLowerCase();
    const hit = counts.get(key);
    if (!hit) continue;
    out.push({ name, count: hit.count, extra: false });
    counts.delete(key);
  }
  for (const v of counts.values()) out.push({ name: v.name, count: v.count, extra: true });
  return out;
}

/**
 * One-line wargear summary for a list row, e.g. "Flux carbine ×5, Shock maul ×5, Power fist ×1 · +1 Banner".
 * Single-model units drop the "×1" noise ("Flux pistol, Relic blade"). Empty string when nothing is carried.
 */
export function wargearSummary(unit: RosterUnit, ds: Datasheet | undefined): string {
  const items = wargearSummaryItems(unit, ds);
  const single = modelCountOf(unit) <= 1;
  const main = items.filter((i) => !i.extra).map((i) => (single ? i.name : `${i.name} ×${i.count}`));
  const extra = items.filter((i) => i.extra).map((i) => `+${i.count} ${i.name}`);
  return [main.join(", "), extra.join(", ")].filter(Boolean).join(" · ");
}

export interface DuplicateCap {
  /** Maximum copies of the datasheet in the army. */
  cap: number;
  kind: "epicHero" | "battleline" | "standard";
}

/**
 * Copies of one datasheet an army may contain; mirrors the `units.duplicates` rule of constraints11e:
 * the battle size's figure (custom = Strike Force), doubled for Battleline, always 1 for Epic Heroes.
 */
export function duplicateCap(ds: Pick<Datasheet, "isEpicHero" | "isBattleline">, size: BattleSize): DuplicateCap {
  const base = size === "custom" ? BATTLE_SIZES["strike-force"].duplicates : BATTLE_SIZES[size].duplicates;
  if (ds.isEpicHero) return { cap: 1, kind: "epicHero" };
  if (ds.isBattleline) return { cap: base * 2, kind: "battleline" };
  return { cap: base, kind: "standard" };
}

/** Whether one more copy of `ds` may be added given the copies already in the roster. */
export function canAddCopy(ds: Pick<Datasheet, "isEpicHero" | "isBattleline">, copies: number, size: BattleSize): boolean {
  return copies < duplicateCap(ds, size).cap;
}

export type PickerGroup = "character" | "battleline" | "transport" | "other" | "legends";
export const PICKER_GROUP_ORDER: PickerGroup[] = ["character", "battleline", "transport", "other", "legends"];

/** Group of the add-unit picker a datasheet is listed under; Legends sheets always go last. */
export function pickerGroupOf(ds: Datasheet): PickerGroup {
  if (ds.isLegends) return "legends";
  if (isCharacterSheet(ds)) return "character";
  if (isBattlelineSheet(ds)) return "battleline";
  if (isTransportSheet(ds)) return "transport";
  return "other";
}

export type MeterTone = "ok" | "warn" | "danger";

/** Colour of the points meter: danger over the limit, warn above 90 % of it. */
export function pointsTone(points: number, limit: number): MeterTone {
  if (points > limit) return "danger";
  if (limit > 0 && points > limit * 0.9) return "warn";
  return "ok";
}

/**
 * Model-count bounds of one model group of a unit. When the datasheet has one composition line per
 * group ("1 Sergeant" + "4-9 Wardens") the matching line is used; otherwise the unit's total bounds
 * are shared out so that the other groups keep their current counts.
 */
export function groupBounds(ds: Datasheet | undefined, groups: ModelGroup[], index: number): ModelBounds {
  if (!ds) return { min: 1, max: undefined };
  const lines = ds.composition;
  if (lines.length > 1 && lines.length === groups.length) {
    const line = lines[index]!;
    const min = Math.max(1, line.min ?? 1);
    return { min, max: line.max !== undefined ? Math.max(min, line.max) : undefined };
  }
  const total = compositionBounds(ds);
  const others = groups.reduce((s, g, i) => (i === index ? s : s + g.count), 0);
  const min = Math.max(1, total.min - others);
  return { min, max: total.max !== undefined ? Math.max(min, total.max - others) : undefined };
}

/** Diagnostics attached to the unit at `index` (path "/units/<index>"). */
export function diagnosticsForUnit<T extends { path?: string | undefined }>(diagnostics: T[], index: number): T[] {
  return diagnostics.filter((d) => unitIndexFromPath(d.path) === index);
}
