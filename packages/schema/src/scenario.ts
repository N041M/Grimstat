import { z } from "zod";
import { DiceExpr, Id, RecordMeta } from "./common";
import { ModelProfile, WeaponKeyword, WeaponProfile } from "./gamedata";
import { EffectRecord } from "./effects";

/** Defender allocation policy under 11e fast rolling (defender assigns save results in roll order). */
export const AllocationPolicy = z.enum([
  "in-order", // allocate to models in the given order (bodyguards first, character last)
  "protect-character", // same as in-order but never allocate to a character while a non-character is alive (default)
  "spread", // maximise survivors: put damage on already-wounded models first (used for multi-damage inefficiency)
]);
export type AllocationPolicy = z.infer<typeof AllocationPolicy>;

/** Attacker's choice for optional Lethal Hits. */
export const LethalChoice = z.enum(["auto", "always", "never"]);

/** A model line in an ad-hoc or resolved unit: wounds, defensive stats and count. */
export const ScenarioModel = z.object({
  name: z.string().default("Model"),
  count: z.number().int().positive().default(1),
  T: z.number(),
  Sv: z.number(),
  InvSv: z.number().nullable().optional(),
  W: z.number().int().positive(),
  fnp: z.number().nullable().optional(),
  isCharacter: z.boolean().default(false),
  keywords: z.array(z.string()).default([]),
});
export type ScenarioModel = z.infer<typeof ScenarioModel>;

/** A weapon line in an ad-hoc or resolved unit. `count` = number of these weapons firing. */
export const ScenarioWeapon = z.object({
  name: z.string().default("Weapon"),
  count: z.number().int().nonnegative().default(1),
  kind: z.enum(["ranged", "melee"]).default("ranged"),
  range: z.number().nullable().optional(),
  A: DiceExpr,
  skill: z.number().nullable(),
  S: z.number(),
  AP: z.number(),
  D: DiceExpr,
  keywords: z.array(WeaponKeyword).default([]),
  /** Per-weapon toggles the user enabled (e.g. supercharge). */
  enabled: z.boolean().default(true),
});
export type ScenarioWeapon = z.infer<typeof ScenarioWeapon>;

/** Either an inline (ad-hoc / archetype) unit or a reference into a snapshot. Inline is always populated after resolution. */
export const ScenarioUnit = z.object({
  name: z.string(),
  ref: z.object({ snapshotId: Id, datasheetId: Id, attachedDatasheetIds: z.array(Id).default([]) }).optional(),
  keywords: z.array(z.string()).default([]),
  models: z.array(ScenarioModel).default([]),
  weapons: z.array(ScenarioWeapon).default([]),
  /** Effect records contributed by the unit's own abilities, leaders, enhancements, etc. (after resolution). */
  effects: z.array(EffectRecord).default([]),
  points: z.number().optional(),
});
export type ScenarioUnit = z.infer<typeof ScenarioUnit>;

export const ScenarioContext = z.object({
  rangeBand: z.enum(["half", "full"]).default("full"),
  charged: z.boolean().default(false),
  stationary: z.boolean().default(false),
  inCover: z.boolean().default(false),
  snapShooting: z.boolean().default(false),
  phase: z.enum(["shooting", "fight"]).default("shooting"),
  /** Free-form flags set by toggles (e.g. "oath-target"). */
  flags: z.array(z.string()).default([]),
  allocationPolicy: AllocationPolicy.default("protect-character"),
  lethalChoice: LethalChoice.default("auto"),
  /** Order in which weapons are resolved: as listed, or heuristic (highest expected damage first). */
  weaponOrder: z.enum(["listed", "heuristic"]).default("heuristic"),
  /** Monte Carlo iterations when the exact path is not available. */
  mcIterations: z.number().int().positive().default(20000),
  /** Force a backend. */
  backend: z.enum(["auto", "exact", "mc"]).default("auto"),
});
export type ScenarioContext = z.infer<typeof ScenarioContext>;

export const Scenario = RecordMeta.extend({
  id: Id,
  name: z.string(),
  gameSystemId: Id,
  snapshotId: Id.optional(),
  attacker: ScenarioUnit,
  defender: ScenarioUnit,
  context: ScenarioContext.default({}),
  /** Manual toggle ids (Tier-3) and effect ids enabled for this scenario. */
  enabledToggles: z.array(z.string()).default([]),
  /** Extra ad-hoc effects the user added in the UI. */
  extraEffects: z.array(EffectRecord).default([]),
});
export type Scenario = z.infer<typeof Scenario>;

/** Preset defender archetypes (data supplied by game-system plugins; contains no GW text beyond generic profile numbers). */
export const Archetype = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  unit: ScenarioUnit,
});
export type Archetype = z.infer<typeof Archetype>;

// Re-export for convenience
export type { ModelProfile, WeaponProfile };
