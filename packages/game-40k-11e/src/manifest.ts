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

/** Edition-level rule parameters. A 10e plugin would override these. */
export const RULES = {
  hitRollCap: 1,
  woundRollCap: 1,
  saveRollCap: 1,
  /** Unmodified 6 always saves (11e). */
  sixAlwaysSaves: true,
  /** Cover: -1 to the attacker's BS/WS *stat* (uncapped channel), not +1 to the save. */
  coverAsSkillPenalty: true,
  /** Hazardous: fails on 1-2; 1 MW, or 3 MW if every model in the firing unit is a VEHICLE/MONSTER. */
  hazardousFailProb: 2 / 6,
  hazardousMortals: 1,
  hazardousMortalsVehicleMonster: 3,
  /** Devastating Wounds: MW equal to Damage, max one model per critical wound (no spill). */
  devastatingMortalsNoSpill: true,
  /** Damage modifiers also apply to Devastating Wounds mortal damage (it equals the *modified* D characteristic). */
  damageModsApplyToDevastating: true,
  /** Blast/Cleave: +1 (or +X) attacks per 5 models in the target unit. */
  blastPerModels: 5,
} as const;
