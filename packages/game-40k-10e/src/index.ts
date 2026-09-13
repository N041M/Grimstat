import { PLUGIN_API_VERSION, type GameSystem, type PluginManifest } from "@grimstat/schema";
import { createGameSystem, RULES_10E } from "@grimstat/game-40k-11e";

/**
 * Warhammer 40,000 10th edition, expressed as rule-parameter overrides on the shared pipeline.
 *
 * Cover improves the armour save by 1 rather than worsening the attacker's BS, and a save of 3+ or
 * better gains nothing from it against AP 0. An unmodified 6 does not save on its own. Lethal Hits
 * is automatic. Hazardous fails on a 1 only, and costs three mortal wounds to a CHARACTER as well as
 * to a MONSTER or VEHICLE. Indirect Fire at a target the firing unit cannot see subtracts 1 from the
 * Hit roll and gives the target the Benefit of Cover. CLEAVE does not exist.
 *
 * The rules live in `RULES_10E` in the 11e package, so the app scores a 10e scenario the same way
 * whether it reaches the pipeline through this plugin or through `runScenario` there. 10e codexes
 * remain legal alongside 11e, so both plugins coexist.
 */
export const manifest: PluginManifest = {
  id: "game-40k-10e",
  name: "Warhammer 40,000 — 10th edition rules model",
  version: "0.1.0",
  apiVersion: PLUGIN_API_VERSION,
  kind: "game-system",
  entry: "@grimstat/game-40k-10e",
  trusted: true,
};

export const gameSystem: GameSystem = { id: "wh40k-10e", name: "Warhammer 40,000", edition: "10", costTypes: [{ id: "pts", name: "Points" }] };

export const plugin = createGameSystem({ manifest, gameSystem, rules: RULES_10E });

export const runScenario = plugin.runScenario;
export default plugin;
