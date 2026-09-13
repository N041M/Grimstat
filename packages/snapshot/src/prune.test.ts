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
  it("keeps a faction whose datasheets all sit on a sub-faction", () => {
    // This is the shape a filtered import leaves behind. MFM contributes every faction, BSData was
    // limited to one chapter, so the chapter carries the datasheets and the root keeps the detachments.
    const base = loadSyntheticSnapshot().data;
    const data = {
      ...base,
      factions: [...base.factions, { id: "faction:ember-chapter", gameSystemId: "wh40k-11e", name: "Ember Chapter", parentFactionId: "faction:ashen-wardens", keywords: [] }],
      datasheets: base.datasheets.filter((d) => d.factionId === "faction:ashen-wardens").map((d) => ({ ...d, factionId: "faction:ember-chapter" })),
    };
    const { data: out, removedFactions } = pruneFactionsWithoutDatasheets(data);
    expect(removedFactions).toEqual(["Verdant Swarm"]);
    expect(out.factions.map((f) => f.id)).toEqual(["faction:ashen-wardens", "faction:ember-chapter"]);
    expect(out.detachments.map((d) => d.id)).toEqual(["det:ashen-wardens:ember-vanguard"]);
    expect(out.enhancements.every((e) => e.detachmentId === "det:ashen-wardens:ember-vanguard")).toBe(true);
    expect(out.stratagems.some((s) => s.id === "strat:ashen-wardens:ember-vanguard:hold-fast")).toBe(true);
  });

  it("stops on a parent chain that loops", () => {
    const base = loadSyntheticSnapshot().data;
    const data = {
      ...base,
      factions: base.factions.map((f) => ({ ...f, parentFactionId: f.id === "faction:ashen-wardens" ? "faction:verdant-swarm" : "faction:ashen-wardens" })),
      datasheets: base.datasheets.filter((d) => d.factionId === "faction:ashen-wardens"),
    };
    expect(pruneFactionsWithoutDatasheets(data).removedFactions).toEqual([]);
  });

  it("is a no-op when every faction has datasheets", () => {
    const base = loadSyntheticSnapshot().data;
    expect(pruneFactionsWithoutDatasheets(base).removedFactions).toEqual([]);
  });
});
