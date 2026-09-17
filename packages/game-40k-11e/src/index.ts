import type { GameSystemPluginApi } from "./api";
import { archetypes } from "./archetypes";
import { gameSystem, manifest, RULES, RULES_10E } from "./manifest";
import { coverageFor, listToggles, resolveScenarioUnit, unitFromDatasheet, unitFromRosterUnit, baseWeaponName, parseLoadout, GENERIC_TOGGLES, abilityToggles, activeToggleEffects, pointsFor, upper } from "./resolve";
export type { ParsedLoadout, Archetype } from "./resolve";
import { runScenario, runScenarioWith, keywordRegistry, publishEdition, registerKeywordEverywhere } from "./scenario";
import type { GameSystem, PluginManifest, Scenario, Snapshot } from "@grimstat/schema";
import type { RulesParams } from "./manifest";
import type { KeywordHandler, KeywordOptions, KeywordRegistry } from "@grimstat/effects";

export type { GameSystemPluginApi, UnitFromDatasheetOptions } from "./api";
export { archetypes, gameSystem, manifest, RULES, RULES_10E, coverageFor, listToggles, resolveScenarioUnit, unitFromDatasheet, unitFromRosterUnit, baseWeaponName, parseLoadout, runScenario, GENERIC_TOGGLES, abilityToggles, activeToggleEffects, pointsFor, upper };
export { CH, POLICY } from "./channels";
export { create11eKeywordRegistry } from "./keywords";
export { abilityEffects, coreAbilityEffects, patternEffects, applyFnpToModels } from "./patterns";
export type { AbilityEffects } from "./patterns";
export { hitGate, woundGate, woundTarget, pUnsaved, damagePMF, attacksPMF, sustainedPMF, classifyHit, classifyWound } from "./attack";
export type { HitOpts, WoundOpts, SaveOpts } from "./attack";
export { constraints11e, BATTLE_SIZES, RESERVES_FRACTION, reservesLimit, startsInReserves } from "./constraints";
export { compositionBounds } from "./composition";
export type { BattleSizeRules } from "./constraints";
export { parseTransportCapacity, unitFitsKeywords, hasKeywordPhrase } from "./transport";
export type { TransportCapacity } from "./transport";
export { readWargearOptions, wargearItems, checkLoadout, omittedDefaults, UNLIMITED } from "./loadout";
export type { WargearOption, WargearReading, LoadoutProblem, LoadoutCheck, CheckLoadoutOptions } from "./loadout";
export { makeScenario, phaseFor, runMatrix, durabilityProfile, durabilityIndex, efficiencyRanking, incomingFire, effectiveWounds, pReferenceSticks, removalChain, editionOf, combineSampling, REFERENCE_ATTACK, DEFAULT_GAME_SYSTEM_ID } from "./analysis";
export type { MatrixResult, MatrixCell, DurabilityEntry, DurabilityIndexRow, EfficiencyRow, IncomingEntry, IncomingFireRow, ReferenceAttack, RemovalChain, EditionOpts, RunSampling } from "./analysis";
export { optimiseTurn, evaluateTurnPlan, DEFAULT_TURN_OPTIONS } from "./optimiser";
export { reverseMathhammer } from "./reverse";
export type { ReverseCandidate, ReverseInput, ReverseRow, ReverseResult } from "./reverse";
export { sensitivity, SENSITIVITY_VARIANTS, CHANNEL_INFO } from "./sensitivity";
export type { SensitivityVariant, SensitivityResult, SensitivityVariantDef } from "./sensitivity";
export type { TurnOption, TurnAttacker, TurnTarget, TurnPlanInput, TurnAssignment, TurnTargetOutcome, TurnPlanResult } from "./optimiser";

/**
 * Extension point: add or override a Tier-1 weapon keyword without touching this package. The
 * keyword reaches every edition, so a scenario scored under 10th-edition rules gets it too.
 */
export function registerKeyword(name: string, handler: KeywordHandler, opts: KeywordOptions = {}): void {
  registerKeywordEverywhere(name, handler, opts);
}
export { keywordRegistry };

/**
 * Build a game-system plugin for another edition from the same pipeline: different rule constants,
 * an (optionally customised) keyword registry, and its own manifest/game-system ids.
 *
 * The edition is published under its game-system id, so a scenario carrying that id runs under these
 * rules through `runScenario` as well as through the returned plugin.
 */
export function createGameSystem(opts: { manifest: PluginManifest; gameSystem: GameSystem; rules: RulesParams; keywords?: (registry: KeywordRegistry) => void }): GameSystemPluginApi & { rules: RulesParams; registry: KeywordRegistry } {
  const registry = publishEdition(opts.gameSystem.id, opts.rules, opts.keywords);
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
