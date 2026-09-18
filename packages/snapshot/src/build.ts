import { Snapshot, SnapshotData, type Conflict, type MissingSource, type SourceRef } from "@grimstat/schema";
import { canonicalJson, sha256Hex } from "./checksum";

export interface BuildSnapshotInput {
  data: SnapshotData;
  sources?: SourceRef[];
  label?: string;
  conflicts?: Conflict[];
  /** Sources the run asked for and did not get, so the snapshot can say what it is missing. */
  missingSources?: MissingSource[];
  /** Timestamp used for createdAt/updatedAt and the id's date part (default: now). */
  now?: Date | string;
  ownerId?: string;
}

/** Code-unit comparison. The host locale must not reach the checksum, so `localeCompare` is never used here. */
function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function byId<T extends { id: string }>(a: T, b: T): number {
  return cmp(a.id, b.id);
}

/** Sorts after every real value, standing in for an open-ended `copyRange.max`. */
const OPEN_ENDED = Number.MAX_SAFE_INTEGER;

/**
 * Deterministic ordering of every collection so that the same data always yields the same checksum
 * regardless of the order adapters emitted it. Every comparator is a strict total order over the fields
 * that distinguish two records, so equal keys can never let the input order decide the result. Nested
 * arrays (models, weapons, keywords...) keep their upstream order because it carries meaning (e.g. the
 * first model profile is the default one).
 */
export function normaliseData(data: SnapshotData): SnapshotData {
  const parsed = SnapshotData.parse(data);
  // An empty glossary is dropped rather than written as an empty array, so that a snapshot built
  // before any source supplied one keeps the checksum it was written with.
  const glossary = parsed.glossary?.length ? [...parsed.glossary].sort(byId) : undefined;
  const out: SnapshotData = {
    ...parsed,
    factions: [...parsed.factions].sort(byId),
    publications: [...parsed.publications].sort(byId),
    datasheets: [...parsed.datasheets].sort(byId),
    abilities: [...parsed.abilities].sort(byId),
    detachments: [...parsed.detachments].sort(byId),
    enhancements: [...parsed.enhancements].sort(byId),
    stratagems: [...parsed.stratagems].sort(byId),
    priceRules: [...parsed.priceRules].sort((a, b) => cmp(a.datasheetId, b.datasheetId) || a.copyRange.min - b.copyRange.min || (a.copyRange.max ?? OPEN_ENDED) - (b.copyRange.max ?? OPEN_ENDED) || cmp(a.label ?? "", b.label ?? "")),
    wargearPrices: [...parsed.wargearPrices].sort((a, b) => cmp(a.datasheetId, b.datasheetId) || cmp(a.item, b.item) || a.points - b.points),
  };
  if (glossary) out.glossary = glossary;
  else delete out.glossary;
  return out;
}

/**
 * The id a snapshot with this checksum has, on every device.
 *
 * The id is a prefix of the checksum and nothing else. It used to carry the build date as well,
 * which meant two devices building the same sources on different days held the same data under
 * two ids, and a roster pinned to one could not find the other. The build date is `createdAt`.
 * Twelve hex digits are 48 bits, enough that two different snapshots on one device never share
 * an id by accident.
 */
export function stableSnapshotId(checksum: string): string {
  return `snap_${checksum.slice(0, 12)}`;
}

/** Whether an id is one this function gives, as opposed to a dated one from an earlier build. */
export const isStableSnapshotId = (id: string): boolean => /^snap_[0-9a-f]{12}$/.test(id);

/**
 * Build an immutable, checksummed snapshot. The checksum is SHA-256 of the canonical JSON of
 * `data` (sorted keys, sorted collections), and the id is `stableSnapshotId` of it.
 */
export async function buildSnapshot(input: BuildSnapshotInput): Promise<Snapshot> {
  const data = normaliseData(input.data);
  const checksum = await sha256Hex(canonicalJson(data));
  const now = input.now === undefined ? new Date() : typeof input.now === "string" ? new Date(input.now) : input.now;
  const iso = now.toISOString();
  const snapshot = {
    id: stableSnapshotId(checksum),
    gameSystemId: data.gameSystem.id,
    label: input.label,
    sources: input.sources ?? [],
    checksum,
    conflicts: input.conflicts ?? [],
    data,
    ownerId: input.ownerId ?? "local",
    createdAt: iso,
    updatedAt: iso,
    revision: 0,
  };
  if (snapshot.label === undefined) delete (snapshot as { label?: string }).label;
  // Only when there is something to record, so a run that got everything it asked for writes the
  // same snapshot it always did.
  if (input.missingSources?.length) (snapshot as { missingSources?: MissingSource[] }).missingSources = input.missingSources;
  return Snapshot.parse(snapshot);
}

/** Recompute a snapshot's checksum and compare. */
export async function verifySnapshot(snapshot: Snapshot): Promise<{ ok: boolean; expected: string; actual: string }> {
  const actual = await sha256Hex(canonicalJson(normaliseData(snapshot.data)));
  return { ok: actual === snapshot.checksum, expected: snapshot.checksum, actual };
}
