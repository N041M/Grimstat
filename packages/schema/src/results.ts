import { z } from "zod";

/** Probability mass function over non-negative integers: pmf[k] = P(X = k). */
export const PMF = z.array(z.number());
export type PMF = number[];

export const Percentiles = z.object({ p5: z.number(), p25: z.number(), p50: z.number(), p75: z.number(), p95: z.number() });

export const StageTrace = z.object({
  stage: z.string(),
  label: z.string(),
  /** Expected count flowing out of the stage (e.g. expected hits). */
  expected: z.number(),
  note: z.string().optional(),
});
export type StageTrace = z.infer<typeof StageTrace>;

export const WeaponResult = z.object({
  name: z.string(),
  count: z.number(),
  expectedAttacks: z.number(),
  expectedHits: z.number(),
  expectedWounds: z.number(),
  expectedUnsaved: z.number(),
  expectedDamage: z.number(),
  trace: z.array(StageTrace),
});
export type WeaponResult = z.infer<typeof WeaponResult>;

export const CoverageReport = z.object({
  tier1: z.number().int(),
  tier2: z.number().int(),
  tier3: z.number().int(),
  unmodelled: z.array(z.string()),
});
export type CoverageReport = z.infer<typeof CoverageReport>;

export const SimResult = z.object({
  backend: z.enum(["exact", "mc"]),
  iterations: z.number().int().optional(),
  /** 95% CI half-width on expected damage when backend = mc. */
  ciHalfWidth: z.number().optional(),
  damagePMF: PMF,
  slainPMF: PMF,
  expectedDamage: z.number(),
  expectedSlain: z.number(),
  pKill: z.number(),
  /** P(at least k models slain) for k = 0..models. */
  pAtLeastSlain: z.array(z.number()),
  damagePercentiles: Percentiles,
  slainPercentiles: Percentiles,
  expectedWasted: z.number(),
  expectedSelfMortals: z.number(),
  weapons: z.array(WeaponResult),
  attackerPoints: z.number().optional(),
  defenderPoints: z.number().optional(),
  damagePerPoint: z.number().optional(),
  pointsSlain: z.number().optional(),
  coverage: CoverageReport,
  warnings: z.array(z.string()).default([]),
  /** Defender state distribution after the attack (exact backend); used to chain attackers in the turn optimiser. */
  finalState: z.array(z.number()).optional(),
});
export type SimResult = z.infer<typeof SimResult>;
