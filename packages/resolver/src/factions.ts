import type { Datasheet, Roster, Snapshot } from "@grimstat/schema";

/**
 * Which faction a datasheet belongs to, as the army rules read it.
 *
 * A datasheet carries the id of the book that prints it. A roster carries the id of the faction it
 * was built as. The two ids do not answer the question the rules ask. A Blood Angels army takes its
 * units from the Blood Angels book and the Space Marines book, and every one of them is an
 * ADEPTUS ASTARTES unit. The rules go by the Faction keyword, so this module does too.
 *
 * A faction is known by the Faction keywords that most of its datasheets carry. The Space Marines
 * book prints ADEPTUS ASTARTES on every sheet and a Chapter name on a few named characters, so the
 * faction is known by ADEPTUS ASTARTES alone. The Blood Angels book prints ADEPTUS ASTARTES and
 * BLOOD ANGELS on every sheet, so a Blood Angels army is known by both, and a plain Space Marines
 * sheet is its own.
 */

/** A keyword counts as the faction's when at least this share of its datasheets carry it. */
const CORE_SHARE = 0.5;

interface FactionIndex {
  cores: Map<string, ReadonlySet<string>>;
  hosts: Map<string, Datasheet | undefined>;
  priced: Set<string>;
  abilities: Map<string, string>;
}

const INDEXES = new WeakMap<Snapshot, FactionIndex>();

function indexOf(snapshot: Snapshot): FactionIndex {
  const cached = INDEXES.get(snapshot);
  if (cached) return cached;
  const index: FactionIndex = {
    cores: new Map(),
    hosts: new Map(),
    priced: new Set(snapshot.data.priceRules.map((r) => r.datasheetId)),
    abilities: new Map(snapshot.data.abilities.map((a) => [a.id, a.text] as const)),
  };
  INDEXES.set(snapshot, index);
  return index;
}

const clean = (k: string): string => k.trim().toUpperCase();

/** The Faction keywords a faction is known by: those on at least half of its datasheets. */
export function factionKeywordsOf(snapshot: Snapshot, factionId: string): ReadonlySet<string> {
  const index = indexOf(snapshot);
  const cached = index.cores.get(factionId);
  if (cached) return cached;
  const counts = new Map<string, number>();
  let sheets = 0;
  for (const ds of snapshot.data.datasheets) {
    if (ds.factionId !== factionId) continue;
    sheets++;
    for (const k of new Set(ds.factionKeywords.map(clean))) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const core = new Set<string>();
  for (const [k, n] of counts) if (n >= sheets * CORE_SHARE) core.add(k);
  index.cores.set(factionId, core);
  return core;
}

/** Whether a datasheet is the army's own rather than an ally's. */
export function isOwnFaction(ds: Datasheet, roster: Pick<Roster, "factionId">, snapshot: Snapshot): boolean {
  if (ds.factionId === roster.factionId) return true;
  const core = factionKeywordsOf(snapshot, roster.factionId);
  return ds.factionKeywords.some((k) => core.has(clean(k)));
}

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The datasheet whose unit this datasheet's model comes with, when it comes with one.
 *
 * Sir Hekhtur has a datasheet of his own and no points. He is part of the Canis Rex unit, and his
 * rules say so by naming it: "If your Canis Rex model is destroyed". That is the test. A datasheet
 * with no price whose abilities speak of "your <unit>", where the unit is another datasheet of the
 * same faction, comes with that unit.
 */
export function companionHostOf(snapshot: Snapshot, ds: Datasheet): Datasheet | undefined {
  const index = indexOf(snapshot);
  if (index.hosts.has(ds.id)) return index.hosts.get(ds.id);
  let host: Datasheet | undefined;
  if (!index.priced.has(ds.id) && ds.fallbackPoints === undefined) {
    const text = ds.abilityIds.map((id) => index.abilities.get(id) ?? "").join("\n");
    if (/\byour\b/i.test(text)) {
      for (const other of snapshot.data.datasheets) {
        if (other.id === ds.id || other.factionId !== ds.factionId) continue;
        if (!new RegExp(`\\byour ${escape(other.name)}\\b`, "i").test(text)) continue;
        if (!host || other.name.length > host.name.length) host = other;
      }
    }
  }
  index.hosts.set(ds.id, host);
  return host;
}

/** The datasheets whose models come with this datasheet's unit. */
export function companionsOf(snapshot: Snapshot, ds: Datasheet): Datasheet[] {
  return snapshot.data.datasheets.filter((other) => other.factionId === ds.factionId && other.id !== ds.id && companionHostOf(snapshot, other)?.id === ds.id);
}
