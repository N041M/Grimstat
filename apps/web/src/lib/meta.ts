/**
 * A list against the field: what the placing lists of its faction take, and how this one compares.
 *
 * Nothing here knows why a unit places. It counts. Which units the field takes, how many, how often;
 * which of those this list has and which it lacks; which placing lists it most resembles. The
 * reader draws the conclusions, with the numbers in front of them and every source a click away.
 *
 * Published lists are text. Each is resolved against the reader's own snapshot with the same
 * importer the Armies page uses for a pasted list, so a corpus gathered under one points update
 * still reads correctly under the next.
 */

import { importRosterText } from "@grimstat/adapters";
import { rosterSummary } from "@grimstat/resolver";
import type { Roster, Snapshot } from "@grimstat/schema";
import type { PublishedListRecord } from "../db";

export interface UnitTally {
  /** Copies of the datasheet in the list. */
  readonly units: number;
  readonly models: number;
  readonly points: number;
}

/** A published list resolved against a snapshot. */
export interface PeerList {
  readonly record: PublishedListRecord;
  readonly roster: Roster;
  readonly warnings: readonly string[];
  readonly points: number;
  /** By datasheet id. */
  readonly tally: ReadonlyMap<string, UnitTally>;
}

/** What a roster holds, by datasheet, with its points as the snapshot prices them. */
export function tallyOf(roster: Roster, snapshot: Snapshot): { tally: Map<string, UnitTally>; points: number } {
  const summary = rosterSummary(roster, snapshot);
  const costs = new Map(summary.units.map((u) => [u.id, u.cost] as const));
  const tally = new Map<string, UnitTally>();
  for (const u of roster.units) {
    const had = tally.get(u.datasheetId) ?? { units: 0, models: 0, points: 0 };
    const models = u.models.reduce((n, g) => n + g.count, 0);
    tally.set(u.datasheetId, { units: had.units + 1, models: had.models + models, points: had.points + (costs.get(u.id)?.total ?? 0) });
  }
  return { tally, points: summary.points };
}

/** Resolve one published list; undefined when its text is not a list this snapshot can read at all. */
export function resolvePublished(record: PublishedListRecord, snapshot: Snapshot): PeerList | undefined {
  try {
    const { roster, warnings } = importRosterText(record.listText, snapshot, { name: record.listName ?? record.heading });
    if (roster.units.length === 0) return undefined;
    const { tally, points } = tallyOf(roster, snapshot);
    return { record, roster, warnings, points, tally };
  } catch {
    return undefined;
  }
}

/* ---- resolving a whole corpus ---------------------------------------------------------------- */

/**
 * Resolved lists, kept by record so a tab reopened or a filter changed costs nothing. One snapshot's
 * results are kept at a time; switching snapshots starts over.
 */
const cache = { snapshotId: "", peers: new Map<string, PeerList | null>() };

export function resolvePublishedCached(record: PublishedListRecord, snapshot: Snapshot): PeerList | undefined {
  if (cache.snapshotId !== snapshot.id) {
    cache.snapshotId = snapshot.id;
    cache.peers.clear();
  }
  const hit = cache.peers.get(record.id);
  if (hit !== undefined) return hit ?? undefined;
  const peer = resolvePublished(record, snapshot);
  cache.peers.set(record.id, peer ?? null);
  return peer;
}

export interface ResolveFieldOptions {
  readonly onProgress?: (done: number, total: number) => void;
  readonly signal?: AbortSignal;
  /** How long to work before handing control back to the page, in milliseconds. */
  readonly sliceMs?: number;
}

/**
 * Every record the snapshot can read, resolved in slices with the page given control between them,
 * so a corpus of hundreds of lists does not freeze the tab. Records resolved before cost nothing.
 */
