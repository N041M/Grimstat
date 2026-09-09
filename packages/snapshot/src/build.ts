import { Snapshot, SnapshotData, type Conflict, type SourceRef } from "@grimstat/schema";
import { canonicalJson, sha256Hex } from "./checksum";

export interface BuildSnapshotInput {
  data: SnapshotData;
  sources?: SourceRef[];
  label?: string;
  conflicts?: Conflict[];
  /** Timestamp used for createdAt/updatedAt and the id's date part (default: now). */
  now?: Date | string;
  ownerId?: string;
}

function byId<T extends { id: string }>(a: T, b: T): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Deterministic ordering of every collection so that the same data always yields the same checksum
 * regardless of the order adapters emitted it. Nested arrays (models, weapons, keywords...) keep their
 * upstream order because it carries meaning (e.g. the first model profile is the default one).
 */
export function normaliseData(data: SnapshotData): SnapshotData {
  const parsed = SnapshotData.parse(data);
  return {
    ...parsed,
    factions: [...parsed.factions].sort(byId),
    publications: [...parsed.publications].sort(byId),
    datasheets: [...parsed.datasheets].sort(byId),
    abilities: [...parsed.abilities].sort(byId),
    detachments: [...parsed.detachments].sort(byId),
    enhancements: [...parsed.enhancements].sort(byId),
    stratagems: [...parsed.stratagems].sort(byId),
    priceRules: [...parsed.priceRules].sort((a, b) => a.datasheetId.localeCompare(b.datasheetId) || a.copyRange.min - b.copyRange.min),
    wargearPrices: [...parsed.wargearPrices].sort((a, b) => a.datasheetId.localeCompare(b.datasheetId) || a.item.localeCompare(b.item)),
  };
}

function yyyymmdd(d: Date): string {
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}

/**
 * Build an immutable, checksummed snapshot. The id is `snap_<yyyymmdd>_<first 8 hex of the checksum>`;
 * the checksum is SHA-256 of the canonical JSON of `data` (sorted keys, sorted collections).
 */
export async function buildSnapshot(input: BuildSnapshotInput): Promise<Snapshot> {
  const data = normaliseData(input.data);
  const checksum = await sha256Hex(canonicalJson(data));
  const now = input.now === undefined ? new Date() : typeof input.now === "string" ? new Date(input.now) : input.now;
  const iso = now.toISOString();
  const snapshot = {
    id: `snap_${yyyymmdd(now)}_${checksum.slice(0, 8)}`,
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
  return Snapshot.parse(snapshot);
}

/** Recompute a snapshot's checksum and compare. */
export async function verifySnapshot(snapshot: Snapshot): Promise<{ ok: boolean; expected: string; actual: string }> {
  const actual = await sha256Hex(canonicalJson(normaliseData(snapshot.data)));
  return { ok: actual === snapshot.checksum, expected: snapshot.checksum, actual };
}
