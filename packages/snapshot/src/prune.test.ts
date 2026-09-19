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

  it("drops the datasheet links to the stratagems it removed", () => {
    // A datasheet of the faction that stays can name a stratagem of the faction that goes: in the
    // real data every chapter's detachment stratagems name the shared Space Marines datasheets.
    const base = loadSyntheticSnapshot().data;
    const alien = base.stratagems.find((s) => s.id.startsWith("strat:verdant-swarm"))!;
    const kept = base.datasheets.filter((d) => d.factionId === "faction:ashen-wardens");
    const data = { ...base, datasheets: kept.map((d, i) => (i === 0 ? { ...d, stratagemIds: [...d.stratagemIds, alien.id] } : d)) };
    const { data: out } = pruneFactionsWithoutDatasheets(data);
    expect(out.stratagems.some((s) => s.id === alien.id)).toBe(false);
    const ids = new Set(out.stratagems.map((s) => s.id));
    expect(out.datasheets.every((d) => d.stratagemIds.every((x) => ids.has(x)))).toBe(true);
  });

  it("returns a new object when nothing is removed", () => {
    const base = loadSyntheticSnapshot().data;
    const { data: out } = pruneFactionsWithoutDatasheets(base);
    expect(out).not.toBe(base);
    expect(out).toEqual(base);
  });
});
