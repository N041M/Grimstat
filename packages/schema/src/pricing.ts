import { z } from "zod";
import { Id } from "./common";

/**
 * 11e pricing: cost depends on which copy of the unit this is (Requisition Thresholds),
 * on the model count band, and on selected wargear. Never a flat number.
 */
export const PriceTier = z.object({ models: z.number().int().positive(), points: z.number() });

export const PriceRule = z.object({
  datasheetId: Id,
  /** Inclusive 1-based range of unit copies this rule applies to; max undefined = open-ended. */
  copyRange: z.object({ min: z.number().int().positive().default(1), max: z.number().int().positive().optional() }),
  label: z.string().optional(),
  tiers: z.array(PriceTier).min(1),
});
export type PriceRule = z.infer<typeof PriceRule>;

export const WargearPrice = z.object({ datasheetId: Id, item: z.string(), points: z.number() });
export type WargearPrice = z.infer<typeof WargearPrice>;
