import { describe, expect, it, vi } from "vitest";
import type { ScenarioUnit, Snapshot } from "@grimstat/schema";
import { efficiencyRanking } from "@grimstat/game-40k-11e";
import { overlaps } from "../lib/format";

// Loading the worker publishes its API over `globalThis`, which node has no listener API for.
vi.stubGlobal("addEventListener", () => undefined);
const { SNAPSHOT_CACHE_LIMIT, api } = await import("./sim.worker");

const NOW = "2026-01-01T00:00:00.000Z";

const snapshot = (checksum: string): Snapshot => ({
  id: "snap",
  ownerId: "local",
  createdAt: NOW,
  updatedAt: NOW,
  revision: 0,
  gameSystemId: "wh40k-11e",
  checksum,
  sources: [],
  conflicts: [],
  data: {
    gameSystem: { id: "wh40k-11e", name: "x", edition: "11", costTypes: [] },
    factions: [],
    publications: [],
    datasheets: [],
    abilities: [],
    detachments: [],
    enhancements: [],
    stratagems: [],
    priceRules: [],
    wargearPrices: [],
  },
});

/** A run that reads the cache and nothing else: an empty matrix has no cells to work out. */
const read = (ref: string): void => {
  api.matrix([], [], {}, [], ref);
};

// The cache is the worker module's own state, so these tests share it and each uses its own keys.
describe("the worker's snapshot cache", () => {
  it("holds two variants of one snapshot at once, each under its own key", () => {
    const raw = snapshot("abc");
    const patched = snapshot("abc+ov1234");
    expect(patched.id).toBe(raw.id); // an override keeps the id and only moves the checksum
    expect(api.putSnapshot("snap|abc", raw)).toEqual(["snap|abc"]);
    expect(api.putSnapshot("snap|abc+ov1234", patched)).toEqual(["snap|abc", "snap|abc+ov1234"]);
    expect(() => read("snap|abc")).not.toThrow();
    expect(() => read("snap|abc+ov1234")).not.toThrow();
  });

  it("refuses a key it does not hold rather than running without the snapshot", () => {
    api.putSnapshot("snap|abc", snapshot("abc"));
    // The bare id is what the client used to send, and it is not a key any more.
    expect(() => read("snap")).toThrow(/not cached/);
    expect(() => read("snap|gone")).toThrow(/not cached/);
  });

  it("drops the least recently used snapshot past the limit and reports what it kept", () => {
    const keys = Array.from({ length: SNAPSHOT_CACHE_LIMIT }, (_, i) => `many|${i}`);
    for (const key of keys) api.putSnapshot(key, snapshot(key));
    read(keys[0]!); // reading counts as use, so the next hand-over drops the one after it

    const held = api.putSnapshot("many|extra", snapshot("extra"));
    expect(held).toHaveLength(SNAPSHOT_CACHE_LIMIT);
    expect(held).toContain(keys[0]);
    expect(held).not.toContain(keys[1]);
    expect(() => read(keys[1]!)).toThrow(/not cached/);
  });

  it("counts a second hand-over of one key as use, not as a second entry", () => {
    const keys = Array.from({ length: SNAPSHOT_CACHE_LIMIT }, (_, i) => `again|${i}`);
    for (const key of keys) api.putSnapshot(key, snapshot(key));
    expect(api.putSnapshot(keys[0]!, snapshot("0"))).toHaveLength(SNAPSHOT_CACHE_LIMIT);

    const held = api.putSnapshot("again|extra", snapshot("extra"));
    expect(held).toContain(keys[0]);
    expect(held).not.toContain(keys[1]);
  });
});

describe("merging the two halves of the efficiency ranking", () => {
  const gunner: ScenarioUnit = {
    name: "Gun line",
    keywords: [],
    models: [{ name: "Trooper", count: 5, T: 4, Sv: 3, W: 2, isCharacter: false, keywords: [] }],
    weapons: [{ name: "Rifle", count: 5, kind: "ranged", range: 24, A: "2", skill: 3, S: 5, AP: 1, D: "1", keywords: [], enabled: true }],
    attached: [],
    effects: [],
    points: 100,
  };
  const fighter: ScenarioUnit = {
    name: "Blade mob",
    keywords: [],
    models: [{ name: "Fighter", count: 5, T: 4, Sv: 4, W: 2, isCharacter: false, keywords: [] }],
    weapons: [{ name: "Blade", count: 5, kind: "melee", range: null, A: "3", skill: 3, S: 6, AP: 2, D: "2", keywords: [], enabled: true }],
    attached: [],
    effects: [],
    // Priced so the two rows land a thousandth apart, which is the near-tie this ranking has no way
    // of telling apart at 2,000 samples.
    points: 427,
  };
  const targetIds = ["marine-like", "heavy-tank"];
  const context = { rangeBand: "half" as const, backend: "mc" as const, mcIterations: 2000 };

  it("hands each row on whole, with its own backend and its own interval", () => {
    const merged = api.efficiency([gunner, fighter], { targetIds, context }).result;
    expect(merged.map((r) => r.unit)).toEqual(["Gun line", "Blade mob"]);
    expect(merged.every((r) => r.perPoints)).toBe(true);

    // The same two calls the worker makes, each on its own, with the scale settled the same way.
    const base = { targetIds, context, perPoints: true };
    const ranged = efficiencyRanking([gunner], base)[0]!;
    const melee = efficiencyRanking([fighter], { ...base, context: { ...context, phase: "fight" as const, charged: true } })[0]!;
    for (const row of [ranged, melee]) {
      const got = merged.find((r) => r.unit === row.unit)!;
      expect(got.backend).toBe(row.backend);
      expect(got.ciHalfWidth).toBe(row.ciHalfWidth);
      expect(got.damagePer100).toBe(row.damagePer100);
    }
    expect(ranged.backend).toBe("mc");
    expect(melee.backend).toBe("mc");
    expect(merged[0]!.ciHalfWidth).toBeCloseTo(0.0418251394, 9);
    expect(merged[1]!.ciHalfWidth).toBeCloseTo(0.0245238765, 9);
  });

  it("orders the merged column on expected damage alone", () => {
    const merged = api.efficiency([gunner, fighter], { targetIds, context }).result;
    for (let i = 1; i < merged.length; i++) expect(merged[i - 1]!.damagePer100).toBeGreaterThanOrEqual(merged[i]!.damagePer100);
    // The gap between the top two is a hundredth of what their intervals reach, so the ranking has no
    // grounds for the order it prints. Reading that as a tie belongs to the screen, and the rows now
    // carry what it needs to do so.
    const gap = merged[0]!.damagePer100 - merged[1]!.damagePer100;
    expect(gap).toBeCloseTo(0.0004197892, 9);
    expect(merged[0]!.ciHalfWidth! + merged[1]!.ciHalfWidth!).toBeCloseTo(0.0663490159, 9);
    expect(overlaps(merged[0]!.damagePer100, merged[0]!.ciHalfWidth, merged[1]!.damagePer100, merged[1]!.ciHalfWidth)).toBe(true);
  });
});
