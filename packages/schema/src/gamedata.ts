import { z } from "zod";
import { Id, DiceExpr } from "./common";
import { EffectRecord, ManualToggle } from "./effects";

export const GameSystem = z.object({
  id: Id, // e.g. "wh40k-11e"
  name: z.string(),
  edition: z.string(),
  version: z.string().optional(),
  costTypes: z.array(z.object({ id: z.string(), name: z.string() })).default([]),
});
export type GameSystem = z.infer<typeof GameSystem>;

export const Faction = z.object({
  id: Id,
  gameSystemId: Id,
  name: z.string(),
  parentFactionId: Id.optional(),
  keywords: z.array(z.string()).default([]),
});
export type Faction = z.infer<typeof Faction>;

export const Publication = z.object({
  id: Id,
  name: z.string(),
  type: z.string().optional(),
  edition: z.string().optional(),
  version: z.string().optional(),
  errataDate: z.string().optional(),
  errataLink: z.string().optional(),
});
export type Publication = z.infer<typeof Publication>;

export const ModelProfile = z.object({
  id: Id,
  name: z.string(),
  M: z.number().nullable().optional(),
  T: z.number(),
  Sv: z.number(),
  InvSv: z.number().nullable().optional(),
  W: z.number(),
  Ld: z.number().nullable().optional(),
  OC: z.number().nullable().optional(),
  baseSize: z.string().optional(),
});
export type ModelProfile = z.infer<typeof ModelProfile>;

/** Parsed weapon keyword, e.g. { name: "SUSTAINED HITS", value: "D3" } or { name: "ANTI", keyword: "VEHICLE", value: 4 }. */
export const WeaponKeyword = z.object({
  name: z.string(),
  value: z.union([z.number(), z.string()]).optional(),
  keyword: z.string().optional(),
  /** Raw text as found upstream, kept for display and for unknown keywords. */
  raw: z.string().optional(),
});
export type WeaponKeyword = z.infer<typeof WeaponKeyword>;

export const WeaponProfile = z.object({
  id: Id,
  name: z.string(),
  kind: z.enum(["ranged", "melee"]),
  range: z.number().nullable().optional(),
  A: DiceExpr,
  /** BS or WS as a target number (2..6). null = weapon has no skill (e.g. TORRENT: N/A). */
  skill: z.number().nullable(),
  S: z.number(),
  AP: z.number(), // stored as a non-negative magnitude: AP -2 => 2
  D: DiceExpr,
  keywords: z.array(WeaponKeyword).default([]),
  /** For multi-profile weapons: the parent weapon name (e.g. "Plasma gun" for "Plasma gun - supercharge"). */
  groupName: z.string().optional(),
});
export type WeaponProfile = z.infer<typeof WeaponProfile>;

export const AbilityScope = z.enum(["core", "faction", "datasheet", "detachment", "enhancement", "wargear", "stratagem", "other"]);
export type AbilityScope = z.infer<typeof AbilityScope>;

/**
 * An ability row carries all three tiers: raw text (always), a core keyword (Tier-1), and/or effect records (Tier-2).
 * Tier-3 abilities have only `text` and optionally a `manualToggle`.
 */
export const Ability = z.object({
  id: Id,
  name: z.string(),
  scope: AbilityScope.default("other"),
  text: z.string().default(""),
  /** Tier-1: name of a core keyword implemented natively by the game-system plugin (e.g. "FEEL NO PAIN", "DEEP STRIKE"). */
  coreKeyword: z.string().optional(),
  coreValue: z.union([z.number(), z.string()]).optional(),
  /** Tier-2 effect records. */
  effects: z.array(EffectRecord).optional(),
  /** Tier-3 manual toggle. */
  manualToggle: ManualToggle.optional(),
  factionId: Id.optional(),
  isLegends: z.boolean().default(false),
});
export type Ability = z.infer<typeof Ability>;

export const UnitComposition = z.object({
  /** Free-text line, e.g. "1 Sergeant and 4 Marines". */
  description: z.string(),
  min: z.number().int().optional(),
  max: z.number().int().optional(),
});

export const Datasheet = z.object({
  id: Id,
  gameSystemId: Id,
  factionId: Id,
  name: z.string(),
  role: z.string().optional(),
  isLegends: z.boolean().default(false),
  isCharacter: z.boolean().default(false),
  isEpicHero: z.boolean().default(false),
  isBattleline: z.boolean().default(false),
  isSupport: z.boolean().default(false),
  transportCapacity: z.string().optional(),
  keywords: z.array(z.string()).default([]),
  factionKeywords: z.array(z.string()).default([]),
  models: z.array(ModelProfile).min(1),
  weapons: z.array(WeaponProfile).default([]),
  abilityIds: z.array(Id).default([]),
  /** Datasheet ids this character can lead / support. */
  leaderTo: z.array(Id).default([]),
  supportTo: z.array(Id).default([]),
  composition: z.array(UnitComposition).default([]),
  /** Default loadout description (prose). */
  loadout: z.string().optional(),
  /** Wargear option lines (prose; the structured option tree lives in the BSData staging layer). */
  wargearOptions: z.array(z.string()).default([]),
  damagedProfile: z.object({ threshold: z.string(), description: z.string() }).optional(),
  sourceId: Id.optional(),
  /** Points fallback when no PriceRule exists (e.g. ad-hoc data). */
  fallbackPoints: z.number().optional(),
});
export type Datasheet = z.infer<typeof Datasheet>;

export const Enhancement = z.object({
  id: Id,
  detachmentId: Id,
  name: z.string(),
  cost: z.number(),
  text: z.string().default(""),
  supportOnly: z.boolean().default(false),
  restrictions: z.string().optional(),
  abilityId: Id.optional(),
  isLegends: z.boolean().default(false),
});
export type Enhancement = z.infer<typeof Enhancement>;

export const Stratagem = z.object({
  id: Id,
  factionId: Id.optional(),
  detachmentId: Id.optional(),
  name: z.string(),
  type: z.string().optional(),
  cpCost: z.number(),
  turn: z.enum(["your", "opponent", "either"]).optional(),
  phases: z.array(z.string()).default([]),
  when: z.string().optional(),
  target: z.string().optional(),
  effect: z.string().optional(),
  restrictions: z.string().optional(),
  /** Full description when the decomposition is not available upstream. */
  text: z.string().optional(),
  abilityId: Id.optional(),
});
export type Stratagem = z.infer<typeof Stratagem>;

export const Detachment = z.object({
  id: Id,
  factionId: Id,
  name: z.string(),
  /** Detachment Points cost (11e). */
  dp: z.number().int().default(1),
  forceDispositions: z.array(z.string()).default([]),
  uniqueTag: z.string().optional(),
  ruleAbilityIds: z.array(Id).default([]),
  enhancementIds: z.array(Id).default([]),
  stratagemIds: z.array(Id).default([]),
});
export type Detachment = z.infer<typeof Detachment>;
