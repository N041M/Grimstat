import { PLUGIN_API_VERSION, type GameSystem, type PluginManifest } from "@grimstat/schema";
import { createGameSystem, RULES_10E } from "@grimstat/game-40k-11e";

/**
 * Warhammer 40,000 10th edition, expressed as rule-parameter overrides on the shared pipeline:
 * cover is +1 to the armour save (not a BS penalty; no bonus for a 3+ save against AP0),
 * unmodified 6s do not automatically save, Lethal Hits is automatic, Hazardous fails on a 1 only,
 * and CLEAVE does not exist. 10e codexes remain legal alongside 11e, so both plugins coexist.
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

export const plugin = createGameSystem({
  manifest,
  gameSystem,
  rules: RULES_10E,
  keywords: (registry) => {
    registry.register("CLEAVE", (_kw, c) => c.warnings.push("CLEAVE is not a 10th-edition ability."));
  },
});

export const runScenario = plugin.runScenario;
export default plugin;
