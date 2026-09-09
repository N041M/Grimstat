import type { Roster, Scenario, ScenarioUnit, Snapshot } from "@grimstat/schema";
import { archetypes, unitFromDatasheet, unitFromRosterUnit } from "@grimstat/game-40k-11e";
import { cloneUnit } from "./scenario";
import { newId } from "./ids";

/** Where a unit in an analysis set came from; this is what gets persisted (units are re-resolved on load). */
export type UnitSource =
  | { kind: "roster"; rosterId: string; unitId: string }
  | { kind: "archetype"; archetypeId: string }
  | { kind: "datasheet"; snapshotId: string; datasheetId: string }
  | { kind: "calculator"; side: "attacker" | "defender" };

export interface UnitEntry {
  /** Unique within the set (the same source may appear twice, e.g. two identical squads). */
  id: string;
  source: UnitSource;
  unit: ScenarioUnit;
  /** Short origin label shown on the chip (army name, "archetype", ...). */
  origin: string;
  /** Turn optimiser: stratagem option id ("auto" = optimiser chooses). */
  optionId?: string;
  /** Turn optimiser: target priority weight. */
  weight?: number;
}

/** Persisted form of an entry. */
export interface StoredUnitEntry {
  source: UnitSource;
  optionId?: string;
  weight?: number;
}

export function sourceKey(s: UnitSource): string {
  switch (s.kind) {
    case "roster":
      return `roster:${s.rosterId}:${s.unitId}`;
    case "archetype":
      return `archetype:${s.archetypeId}`;
    case "datasheet":
      return `datasheet:${s.snapshotId}:${s.datasheetId}`;
    case "calculator":
      return `calculator:${s.side}`;
  }
}

export function toStored(entries: UnitEntry[]): StoredUnitEntry[] {
  return entries.map((e) => ({ source: e.source, ...(e.optionId !== undefined ? { optionId: e.optionId } : {}), ...(e.weight !== undefined ? { weight: e.weight } : {}) }));
}

export function isStoredEntry(x: unknown): x is StoredUnitEntry {
  if (!x || typeof x !== "object") return false;
  const s = (x as { source?: unknown }).source;
  if (!s || typeof s !== "object") return false;
  const kind = (s as { kind?: unknown }).kind;
  return kind === "roster" || kind === "archetype" || kind === "datasheet" || kind === "calculator";
}

export function makeEntry(source: UnitSource, unit: ScenarioUnit, origin: string, extra: Pick<StoredUnitEntry, "optionId" | "weight"> = {}): UnitEntry {
  return { id: newId("us"), source, unit: cloneUnit(unit), origin, ...extra };
}

/** Roster units that are not attached to another unit; attached characters are folded into their host by `unitFromRosterUnit`. */
export function rosterHostEntries(roster: Roster, snapshot: Snapshot): UnitEntry[] {
  const out: UnitEntry[] = [];
  for (const u of roster.units) {
    if (u.attachedTo) continue;
    try {
      out.push(makeEntry({ kind: "roster", rosterId: roster.id, unitId: u.id }, unitFromRosterUnit(u, roster, snapshot), roster.name));
    } catch {
      // unknown datasheet in this snapshot: skip the unit
    }
  }
  return out;
}

export interface ResolveEnv {
  snapshot: Snapshot | undefined;
  scenario: Scenario;
  getRoster(id: string): Promise<Roster | undefined>;
  getSnapshot(id: string): Promise<Snapshot | undefined>;
}

/** Rebuild an entry from its persisted source; undefined when the source no longer exists. */
export async function resolveStored(stored: StoredUnitEntry, env: ResolveEnv, labels: { archetype: string; calculator: string }): Promise<UnitEntry | undefined> {
  const s = stored.source;
  const extra = { ...(stored.optionId !== undefined ? { optionId: stored.optionId } : {}), ...(stored.weight !== undefined ? { weight: stored.weight } : {}) };
  switch (s.kind) {
    case "archetype": {
      const a = archetypes.find((x) => x.id === s.archetypeId);
      return a ? makeEntry(s, a.unit, labels.archetype, extra) : undefined;
    }
    case "calculator": {
      const unit = env.scenario[s.side];
      if (!unit.models.length) return undefined;
      return makeEntry(s, unit, labels.calculator, extra);
    }
    case "datasheet": {
      const snap = env.snapshot?.id === s.snapshotId ? env.snapshot : await env.getSnapshot(s.snapshotId);
      const ds = snap?.data.datasheets.find((d) => d.id === s.datasheetId);
      if (!snap || !ds) return undefined;
      return makeEntry(s, unitFromDatasheet(ds, snap), snap.label ?? snap.id, extra);
    }
    case "roster": {
      const roster = await env.getRoster(s.rosterId);
      if (!roster) return undefined;
      const unit = roster.units.find((u) => u.id === s.unitId);
      if (!unit || unit.attachedTo) return undefined;
      const snap = (env.snapshot?.id === roster.snapshotId ? env.snapshot : await env.getSnapshot(roster.snapshotId)) ?? env.snapshot;
      if (!snap) return undefined;
      try {
        return makeEntry(s, unitFromRosterUnit(unit, roster, snap), roster.name, extra);
      } catch {
        return undefined;
      }
    }
  }
}

export function totalPoints(entries: UnitEntry[]): number | undefined {
  let sum = 0;
  let any = false;
  for (const e of entries) {
    if (e.unit.points === undefined) continue;
    any = true;
    sum += e.unit.points;
  }
  return any ? sum : undefined;
}

/** Archetypes that carry weapons (usable as attackers) / all archetypes (usable as targets). */
export function attackerArchetypes() {
  return archetypes.filter((a) => a.unit.weapons.some((w) => w.enabled && w.count > 0));
}

/** "Attacker: 10 × rapid-fire bolt rifles (A1 BS3+ …)" → "10 × rapid-fire bolt rifles" for compact chart labels. */
export function shortArchetypeName(name: string): string {
  const s = name
    .replace(/^attacker:\s*/i, "")
    .replace(/\s*\([^()]*\)\s*$/, "")
    .trim();
  return s || name;
}
