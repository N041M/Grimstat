import { describe, expect, it } from "vitest";
import { parse } from "./index";
import { readFixtureDir } from "../test-utils";

const out = parse(readFixtureDir("mfm", /\.ya?ml$/), { fetchedAt: "2026-01-01T00:00:00.000Z" });

describe("mfm-yaml adapter (synthetic fixture)", () => {
  it("records the MFM version and last update as the source ref", () => {
    expect(out.sourceRef.adapter).toBe("mfm-yaml");
    expect(out.sourceRef.ref).toBe("mfm-v0.1@2026-01-01");
    expect(out.sourceRef.fetchedAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("emits factions and datasheet stubs with legends flags and leader lists", () => {
    expect(out.factions!.map((f) => f.id).sort()).toEqual(["faction:ashen-wardens", "faction:verdant-swarm"]);
    const captain = out.datasheets!.find((d) => d.id === "ds:ashen-wardens:warden-captain")!;
    expect(captain.leaderTo).toEqual(["ds:ashen-wardens:warden-squad"]);
    expect(captain.models).toBeUndefined();
    const legend = out.datasheets!.find((d) => d.name === "Old Thornback")!;
    expect(legend.isLegends).toBe(true);
  });

  it("parses tiered price rules with copy ranges", () => {
    const rules = out.priceRules!.filter((r) => r.datasheetId === "ds:ashen-wardens:warden-squad");
    expect(rules).toEqual([
      { datasheetId: "ds:ashen-wardens:warden-squad", copyRange: { min: 1, max: 2 }, tiers: [{ models: 5, points: 90 }, { models: 10, points: 180 }], label: "Your 1st To 2nd Units Cost" },
      { datasheetId: "ds:ashen-wardens:warden-squad", copyRange: { min: 3 }, tiers: [{ models: 5, points: 100 }, { models: 10, points: 200 }], label: "Your 3rd + Unit Costs" },
    ]);
    const seer = out.priceRules!.filter((r) => r.datasheetId === "ds:verdant-swarm:swarm-seer").map((r) => r.copyRange);
    expect(seer).toEqual([{ min: 1, max: 1 }, { min: 2 }]);
  });

  it("emits wargear prices", () => {
    expect(out.wargearPrices).toEqual([{ datasheetId: "ds:ashen-wardens:ashen-crusher", item: "Fusion beamer", points: 10 }]);
  });

  it("emits detachments with DP, force dispositions, unique tags and enhancements", () => {
    const det = out.detachments!.find((d) => d.id === "det:ashen-wardens:ember-vanguard")!;
    expect(det.dp).toBe(2);
    expect(det.forceDispositions).toEqual(["HOLD THE RIDGE"]);
    expect(det.uniqueTag).toBe("Ember");
    expect(det.enhancementIds).toEqual(["enh:ashen-wardens:ember-blade", "enh:ashen-wardens:wardens-aegis"]);
    const aegis = out.enhancements!.find((e) => e.id === "enh:ashen-wardens:wardens-aegis")!;
    expect(aegis.cost).toBe(25);
    expect(aegis.restrictions).toBe("LEADER: Warden Squad");
    expect(aegis.supportOnly).toBe(false);
    const tide = out.detachments!.find((d) => d.name === "Thorn Tide")!;
    expect(tide.dp).toBe(1);
    expect(tide.uniqueTag).toBeUndefined();
  });

  it("warns instead of failing on unparsable input", () => {
    const bad = parse({ "broken.yaml": "name: [unclosed", "meta.yaml": "version: '1'\nfactions: []\n" });
    expect(bad.warnings.some((w) => w.includes("YAML parse error"))).toBe(true);
    expect(bad.datasheets).toEqual([]);
  });
});
