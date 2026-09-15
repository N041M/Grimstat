import { z } from "zod";
import { Id, RecordMeta } from "./common";
import { Ability, Datasheet, Detachment, Enhancement, Faction, GameSystem, Publication, Stratagem } from "./gamedata";
import { PriceRule, WargearPrice } from "./pricing";

/** Where a piece of the snapshot came from. Pin exact refs (git SHA, MFM version, Wahapedia last_update). */
export const SourceRef = z.object({
  adapter: z.string(), // e.g. "mfm-yaml", "bsdata-json", "wahapedia-csv"
  url: z.string().optional(),
  ref: z.string().optional(),
  fetchedAt: z.string().datetime(),
  notes: z.string().optional(),
});
export type SourceRef = z.infer<typeof SourceRef>;

/**
 * A source a run asked for and did not get. Kept on the snapshot so that what is missing from it can
 * be said later, on any screen, rather than only in the panel that ran the fetch.
 */
export const MissingSource = z.object({
  adapter: z.string(),
  url: z.string().optional(),
  /** What the fetch failed with, e.g. "GET https://.../Factions.csv -> HTTP 404". */
  reason: z.string(),
});
export type MissingSource = z.infer<typeof MissingSource>;

export const Conflict = z.object({
  entity: z.string(),
  id: Id,
  field: z.string(),
  chosen: z.string(),
  candidates: z.array(z.object({ adapter: z.string(), value: z.string() })),
});
export type Conflict = z.infer<typeof Conflict>;

export const SnapshotData = z.object({
  gameSystem: GameSystem,
  factions: z.array(Faction).default([]),
  publications: z.array(Publication).default([]),
  datasheets: z.array(Datasheet).default([]),
  abilities: z.array(Ability).default([]),
  detachments: z.array(Detachment).default([]),
  enhancements: z.array(Enhancement).default([]),
  stratagems: z.array(Stratagem).default([]),
  priceRules: z.array(PriceRule).default([]),
  wargearPrices: z.array(WargearPrice).default([]),
});
export type SnapshotData = z.infer<typeof SnapshotData>;

export const Snapshot = RecordMeta.extend({
  id: Id,
  gameSystemId: Id,
  label: z.string().optional(),
  sources: z.array(SourceRef).default([]),
  /** SHA-256 of canonical JSON of `data`. */
  checksum: z.string(),
  conflicts: z.array(Conflict).default([]),
  /** Sources that did not answer the run that built this. Absent when the run got everything it asked for. */
  missingSources: z.array(MissingSource).optional(),
  data: SnapshotData,
});
export type Snapshot = z.infer<typeof Snapshot>;

/** Hand-authored fix-ups applied on top of imported data, keyed by entity + id. Survives re-imports. */
export const Override = z.object({
  entity: z.enum(["datasheet", "ability", "detachment", "enhancement", "stratagem", "priceRule", "faction"]),
  id: Id,
  /** JSON merge patch (RFC 7396) applied to the entity. */
  patch: z.record(z.unknown()),
  note: z.string().optional(),
});
export type Override = z.infer<typeof Override>;
