import { describe, expect, it } from "vitest";
import { PLUGIN_API_VERSION, type ScenarioUnit } from "@grimstat/schema";
import { compatible, PluginHost, type PluginContext, type PluginModule, type WidgetDef } from "./index";
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
    ctx.registerArchetype({ id: "wobbler", name: "Wobbler", unit: { name: "Wobbler", keywords: [], models: [{ name: "w", count: 3, T: 4, Sv: 4, W: 2, isCharacter: false, keywords: [] }], weapons: [], attached: [], effects: [] } });
  },
};

const marines: ScenarioUnit = { name: "m", keywords: [], models: [{ name: "m", count: 10, T: 4, Sv: 3, W: 1, isCharacter: false, keywords: [] }], weapons: [], attached: [], effects: [] };
const gun = (keywords: ScenarioUnit["weapons"][number]["keywords"]): ScenarioUnit => ({ name: "a", keywords: [], models: [], attached: [], effects: [], weapons: [{ name: "gun", count: 10, kind: "ranged", range: 24, A: "1", skill: 4, S: 4, AP: 0, D: "1", keywords, enabled: true }] });

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

  it("reads the semver ranges a manifest may declare", () => {
    const [major, minor, patch] = PLUGIN_API_VERSION.split(".").map(Number) as [number, number, number];
    const host = `${major}.${minor}.${patch}`;
    for (const range of [host, `^${host}`, `~${host}`, `>=${host}`, `>= ${major}.${minor}.0`]) expect(compatible(range)).toBe(true);
    for (const range of [`${major}.${minor + 1}.0`, `^${major}.${minor + 1}.0`, `~${major}.${minor + 1}.0`, `>=${major}.${minor + 1}.0`, `${major + 1}.0.0`, "latest", ""]) {
      expect(compatible(range)).toBe(false);
    }
  });

  it("leaves nothing registered when activate throws", async () => {
    const host = new PluginHost();
    const broken: PluginModule = {
      manifest: { ...thirdParty.manifest, id: "broken" },
      activate(ctx) {
        ctx.registerWidget({ id: "w1", title: "W1", inputs: ["result"], defaultSize: { w: 1, h: 1 }, render: null });
        throw new Error("activation failed");
      },
    };
    await expect(host.load(broken)).rejects.toThrow(/activation failed/);
    expect([...host.registries.widgets.keys()]).toEqual([]);
    expect([...host.registries.manifests.keys()]).toEqual([]);
  });
});

describe("plugin host id collisions", () => {
  const unit: ScenarioUnit = { name: "Wobbler", keywords: [], models: [{ name: "w", count: 3, T: 4, Sv: 4, W: 2, isCharacter: false, keywords: [] }], weapons: [], attached: [], effects: [] };
  const widget = (id: string, title: string): WidgetDef => ({ id, title, inputs: ["result"], defaultSize: { w: 3, h: 2 }, render: title });
  /** Two widget packs written apart from each other, both calling their damage widget "dps". */
  const dpsPlugin = (id: string): PluginModule => ({ manifest: { ...thirdParty.manifest, id }, activate: (ctx) => ctx.registerWidget(widget("dps", `${id} DPS`)) });

  it("leaves a widget id with the plugin that registered it first, whichever order the two load in", async () => {
    for (const [first, second] of [["a", "b"] as const, ["b", "a"] as const]) {
      const host = new PluginHost();
      await host.load(dpsPlugin(first));
      await expect(host.load(dpsPlugin(second))).rejects.toThrow(`Plugin ${second} cannot register widget "dps": plugin ${first} registered it first`);
      expect(host.registries.widgets.get("dps")!.title).toBe(`${first} DPS`);
      expect([...host.registries.manifests.keys()]).toEqual([first]);
    }
  });

  const registrations: Array<[string, (ctx: PluginContext) => void]> = [
    ['game system "gs"', (ctx) => ctx.registerGameSystem("gs", {})],
    ['analysis "an"', (ctx) => ctx.registerAnalysis({ id: "an", title: "An", run: () => null })],
    ['archetype "arch"', (ctx) => ctx.registerArchetype({ id: "arch", name: "Arch", unit })],
  ];

  it.each(registrations)("refuses a second %s and keeps the rest of that plugin out too", async (what, register) => {
    const host = new PluginHost();
    await host.load({ manifest: { ...thirdParty.manifest, id: "first" }, activate: register });
    const second: PluginModule = {
      manifest: { ...thirdParty.manifest, id: "second" },
      activate(ctx) {
        ctx.registerWidget(widget("extra", "Extra"));
        register(ctx);
      },
    };
    await expect(host.load(second)).rejects.toThrow(`Plugin second cannot register ${what}: plugin first registered it first`);
    expect(host.registries.widgets.has("extra")).toBe(false);
    expect([...host.registries.manifests.keys()]).toEqual(["first"]);
  });

  it("fails the load of a plugin that catches the refusal", async () => {
    const host = new PluginHost();
    await host.load(dpsPlugin("a"));
    const swallows: PluginModule = {
      manifest: { ...thirdParty.manifest, id: "swallows" },
      activate(ctx) {
        try {
          ctx.registerWidget(widget("dps", "Quiet DPS"));
        } catch {
          // the plugin decides its own widget can wait
        }
        ctx.registerWidget(widget("extra", "Extra"));
      },
    };
    await expect(host.load(swallows)).rejects.toThrow(/cannot register widget "dps"/);
    expect(host.registries.widgets.get("dps")!.title).toBe("a DPS");
    expect(host.registries.widgets.has("extra")).toBe(false);
  });

  it("refuses an id one plugin registers twice", async () => {
    const host = new PluginHost();
    const twice: PluginModule = {
      manifest: { ...thirdParty.manifest, id: "twice" },
      activate(ctx) {
        ctx.registerWidget(widget("dps", "First"));
        ctx.registerWidget(widget("dps", "Second"));
      },
    };
    await expect(host.load(twice)).rejects.toThrow('Plugin twice cannot register widget "dps": it registered that id already');
    expect([...host.registries.widgets.keys()]).toEqual([]);
  });

  it("loads a plugin whose ids are its own", async () => {
    const host = new PluginHost();
    await host.load(dpsPlugin("a"));
    await host.load({ manifest: { ...thirdParty.manifest, id: "b" }, activate: (ctx) => ctx.registerWidget(widget("alpha-strike", "Alpha strike")) });
    expect([...host.registries.widgets.keys()]).toEqual(["dps", "alpha-strike"]);
    expect([...host.registries.manifests.keys()]).toEqual(["a", "b"]);
  });
});