export async function resolveField(records: readonly PublishedListRecord[], snapshot: Snapshot, opts: ResolveFieldOptions = {}): Promise<PeerList[]> {
  const budget = opts.sliceMs ?? 25;
  const out: PeerList[] = [];
  let i = 0;
  while (i < records.length) {
    const start = performance.now();
    do {
      const peer = resolvePublishedCached(records[i]!, snapshot);
      if (peer) out.push(peer);
      i++;
    } while (i < records.length && performance.now() - start < budget);
    opts.onProgress?.(i, records.length);
    if (opts.signal?.aborted) throw new DOMException("Resolving cancelled", "AbortError");
    if (i < records.length) await new Promise<void>((r) => setTimeout(r, 0));
  }
  return out;
}

export type PlacingFilter = "all" | "top3" | "winners";
export type DetachmentFilter = "any" | "same";

export interface PeerFilter {
  readonly placing: PlacingFilter;
  readonly detachment: DetachmentFilter;
}

const placingOk = (placing: number | undefined, filter: PlacingFilter): boolean => filter === "all" || (placing !== undefined && placing <= (filter === "winners" ? 1 : 3));

/** The published lists this roster should be measured against: its own faction, as filtered. */
export function peersFor(all: readonly PeerList[], roster: Roster, filter: PeerFilter): PeerList[] {
  const mine = new Set(roster.detachments.map((d) => d.detachmentId));
  return all.filter((p) => p.roster.factionId === roster.factionId && placingOk(p.record.placing, filter.placing) && (filter.detachment === "any" || p.roster.detachments.some((d) => mine.has(d.detachmentId))));
}

/** How a unit in this list stands against the field. */
export type FieldNote = "missing" | "rare" | "more" | "fewer" | "match" | "none";

export interface FieldRow {
  readonly datasheetId: string;
  readonly name: string;
  readonly yours: number;
  readonly yourModels: number;
  /** Peer lists that take it at all. */
  readonly takenBy: number;
  /** `takenBy` over the number of peers. */
  readonly share: number;
  /** Averages over the lists that take it. */
  readonly typicalUnits: number;
  readonly typicalModels: number;
  readonly typicalPoints: number;
  readonly note: FieldNote;
}

/** Below this share of the field a unit the list takes is a rare pick; above `POPULAR` an absent one is missing. */
export const RARE = 0.15;
export const POPULAR = 0.5;
/** Fewer peers than this and "rare" says nothing: one list is not a field. */
const FIELD_FLOOR = 4;

/**
 * Every datasheet this list or the field takes, with what the field does with it.
 *
 * Rows the list lacks are kept only when a fair share of the field takes them, so the reader sees
 * what they are missing without every unit anyone ever took once.
 */
export function fieldRows(yours: ReadonlyMap<string, UnitTally>, peers: readonly PeerList[], snapshot: Snapshot, floor = 0.2): FieldRow[] {
  const names = new Map(snapshot.data.datasheets.map((d) => [d.id, d.name] as const));
  const ids = new Set<string>(yours.keys());
  for (const p of peers) for (const id of p.tally.keys()) ids.add(id);

  const rows: FieldRow[] = [];
  for (const id of ids) {
    const takers = peers.filter((p) => p.tally.has(id));
    const share = peers.length ? takers.length / peers.length : 0;
    const mine = yours.get(id);
    if (!mine && share < floor) continue;
    const avg = (pick: (t: UnitTally) => number) => (takers.length ? takers.reduce((s, p) => s + pick(p.tally.get(id)!), 0) / takers.length : 0);
    const typicalUnits = avg((t) => t.units);
    let note: FieldNote;
    if (!mine) note = share >= POPULAR ? "missing" : "none";
    else if (peers.length >= FIELD_FLOOR && share < RARE) note = "rare";
    else if (takers.length && mine.units > typicalUnits + 0.5) note = "more";
    else if (takers.length && mine.units < typicalUnits - 0.5) note = "fewer";
    else note = "match";
    rows.push({ datasheetId: id, name: names.get(id) ?? id, yours: mine?.units ?? 0, yourModels: mine?.models ?? 0, takenBy: takers.length, share, typicalUnits, typicalModels: avg((t) => t.models), typicalPoints: avg((t) => t.points), note });
  }
  return rows.sort((a, b) => b.share - a.share || b.yours - a.yours || a.name.localeCompare(b.name));
}

