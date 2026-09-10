import { describe, expect, it } from "vitest";
import { loadSyntheticSnapshot } from "./index";
import { pruneFactionsWithoutDatasheets } from "./prune";

describe("pruneFactionsWithoutDatasheets", () => {
  it("removes factions with no datasheets and their dependants", () => {
    const base = loadSyntheticSnapshot().data;
    const data = { ...base, datasheets: base.datasheets.filter((d) => d.factionId === "faction:ashen-wardens") };
    const { data: out, removedFactions } = pruneFactionsWithoutDatasheets(data);
    expect(removedFactions).toEqual(["Verdant Swarm"]);
    expect(out.factions.map((f) => f.id)).toEqual(["faction:ashen-wardens"]);
    expect(out.detachments.every((d) => d.factionId === "faction:ashen-wardens")).toBe(true);
    expect(out.enhancements.every((e) => e.detachmentId.startsWith("det:ashen-wardens"))).toBe(true);
    expect(out.stratagems.some((s) => s.id === "strat:core:re-roll-dice")).toBe(true);
    expect(out.stratagems.some((s) => s.id.startsWith("strat:verdant-swarm"))).toBe(false);
    expect(out.priceRules.every((p) => p.datasheetId.startsWith("ds:ashen-wardens"))).toBe(true);
  });
  it("is a no-op when every faction has datasheets", () => {
    const base = loadSyntheticSnapshot().data;
    expect(pruneFactionsWithoutDatasheets(base).removedFactions).toEqual([]);
  });
});
