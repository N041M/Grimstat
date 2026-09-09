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
