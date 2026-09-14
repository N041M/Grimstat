/**
 * The army, worked out from the units that were recognised.
 *
 * Nothing here reads a title or a panel. A slide writes its faction across the top, an overlay writes
 * it down the side, a photograph of a printed list may not write it at all, and all three name their
 * units. Every datasheet carries the faction it belongs to, so the units say which army this is, and
 * the title is left to agree or not.
 *
 * The vote also improves the matching that produced it. Many factions have a Captain, and a first
 * pass cannot tell those apart. The units that matched unambiguously supply a preference and the
 * second pass breaks the ties toward it. Two passes, because a third would only chase the second.
 */

import type { Roster, Snapshot } from "@grimstat/schema";
import { POINTS_BY_SIZE } from "../roster/import-common";
import type { Span } from "./anchors";
import { anchor } from "./anchors";
import type { ScanIndex } from "./names";
import { scanIndexOf } from "./names";
import type { Token } from "./tokens";

export interface FactionVote {
  readonly factionId: string;
  readonly name: string;
  /** Units of this faction the list holds. */
  readonly units: number;
}

export interface ArmyGuess {
  /** The faction most of the units belong to, or nothing when the vote was too close to call. */
  readonly factionId: string | undefined;
  readonly votes: readonly FactionVote[];
  /** True when the leading factions are close enough that the reader has to say. */
  readonly tied: boolean;
  readonly detachmentIds: readonly string[];
  readonly forceDisposition: string | undefined;
}

/**
 * A vote this close is not a vote.
 *
 * A roster holds one faction and every unit outside it is warned about, so the faction to pick is
 * the one that leaves fewest units warned about. One unit in it is not enough of a lead to act on,
 * and a list of three units split two and one is exactly the case worth asking about.
 */
const LEAD = 2;

export interface FactionResult {
  readonly votes: readonly FactionVote[];
  /** The winner, or nothing when the lead was too slim to act on. */
  readonly factionId: string | undefined;
  readonly tied: boolean;
}

/** Which faction the units belong to, and by how much. */
export function voteFaction(snapshot: Snapshot, spans: readonly Span[]): FactionResult {
  const sheets = new Map(snapshot.data.datasheets.map((d) => [d.id, d] as const));
  const names = new Map(snapshot.data.factions.map((f) => [f.id, f.name] as const));
  const tally = new Map<string, number>();
  for (const span of spans) {
    if (span.entry.kind !== "datasheet") continue;
    const ds = sheets.get(span.entry.ids[0] ?? "");
    if (!ds) continue;
    tally.set(ds.factionId, (tally.get(ds.factionId) ?? 0) + 1);
  }
  const votes = [...tally]
    .map(([factionId, units]) => ({ factionId, name: names.get(factionId) ?? factionId, units }))
    .sort((a, b) => b.units - a.units || a.name.localeCompare(b.name));

  const first = votes[0];
  const second = votes[1];
  if (!first) return { votes, factionId: undefined, tied: false };
  const tied = !!second && first.units - second.units < LEAD;
  return { votes, factionId: tied ? undefined : first.factionId, tied };
}

/**
 * The detachments the list took.
 *
 * An enhancement names its detachment outright, which is the strongest evidence available and does
 * not need the detachment's own name to have been legible. A detachment name that anchored is next.
 * A force disposition narrows to the detachments that offer it, and is used on its own only when
 * nothing better was found, since several detachments share a disposition.
 */
export function detachmentsFrom(snapshot: Snapshot, spans: readonly Span[], factionId: string | undefined): { detachmentIds: string[]; forceDisposition: string | undefined } {
  const enhancements = new Map(snapshot.data.enhancements.map((e) => [e.id, e] as const));
  const detachments = new Map(snapshot.data.detachments.map((d) => [d.id, d] as const));
  const inFaction = (id: string): boolean => !factionId || detachments.get(id)?.factionId === factionId;

  const named: string[] = [];
  const fromDisposition: string[] = [];
  let forceDisposition: string | undefined;
  for (const span of spans) {
    if (span.entry.kind === "enhancement") {
      for (const id of span.entry.ids) {
        const det = enhancements.get(id)?.detachmentId;
        if (det && inFaction(det) && !named.includes(det)) named.push(det);
      }
    }
    if (span.entry.kind === "detachment") {
      for (const id of span.entry.ids) if (inFaction(id) && !named.includes(id)) named.push(id);
    }
    if (span.entry.kind === "disposition") {
      forceDisposition ??= span.entry.name;
      for (const id of span.entry.ids) if (inFaction(id) && !fromDisposition.includes(id)) fromDisposition.push(id);
    }
  }
  return { detachmentIds: named.length ? named : fromDisposition, forceDisposition };
}

/** Every id in a faction, for nudging the second pass toward it. */
export function idsInFaction(snapshot: Snapshot, factionId: string | undefined): Set<string> {
  const out = new Set<string>();
  if (!factionId) return out;
  for (const d of snapshot.data.datasheets) if (d.factionId === factionId) out.add(d.id);
  const dets = new Set<string>();
  for (const d of snapshot.data.detachments) {
    if (d.factionId !== factionId) continue;
    out.add(d.id);
    dets.add(d.id);
  }
  for (const e of snapshot.data.enhancements) if (dets.has(e.detachmentId)) out.add(e.id);
  return out;
}

/** The smallest standard battle size a total fits inside, with the limit that goes with it. */
export function sizeFor(points: number): { battleSize: Roster["battleSize"]; pointsLimit: number } {
  const order: Roster["battleSize"][] = ["combat-patrol", "incursion", "strike-force", "onslaught"];
  for (const battleSize of order) {
    const pointsLimit = POINTS_BY_SIZE[battleSize];
    if (points <= pointsLimit) return { battleSize, pointsLimit };
  }
  return { battleSize: "onslaught", pointsLimit: POINTS_BY_SIZE.onslaught };
}

export interface ReadArmy {
  readonly spans: readonly Span[];
  readonly army: ArmyGuess;
  readonly index: ScanIndex;
}

/** The names in a stream and the army they describe, after the vote has been fed back into matching. */
export function readArmy(snapshot: Snapshot, tokens: readonly Token[]): ReadArmy {
  const index = scanIndexOf(snapshot);
  const first = anchor(tokens, index);
  const vote = voteFaction(snapshot, first);

  const spans = vote.factionId ? anchor(tokens, index, { preferIds: idsInFaction(snapshot, vote.factionId) }) : first;
  // The second pass can move units between factions, so the vote is taken again on what it produced.
  const settled = vote.factionId ? voteFaction(snapshot, spans) : vote;
  const { detachmentIds, forceDisposition } = detachmentsFrom(snapshot, spans, settled.factionId);

  return { spans, index, army: { factionId: settled.factionId, votes: settled.votes, tied: settled.tied, detachmentIds, forceDisposition } };
}
