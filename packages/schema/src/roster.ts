import { z } from "zod";
import { Id, RecordMeta } from "./common";

export const BattleSize = z.enum(["incursion", "strike-force", "onslaught", "combat-patrol", "custom"]);
export type BattleSize = z.infer<typeof BattleSize>;

export const RosterModelGroup = z.object({
  modelProfileId: Id,
  count: z.number().int().positive(),
  /** Selected wargear item names (weapon profile names / wargear names). */
  wargear: z.array(z.string()).default([]),
});
export type RosterModelGroup = z.infer<typeof RosterModelGroup>;

export const RosterUnit = z.object({
  id: Id,
  datasheetId: Id,
  detachmentId: Id.optional(),
  customName: z.string().optional(),
  models: z.array(RosterModelGroup).min(1),
  /** If this unit is a character attached to another unit. */
  attachedTo: z.object({ unitId: Id, role: z.enum(["leader", "support"]) }).optional(),
  /** Id of the TRANSPORT roster unit this unit starts the battle embarked in. */
  embarkedIn: Id.optional(),
  /** Starts the battle in Reserves (Strategic Reserves, Deep Strike, etc.). */
  inReserves: z.boolean().optional(),
  enhancementId: Id.optional(),
  isWarlord: z.boolean().default(false),
  notes: z.string().optional(),
});
export type RosterUnit = z.infer<typeof RosterUnit>;

export const RosterDetachment = z.object({
  id: Id,
  detachmentId: Id,
  forceDisposition: z.string().optional(),
});
export type RosterDetachment = z.infer<typeof RosterDetachment>;

export const Roster = RecordMeta.extend({
  id: Id,
  name: z.string(),
  gameSystemId: Id,
  snapshotId: Id,
  factionId: Id,
  battleSize: BattleSize.default("strike-force"),
  pointsLimit: z.number().int().positive().default(2000),
  detachments: z.array(RosterDetachment).default([]),
  units: z.array(RosterUnit).default([]),
  notes: z.string().optional(),
  /** Previous revision id for version history. */
  parentRevisionId: Id.optional(),
});
export type Roster = z.infer<typeof Roster>;
