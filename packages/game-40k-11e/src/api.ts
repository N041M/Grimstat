/**
 * Public API contract of the 40k 11th-edition game-system plugin.
 * The web app and CLI depend only on these signatures.
 */
import type { Archetype, CoverageReport, Datasheet, GameSystem, ManualToggle, PluginManifest, Scenario, ScenarioUnit, SimResult, Snapshot } from "@grimstat/schema";

export interface UnitFromDatasheetOptions {
  /** Total models in the unit (defaults to the datasheet's minimum size, or 1). */
  modelCount?: number;
  /** Characters (datasheet ids) attached to this unit as Leader/Support. */
  attachedDatasheetIds?: string[];
  /** Restrict weapons to these names (defaults to every ranged+melee profile with count = models). */
  weaponNames?: string[];
}

export interface GameSystemPluginApi {
  manifest: PluginManifest;
  gameSystem: GameSystem;
  /** Preset defender archetypes: generic profiles, no GW text. */
  archetypes: Archetype[];
  /** Build a ScenarioUnit from a datasheet in a snapshot (models, weapons, abilities → effects, coverage). */
  unitFromDatasheet(ds: Datasheet, snapshot: Snapshot, opts?: UnitFromDatasheetOptions): ScenarioUnit;
  /** If a ScenarioUnit carries a `ref`, fill its inline fields from the snapshot; otherwise return as-is. */
  resolveScenarioUnit(unit: ScenarioUnit, snapshot: Snapshot | undefined): ScenarioUnit;
  /** All manual toggles available for this scenario (Tier-3 abilities on both units + generic toggles like Command Re-roll). */
  listToggles(scenario: Scenario, snapshot?: Snapshot): ManualToggle[];
  /** Coverage of the abilities on a unit: how many are modelled at each tier. */
  coverageFor(unit: ScenarioUnit, snapshot?: Snapshot): CoverageReport;
  /** Run the scenario through the engine. Pure and synchronous; call from a worker. */
  runScenario(scenario: Scenario, opts?: { snapshot?: Snapshot }): SimResult;
}
