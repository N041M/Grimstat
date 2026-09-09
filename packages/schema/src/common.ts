import { z } from "zod";

/** Stable identifier. Adapters derive these deterministically from upstream ids/names. */
export const Id = z.string().min(1);
export type Id = z.infer<typeof Id>;

/** Dice expression: "3", "D6", "2D6", "D3+1", "2D6+2". Case-insensitive. */
export const DiceExpr = z.string().regex(/^\s*(\d+)?[dD]?(3|6)?\s*([+-]\s*\d+)?\s*$/, "invalid dice expression").or(z.number().int().nonnegative());
export type DiceExpr = z.infer<typeof DiceExpr>;

/** Every persisted record carries identity/versioning fields so a sync layer can be added later without migration. */
export const RecordMeta = z.object({
  ownerId: z.string().default("local"),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  revision: z.number().int().nonnegative().default(0),
});
export type RecordMeta = z.infer<typeof RecordMeta>;

/** Localised string map, e.g. { en: "Titanic", de: "Titanisch" }. `en` is required. */
export const LocaleText = z.object({ en: z.string() }).catchall(z.string());
export type LocaleText = z.infer<typeof LocaleText>;
