import { z } from "zod";

/** Stable identifier. Adapters derive these deterministically from upstream ids/names. */
export const Id = z.string().min(1);
export type Id = z.infer<typeof Id>;

/**
 * Dice expression: "3", "D6", "2D6", "D3+1", "2D6+2". Case-insensitive.
 *
 * An expression has to carry a count or a die. Making every part optional let `""`, `"+1"` and
 * `"-1"` through, and the engine's own parser throws on all three, so a value the schema called
 * valid failed at the point it was used.
 */
const DICE_RE = /^\s*(?:\d+\s*[dD]\s*[36]?|[dD]\s*[36]?|\d+)\s*(?:[+-]\s*\d+)?\s*$/;

/** Whether a string is a dice expression the engine can parse. */
export const isDiceExpr = (s: string): boolean => DICE_RE.test(s);

export const DiceExpr = z.string().regex(DICE_RE, "invalid dice expression").or(z.number().int().nonnegative());
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
