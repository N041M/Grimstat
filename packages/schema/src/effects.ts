import { z } from "zod";

/**
 * Attack-pipeline stages. Game-system plugins may register additional stages; these are the
 * common vocabulary used by effect records and the 40k plugins.
 */
export const Stage = z.enum(["attacks", "hit", "wound", "allocate", "save", "damage", "fnp", "mortal", "hazardous", "any"]);
export type Stage = z.infer<typeof Stage>;

export const Side = z.enum(["attacker", "defender"]);
export type Side = z.infer<typeof Side>;

/** Modifier channels. Each game system declares caps per channel (e.g. hit-roll ±1, bs-stat uncapped). */
export const Channel = z.string().min(1);
export type Channel = z.infer<typeof Channel>;

export const RangeBand = z.enum(["half", "full", "any"]);
export type RangeBand = z.infer<typeof RangeBand>;

/** Declarative condition evaluated against a ScenarioContext. All listed keys must hold (AND). */
export type Condition = {
  all?: Condition[];
  any?: Condition[];
  not?: Condition;
  targetKeyword?: string;
  targetNotKeyword?: string;
  attackerKeyword?: string;
  weaponKind?: "ranged" | "melee";
  weaponKeyword?: string;
  rangeBand?: "half" | "full";
  charged?: boolean;
  stationary?: boolean;
  inCover?: boolean;
  phase?: string;
  /** Free-form flag set by toggles or other effects (e.g. "oath-target"). */
  flag?: string;
};
export const Condition: z.ZodType<Condition> = z.lazy(() =>
  z.object({
    all: z.array(Condition).optional(),
    any: z.array(Condition).optional(),
    not: Condition.optional(),
    targetKeyword: z.string().optional(),
    targetNotKeyword: z.string().optional(),
    attackerKeyword: z.string().optional(),
    weaponKind: z.enum(["ranged", "melee"]).optional(),
    weaponKeyword: z.string().optional(),
    rangeBand: z.enum(["half", "full"]).optional(),
    charged: z.boolean().optional(),
    stationary: z.boolean().optional(),
    inCover: z.boolean().optional(),
    phase: z.string().optional(),
    flag: z.string().optional(),
  }),
);

export const EffectOp = z.enum([
  "add", // numeric modifier on a channel (subject to channel caps)
  "set", // set a channel value (e.g. crit-hit threshold 5)
  "mul", // multiply (e.g. half damage)
  "cap", // cap a channel value (e.g. damage max 3)
  "reroll", // set a reroll policy on a channel: value = 'ones' | 'failed' | 'all' | 'non-crit' | 'one-die'
  "flag", // set a boolean flag on the attack (e.g. ignores-cover, torrent)
  "substitute", // substitute a fixed roll result (Miracle/Fate dice): value = 6
]);
export type EffectOp = z.infer<typeof EffectOp>;

/**
 * Tier-2 effect record: a small, data-only description of a rule that the engine can apply.
 * Example: "+1 to wound vs VEHICLE in the Shooting phase" =>
 *   { when: { stage: 'wound', side: 'attacker' }, if: { targetKeyword: 'VEHICLE' }, op: 'add', target: 'wound-roll', value: 1 }
 */
export const EffectRecord = z.object({
  id: z.string().optional(),
  when: z.object({ stage: Stage, side: Side.default("attacker") }),
  if: Condition.optional(),
  op: EffectOp,
  target: Channel,
  value: z.union([z.number(), z.string(), z.boolean()]),
  /** Human-readable provenance, e.g. "Oath of Moment". */
  source: z.string().optional(),
});
export type EffectRecord = z.infer<typeof EffectRecord>;

/** A Tier-3 ability exposes a manual toggle the user can switch on in a scenario; it may carry approximate effects. */
export const ManualToggle = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string().optional(),
  side: Side.default("attacker"),
  effects: z.array(EffectRecord).default([]),
  defaultOn: z.boolean().default(false),
});
export type ManualToggle = z.infer<typeof ManualToggle>;

export const CoverageTier = z.enum(["tier1", "tier2", "tier3"]);
export type CoverageTier = z.infer<typeof CoverageTier>;
