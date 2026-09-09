import type { GameSystemPluginApi } from "./api";
import { archetypes } from "./archetypes";
import { gameSystem, manifest, RULES } from "./manifest";
import { coverageFor, listToggles, resolveScenarioUnit, unitFromDatasheet, unitFromRosterUnit, baseWeaponName, GENERIC_TOGGLES, activeToggleEffects, pointsFor } from "./resolve";
import { runScenario } from "./scenario";

export type { GameSystemPluginApi, UnitFromDatasheetOptions } from "./api";
export { archetypes, gameSystem, manifest, RULES, coverageFor, listToggles, resolveScenarioUnit, unitFromDatasheet, unitFromRosterUnit, baseWeaponName, runScenario, GENERIC_TOGGLES, activeToggleEffects, pointsFor };
export { CH, POLICY } from "./channels";
export { create11eKeywordRegistry } from "./keywords";
export { abilityEffects, coreAbilityEffects, patternEffects } from "./patterns";
export { hitGate, woundGate, woundTarget, pUnsaved, damagePMF } from "./attack";
export { constraints11e, BATTLE_SIZES, compositionBounds } from "./constraints";
export { makeScenario, runMatrix, durabilityProfile, efficiencyRanking } from "./analysis";
export type { MatrixResult, MatrixCell, DurabilityEntry, EfficiencyRow } from "./analysis";

export const plugin: GameSystemPluginApi = {
  manifest,
  gameSystem,
  archetypes,
  unitFromDatasheet,
  resolveScenarioUnit,
  listToggles,
  coverageFor,
  runScenario,
};

export default plugin;
