import { Roster, type BattleSize, type Datasheet, type RosterUnit, type Snapshot } from "@grimstat/schema";
import { BATTLE_SIZES, baseWeaponName } from "@grimstat/game-40k-11e";
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
  const text = (ds.loadout ?? "").toLowerCase();
  if (!text) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const w of ds.weapons) {
    const base = baseWeaponName(w.name);
    const key = base.toLowerCase();
    if (!key || seen.has(key)) continue;
    if (text.includes(key)) {
      seen.add(key);
      out.push(base);
    }
  }
  return out;
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
  const wargear = loadoutWargear(ds);
  const profiles = ds.models;
  if (profiles.length <= 1) return [{ modelProfileId: profiles[0]?.id ?? ds.id, count: total, wargear: [...wargear] }];
  const base = profiles.map((p) => ({ modelProfileId: p.id, count: 1, wargear: [...wargear] }));
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

/** "/units/3" → 3; anything else → undefined. */
export function unitIndexFromPath(path: string | undefined): number | undefined {
  const m = path ? /^\/units\/(\d+)(?:\/|$)/.exec(path) : null;
  return m ? Number(m[1]) : undefined;
}
