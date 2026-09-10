import type { GameSystemPluginApi } from "./api";
import { archetypes } from "./archetypes";
import { gameSystem, manifest, RULES, RULES_10E } from "./manifest";
import { coverageFor, listToggles, resolveScenarioUnit, unitFromDatasheet, unitFromRosterUnit, baseWeaponName, parseLoadout, GENERIC_TOGGLES, activeToggleEffects, pointsFor } from "./resolve";
export type { ParsedLoadout } from "./resolve";
import { runScenario, runScenarioWith, keywordRegistry } from "./scenario";
import { create11eKeywordRegistry } from "./keywords";
import type { GameSystem, PluginManifest, Scenario, Snapshot } from "@grimstat/schema";
import type { RulesParams } from "./manifest";
import type { KeywordHandler } from "@grimstat/effects";

export type { GameSystemPluginApi, UnitFromDatasheetOptions } from "./api";
export { archetypes, gameSystem, manifest, RULES, RULES_10E, coverageFor, listToggles, resolveScenarioUnit, unitFromDatasheet, unitFromRosterUnit, baseWeaponName, parseLoadout, runScenario, GENERIC_TOGGLES, activeToggleEffects, pointsFor };
export { CH, POLICY } from "./channels";
export { create11eKeywordRegistry } from "./keywords";
export { abilityEffects, coreAbilityEffects, patternEffects } from "./patterns";
export { hitGate, woundGate, woundTarget, pUnsaved, damagePMF } from "./attack";
export { constraints11e, BATTLE_SIZES, compositionBounds, RESERVES_FRACTION, reservesLimit, startsInReserves } from "./constraints";
export { parseTransportCapacity, unitFitsKeywords, hasKeywordPhrase } from "./transport";
export type { TransportCapacity } from "./transport";
export { makeScenario, runMatrix, durabilityProfile, efficiencyRanking } from "./analysis";
export type { MatrixResult, MatrixCell, DurabilityEntry, EfficiencyRow } from "./analysis";
export { optimiseTurn, evaluateTurnPlan, DEFAULT_TURN_OPTIONS } from "./optimiser";
export { reverseMathhammer } from "./reverse";
export type { ReverseCandidate, ReverseInput, ReverseRow, ReverseResult } from "./reverse";
export { sensitivity, SENSITIVITY_VARIANTS, CHANNEL_INFO } from "./sensitivity";
export type { SensitivityVariant, SensitivityResult, SensitivityVariantDef } from "./sensitivity";
export type { TurnOption, TurnAttacker, TurnTarget, TurnPlanInput, TurnAssignment, TurnTargetOutcome, TurnPlanResult } from "./optimiser";

/** Extension point: add or override a Tier-1 weapon keyword without touching this package. */
export function registerKeyword(name: string, handler: KeywordHandler): void {
  keywordRegistry.register(name, handler);
}
export { keywordRegistry };

/**
 * Build a game-system plugin for another edition from the same pipeline: different rule constants,
 * an (optionally customised) keyword registry, and its own manifest/game-system ids.
 */
export function createGameSystem(opts: { manifest: PluginManifest; gameSystem: GameSystem; rules: RulesParams; keywords?: (registry: ReturnType<typeof create11eKeywordRegistry>) => void }): GameSystemPluginApi & { rules: RulesParams; registry: ReturnType<typeof create11eKeywordRegistry> } {
  const registry = create11eKeywordRegistry(opts.rules);
  opts.keywords?.(registry);
  return {
    manifest: opts.manifest,
    gameSystem: opts.gameSystem,
    archetypes,
    unitFromDatasheet,
    resolveScenarioUnit,
    listToggles,
    coverageFor,
    runScenario: (scenario: Scenario, o?: { snapshot?: Snapshot }) => runScenarioWith(opts.rules, registry, scenario, o),
    rules: opts.rules,
    registry,
  };
}
export type { RulesParams };

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