/**
 * How alike two lists are: the points they have in common, as a share of the larger list.
 *
 * Points rather than unit counts, so ten cheap squads and one tank weigh what they cost; the
 * smaller of the two spends on a shared datasheet, so a list with three of something is not
 * "more alike" a list with one of it than that list is to it.
 */
export function overlap(a: ReadonlyMap<string, UnitTally>, aPoints: number, b: ReadonlyMap<string, UnitTally>, bPoints: number): number {
  const larger = Math.max(aPoints, bPoints);
  if (larger <= 0) return 0;
  let shared = 0;
  for (const [id, ta] of a) {
    const tb = b.get(id);
    if (tb) shared += Math.min(ta.points, tb.points);
  }
  return shared / larger;
}

export interface Neighbour {
  readonly peer: PeerList;
  readonly overlap: number;
}

/** The peers this list most resembles, best first. */
export function closest(yours: ReadonlyMap<string, UnitTally>, yourPoints: number, peers: readonly PeerList[], n = 5): Neighbour[] {
  return peers
    .map((peer) => ({ peer, overlap: overlap(yours, yourPoints, peer.tally, peer.points) }))
    .sort((a, b) => b.overlap - a.overlap || (a.peer.record.placing ?? 99) - (b.peer.record.placing ?? 99))
    .slice(0, n);
}

export interface SideBySideRow {
  readonly datasheetId: string;
  readonly name: string;
  readonly yours?: UnitTally;
  readonly theirs?: UnitTally;
}

/** Two lists unit by unit: what both take first, then what only this one takes, then only theirs. */
export function sideBySide(yours: ReadonlyMap<string, UnitTally>, theirs: ReadonlyMap<string, UnitTally>, snapshot: Snapshot): SideBySideRow[] {
  const names = new Map(snapshot.data.datasheets.map((d) => [d.id, d.name] as const));
  const ids = new Set<string>([...yours.keys(), ...theirs.keys()]);
  const rank = (r: SideBySideRow) => (r.yours && r.theirs ? 0 : r.yours ? 1 : 2);
  return [...ids]
    .map((id) => ({ datasheetId: id, name: names.get(id) ?? id, ...(yours.has(id) ? { yours: yours.get(id)! } : {}), ...(theirs.has(id) ? { theirs: theirs.get(id)! } : {}) }))
    .sort((a, b) => rank(a) - rank(b) || (b.yours?.points ?? b.theirs?.points ?? 0) - (a.yours?.points ?? a.theirs?.points ?? 0) || a.name.localeCompare(b.name));
}

export interface FieldCount {
  readonly name: string;
  readonly lists: number;
  readonly share: number;
}

/** Which detachments the field runs, most common first. Named as the snapshot names them. */
export function detachmentField(peers: readonly PeerList[], snapshot: Snapshot): FieldCount[] {
  const names = new Map(snapshot.data.detachments.map((d) => [d.id, d.name] as const));
  const counts = new Map<string, number>();
  for (const p of peers) {
    const taken = new Set(p.roster.detachments.map((d) => names.get(d.detachmentId) ?? d.detachmentId));
    if (taken.size === 0) for (const d of p.record.detachments) taken.add(d);
    for (const name of taken) counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return field(counts, peers.length);
}

/** Which Force Dispositions the field declared, most common first. */
export function dispositionField(peers: readonly PeerList[]): FieldCount[] {
  const counts = new Map<string, number>();
  for (const p of peers) {
    const name = p.record.forceDisposition ?? p.roster.detachments.find((d) => d.forceDisposition)?.forceDisposition;
    if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return field(counts, peers.length);
}

const field = (counts: ReadonlyMap<string, number>, total: number): FieldCount[] => [...counts.entries()].map(([name, lists]) => ({ name, lists, share: total ? lists / total : 0 })).sort((a, b) => b.lists - a.lists || a.name.localeCompare(b.name));
