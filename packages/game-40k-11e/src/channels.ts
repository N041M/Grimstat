import type { ChannelPolicy } from "@grimstat/effects";
import { RULES } from "./manifest";

/**
 * Modifier channels used by the 11e model. Values on "*-roll" channels are roll modifiers (capped);
 * "skill" is a *stat* penalty in target-number units (+1 = one worse, uncapped) — this is how 11e cover works.
 */
export const CH = {
  attacks: "attacks",
  skill: "skill", // BS/WS stat penalty (+1 = worse). Uncapped. Cover lives here.
  hitRoll: "hit-roll",
  critHit: "crit-hit", // threshold, cap = lower
  rerollHit: "reroll-hit",
  strength: "strength",
  toughness: "toughness",
  woundRoll: "wound-roll",
  critWound: "crit-wound",
  rerollWound: "reroll-wound",
  ap: "ap", // magnitude; +1 = better AP
  saveRoll: "save-roll",
  save: "save", // armour save stat delta (+1 = worse)
  invuln: "invuln", // set/cap invulnerable target
  rerollSave: "reroll-save",
  damage: "damage",
  fnp: "fnp", // set X (roll X+ ignores)
  // flags
  autoHit: "auto-hit",
  lethal: "lethal",
  devastating: "devastating",
  sustained: "sustained", // numeric: extra hits per crit (dice via sustainedDice flag channel)
  precision: "precision",
  ignoresCover: "ignores-cover",
  psychic: "psychic",
  indirect: "indirect",
  hazardous: "hazardous",
  stealth: "stealth",
  noCritHits: "no-crit-hits",
} as const;

export const POLICY: Record<string, ChannelPolicy> = {
  [CH.hitRoll]: { capAdd: RULES.hitRollCap },
  [CH.woundRoll]: { capAdd: RULES.woundRollCap },
  [CH.saveRoll]: { capAdd: RULES.saveRollCap },
  [CH.critHit]: { min: 2, max: 6 },
  [CH.critWound]: { min: 2, max: 6 },
  [CH.damage]: { min: 1 },
  [CH.ap]: { min: 0 },
  [CH.attacks]: { min: 0 },
  [CH.fnp]: { min: 0, max: 7 },
};
