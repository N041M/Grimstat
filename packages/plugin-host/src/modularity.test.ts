import { describe, expect, it } from "vitest";
import { PLUGIN_API_VERSION, type ScenarioUnit } from "@grimstat/schema";
import { PluginHost, type PluginModule } from "./index";
import { registerKeyword, runScenario, makeScenario, coverageFor, CH } from "@grimstat/game-40k-11e";

/**
 * Modularity proof: a third-party plugin adds a new weapon keyword, a widget and an archetype
 * through the public extension points only. No core package is edited.
 */
const thirdParty: PluginModule = {
  manifest: { id: "example-plugin", name: "Example", version: "1.0.0", apiVersion: PLUGIN_API_VERSION, kind: "effects", entry: "inline", trusted: false },
  activate(ctx) {
    registerKeyword("WOBBLY", (kw, c) => c.mods.add({ channel: CH.hitRoll, op: "add", value: Number(kw.value ?? 1), source: "Wobbly" }));
    ctx.registerWidget({ id: "wobble-meter", title: "Wobble meter", inputs: ["result"], defaultSize: { w: 3, h: 2 }, render: () => null });
    ctx.registerArchetype({ id: "wobbler", name: "Wobbler", unit: { name: "Wobbler", keywords: [], models: [{ name: "w", count: 3, T: 4, Sv: 4, W: 2, isCharacter: false, keywords: [] }], weapons: [], effects: [] } });
  },
};

const marines: ScenarioUnit = { name: "m", keywords: [], models: [{ name: "m", count: 10, T: 4, Sv: 3, W: 1, isCharacter: false, keywords: [] }], weapons: [], effects: [] };
const gun = (keywords: ScenarioUnit["weapons"][number]["keywords"]): ScenarioUnit => ({ name: "a", keywords: [], models: [], effects: [], weapons: [{ name: "gun", count: 10, kind: "ranged", range: 24, A: "1", skill: 4, S: 4, AP: 0, D: "1", keywords, enabled: true }] });

describe("plugin host modularity", () => {
  it("a keyword registered by a third-party plugin is modelled and counted as tier 1", async () => {
    const before = runScenario(makeScenario(gun([{ name: "WOBBLY", value: 1, raw: "Wobbly 1" }]), marines));
    expect(before.coverage.unmodelled).toContain("gun: Wobbly 1");
    const host = new PluginHost();
    await host.load(thirdParty);
    const after = runScenario(makeScenario(gun([{ name: "WOBBLY", value: 1, raw: "Wobbly 1" }]), marines));
    expect(after.coverage.unmodelled).toEqual([]);
    expect(after.warnings).toEqual([]);
    // +1 to hit: BS4+ → 5/6 vs 3/6... crit 6s unchanged; expected damage rises from 10*(3/6)*(1/2)*(1/3) to 10*(4/6)*(1/2)*(1/3)
    expect(after.expectedDamage).toBeCloseTo(10 * (4 / 6) * (1 / 2) * (1 / 3), 9);
    expect(before.expectedDamage).toBeCloseTo(10 * (3 / 6) * (1 / 2) * (1 / 3), 9);
    expect(host.registries.widgets.has("wobble-meter")).toBe(true);
    expect(host.registries.archetypes.has("wobbler")).toBe(true);
    expect(coverageFor(gun([{ name: "WOBBLY" }])).tier1).toBe(1);
  });
  it("rejects plugins built for another API version", async () => {
    const host = new PluginHost();
    await expect(host.load({ ...thirdParty, manifest: { ...thirdParty.manifest, id: "old", apiVersion: "9.0.0" } })).rejects.toThrow(/API/);
  });
});
