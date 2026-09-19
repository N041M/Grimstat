import { PLUGIN_API_VERSION, type GameSystem, type PluginManifest } from "@grimstat/schema";

export const manifest: PluginManifest = {
  id: "game-40k-11e",
  name: "Warhammer 40,000 — 11th edition rules model",
  version: "0.1.0",
  apiVersion: PLUGIN_API_VERSION,
  kind: "game-system",
  entry: "@grimstat/game-40k-11e",
  trusted: true,
};

export const gameSystem: GameSystem = {
  id: "wh40k-11e",
  name: "Warhammer 40,000",
  edition: "11",
  costTypes: [
    { id: "pts", name: "Points" },
    { id: "dp", name: "Detachment Points" },
    { id: "enh", name: "Enhancements" },
  ],
};

/** Edition-level rule parameters. Another edition's plugin overrides these through `createGameSystem`. */
export interface RulesParams {
  hitRollCap: number;
  woundRollCap: number;
  saveRollCap: number;
  /** An unmodified save roll of 6 saves whatever the armour and AP say. Neither edition's core rules grant it. */
  sixAlwaysSaves: boolean;
  /**
   * One profile's save rolls are all made first and resolved from the lowest result up, each against
   * whichever allocation group is current when it is reached (11e). 10e allocates one wound at a
   * time and rolls its save against the model it landed on.
   */
  savesResolvedLowestFirst: boolean;
  coverAsSkillPenalty: boolean;
  /** STEALTH gives the target the benefit of cover (11e), or subtracts 1 from the Hit roll (10e). */
  stealthAsCover: boolean;
  /** 10e-style cover: +1 to the armour save against ranged attacks, except for a 3+ or better save against AP0. */
  coverAsSaveBonus: boolean;
  /** Lethal Hits is a choice (11e) or automatic (10e). */
  lethalOptional: boolean;
  /**
   * Indirect Fire at a target the firing unit cannot see: only unmodified 6s hit (11e), or -1 to the
   * Hit roll and the Benefit of Cover for the target (10e).
   */
  indirectNotVisibleSnap: boolean;
  hazardousFailProb: number;
  hazardousMortals: number;
  /** Mortal wounds a failed Hazardous test costs a model carrying one of `hazardousBigModelKeywords`. */
  hazardousMortalsBigModel: number;
  /** Keywords that raise a failed Hazardous test to `hazardousMortalsBigModel` mortal wounds. */
  hazardousBigModelKeywords: readonly string[];
  devastatingMortalsNoSpill: boolean;
  damageModsApplyToDevastating: boolean;
  blastPerModels: number;
  /** CLEAVE exists as a weapon ability. 10e has no such ability, and a weapon printed with it is flagged. */
  cleave: boolean;
}

export const RULES: RulesParams = {
  hitRollCap: 1,
  woundRollCap: 1,
  saveRollCap: 1,
  /** The 11e save table names one unmodified result, a 1, which inflicts damage. A 6 saves only when the armour or invulnerable save reaches it. */
  sixAlwaysSaves: false,
  savesResolvedLowestFirst: true,
  /** Cover: -1 to the attacker's BS/WS *stat* (uncapped channel), not +1 to the save. */
  coverAsSkillPenalty: true,
  coverAsSaveBonus: false,
  /** STEALTH: the target has the benefit of cover against ranged attacks. */
  stealthAsCover: true,
  lethalOptional: true,
  /** Indirect Fire at a target that cannot be seen: only unmodified 6s hit. */
  indirectNotVisibleSnap: true,
  /** Hazardous: fails on 1-2; 1 MW, or 3 MW for a VEHICLE or MONSTER. */
  hazardousFailProb: 2 / 6,
  hazardousMortals: 1,
  hazardousMortalsBigModel: 3,
  hazardousBigModelKeywords: ["VEHICLE", "MONSTER"],
  /** Devastating Wounds: MW equal to Damage, max one model per critical wound (no spill). */
  devastatingMortalsNoSpill: true,
  /** Damage modifiers also apply to Devastating Wounds mortal damage (it equals the *modified* D characteristic). */
  damageModsApplyToDevastating: true,
  /** Blast/Cleave: +1 (or +X) attacks per 5 models in the target unit. */
  blastPerModels: 5,
  cleave: true,
};

export const RULES_10E: RulesParams = {
  ...RULES,
  sixAlwaysSaves: false,
  savesResolvedLowestFirst: false,
  coverAsSkillPenalty: false,
  coverAsSaveBonus: true,
  /** STEALTH: subtract 1 from the Hit roll of ranged attacks against the unit. */
  stealthAsCover: false,
  lethalOptional: false,
  /** Indirect Fire at a target that cannot be seen: -1 to the Hit roll, and the target has the Benefit of Cover. */
  indirectNotVisibleSnap: false,
  hazardousFailProb: 1 / 6,
  /** In 10e a failed test costs the bearer three mortal wounds whatever kind of model it is. */
  hazardousMortals: 3,
  hazardousBigModelKeywords: ["CHARACTER", "MONSTER", "VEHICLE"],
  cleave: false,
};
