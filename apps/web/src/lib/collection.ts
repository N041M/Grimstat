/**
 * The player's collection: the models they actually own, and what can be fielded from them.
 *
 * A collection is counted per datasheet, because that is the question the shelf answers — "how many
 * of these have I got?" — and because it is the question an army asks back. Nothing here knows about
 * loadouts, because two squads built with different weapons are the same ten models as far as owning them
 * goes, and pretending otherwise would make the count a fiction nobody could keep up to date.
 *
 * Pure functions over plain records, so the arithmetic of "can I field this list?" is testable
 * without a database or a snapshot.
 */

import type { Datasheet, Roster } from "@grimstat/schema";
import type { CollectionEntryRecord } from "../db";

/** What an army asks of a collection: models of one datasheet, and the units that want them. */
export interface Need {
  readonly datasheetId: string;
  readonly name: string;
  /** Models of this datasheet the army fields in total, across every unit of it. */
  readonly models: number;
  /** How many separate units ask for them, since two squads of ten need twenty models. */
  readonly units: number;
}

/** One line of a coverage check: what an army needs of a datasheet against what is owned. */
export interface Shortfall extends Need {
  readonly owned: number;
  readonly short: number;
}

export interface Coverage {
  /** Every datasheet the army asks for, in army order. */
  readonly needs: readonly Shortfall[];
  /** Only the lines the collection cannot cover. */
  readonly missing: readonly Shortfall[];
  /** Models the army asks for, and how many of them are owned. */
  readonly models: number;
  readonly owned: number;
  readonly ok: boolean;
}

export interface Totals {
  readonly datasheets: number;
  readonly models: number;
  readonly painted: number;
  readonly factions: number;
  /** Painted as a fraction of what is owned; zero for an empty collection rather than NaN. */
  readonly paintedFraction: number;
}

/** A number a count field may hold: whole, not negative, and not something that is not a number. */
export const asCount = (n: number): number => (Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0);

/**
 * What a count field commits when the user leaves it.
 *
 * An empty field is a count halfway through being retyped, so it keeps the count that was already
 * there. Reading it as zero would write zero over the painted count the moment somebody cleared
 * "10" to type "12". Anything that does not read as a number is treated the same way.
 */
export function commitCount(text: string, current: number, max = Infinity): number {
  const n = Number(text);
  return text.trim() === "" || !Number.isFinite(n) ? current : Math.min(max, asCount(n));
}

/** An entry with its counts made sane: whole numbers, and never more painted than owned. */
export function tidyEntry<T extends { owned: number; painted: number }>(entry: T): T {
  const owned = asCount(entry.owned);
  return { ...entry, owned, painted: Math.min(owned, asCount(entry.painted)) };
}

export function collectionTotals(entries: readonly CollectionEntryRecord[]): Totals {
  let models = 0;
  let painted = 0;
  const factions = new Set<string>();
  for (const e of entries) {
    models += asCount(e.owned);
    painted += Math.min(asCount(e.owned), asCount(e.painted));
    factions.add(e.factionId);
  }
  return { datasheets: entries.length, models, painted, factions: factions.size, paintedFraction: models > 0 ? painted / models : 0 };
}

/** The models an army asks for, one line per datasheet, in the order the army lists them. */
export function rosterNeeds(roster: Roster, nameOf: (datasheetId: string) => string | undefined): Need[] {
  const order: string[] = [];
  const byId = new Map<string, { models: number; units: number }>();
  for (const unit of roster.units) {
    const models = unit.models.reduce((n, g) => n + g.count, 0);
    const had = byId.get(unit.datasheetId);
    if (had) {
      had.models += models;
      had.units += 1;
      continue;
    }
    order.push(unit.datasheetId);
    byId.set(unit.datasheetId, { models, units: 1 });
  }
  return order.map((id) => {
    const n = byId.get(id)!;
    return { datasheetId: id, name: nameOf(id) ?? id, models: n.models, units: n.units };
  });
}

/**
 * What the collection can and cannot field of an army.
 *
 * A datasheet the collection has never heard of counts as none owned rather than being left out:
 * "you have none of these" is the answer the question wants, and an army of unknown datasheets
 * should not read as fully covered.
 */
export function coverage(entries: readonly CollectionEntryRecord[], needs: readonly Need[]): Coverage {
  const owned = new Map(entries.map((e) => [e.id, asCount(e.owned)] as const));
  const lines = needs.map((need) => {
    const have = owned.get(need.datasheetId) ?? 0;
    return { ...need, owned: have, short: Math.max(0, need.models - have) };
  });
  const models = lines.reduce((n, l) => n + l.models, 0);
  return {
    needs: lines,
    missing: lines.filter((l) => l.short > 0),
    models,
    owned: lines.reduce((n, l) => n + Math.min(l.models, l.owned), 0),
    ok: lines.every((l) => l.short === 0),
  };
}

/**
 * Could this collection actually put the army on a table?
 *
 * An army with nothing in it is covered by any collection — there is nothing to cover — but it is
 * not an army anybody can field, so it is not counted as one.
 */
export const canField = (cover: Coverage): boolean => cover.models > 0 && cover.ok;

/** An entry for a datasheet, with the models a box of it comes with as the opening count. */
export function entryFor(datasheet: Datasheet, factionName: string, owned: number, now: string): CollectionEntryRecord {
  return tidyEntry({ id: datasheet.id, name: datasheet.name, factionId: datasheet.factionId, factionName, owned, painted: 0, updatedAt: now });
}

/**
 * Add models to the collection, keeping what is already recorded.
 *
 * Adding the same datasheet twice is buying a second box rather than correcting the first, so the
 * counts add up. Everything else about the entry is refreshed from the datasheet, so a renamed sheet stops
 * reading under its old name.
 */
export function addModels(had: CollectionEntryRecord | undefined, datasheet: Datasheet, factionName: string, models: number, now: string): CollectionEntryRecord {
  const fresh = entryFor(datasheet, factionName, models, now);
  if (!had) return fresh;
  return tidyEntry({ ...fresh, owned: asCount(had.owned) + asCount(models), painted: had.painted });
}

/** Entries grouped by faction, factions and datasheets alike in name order. */
export function byFaction(entries: readonly CollectionEntryRecord[]): { factionId: string; factionName: string; entries: CollectionEntryRecord[] }[] {
  const groups = new Map<string, { factionId: string; factionName: string; entries: CollectionEntryRecord[] }>();
  for (const e of entries) {
    const group = groups.get(e.factionId) ?? { factionId: e.factionId, factionName: e.factionName, entries: [] };
    group.entries.push(e);
    groups.set(e.factionId, group);
  }
  const out = [...groups.values()];
  for (const g of out) g.entries.sort((a, b) => a.name.localeCompare(b.name));
  return out.sort((a, b) => a.factionName.localeCompare(b.factionName));
}
