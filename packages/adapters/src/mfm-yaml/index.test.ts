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

  it("warns instead of failing on a faction file without a slug", () => {
    const withSlug = "name: Ashen Wardens\nslug: ashen-wardens\nunits: []\n";
    const bad = parse({ "ashen-wardens.yaml": withSlug, "no-slug.yaml": "name: Verdant Swarm\nunits: []\n" });
    expect(bad.warnings).toContain("no-slug.yaml: faction file without a slug, ignored");
    expect(bad.factions!.map((f) => f.id)).toEqual(["faction:ashen-wardens"]);
  });

  // A chapter's file lists the shared Space Marines roster under the parent's group. Nearly every
  // entry repeats the parent's points, and the ones that do not are what these two cover.
  describe("a unit two factions price differently", () => {
    const jumpPacks = (first: number, firstTen: number, third: number, thirdTen: number, group?: string): string[] => [
      "  - name: Assault Intercessors With Jump Packs",
      ...(group ? [`    groupTitle: ${group}`] : []),
      "    pricing:",
      "      - range: '[1,2]'",
      "        label: Your 1st To 2nd Units Cost",
      "        costs:",
      `          - { models: 5, points: ${first} }`,
      `          - { models: 10, points: ${firstTen} }`,
      "      - range: '[3,)'",
      "        label: Your 3rd + Unit Costs",
      "        costs:",
      `          - { models: 5, points: ${third} }`,
      `          - { models: 10, points: ${thirdTen} }`,
    ];
    const chapter = (name: string, slug: string, lines: string[]): string => [`name: ${name}`, `slug: ${slug}`, "parent: Space Marines", "units:", ...lines].join("\n");
    const out = parse({
      "black-templars.yaml": chapter("Black Templars", "black-templars", jumpPacks(85, 160, 95, 170, "Space Marines")),
      "blood-angels.yaml": chapter("Blood Angels", "blood-angels", jumpPacks(95, 180, 105, 190, "Space Marines")),
      "space-marines.yaml": ["name: Space Marines", "slug: space-marines", "units:", ...jumpPacks(85, 160, 95, 170)].join("\n"),
    });
    const points = (id: string) => out.priceRules!.filter((r) => r.datasheetId === id).map((r) => `[${r.copyRange.min},${r.copyRange.max ?? ""}] ${r.tiers.map((t) => `${t.models}:${t.points}`).join(" ")}`);

    it("gives the chapter that charges more its own datasheet, with its own points", () => {
      expect(points("ds:space-marines:assault-intercessors-with-jump-packs")).toEqual(["[1,2] 5:85 10:160", "[3,] 5:95 10:170"]);
      expect(points("ds:blood-angels:assault-intercessors-with-jump-packs")).toEqual(["[1,2] 5:95 10:180", "[3,] 5:105 10:190"]);
      const stub = out.datasheets!.find((d) => d.id === "ds:blood-angels:assault-intercessors-with-jump-packs")!;
      expect(stub.factionId).toBe("faction:blood-angels");
      expect(stub.name).toBe("Assault Intercessors With Jump Packs");
    });

    it("leaves the chapters that charge what the parent charges on the parent's datasheet", () => {
      expect(out.datasheets!.map((d) => d.id)).toEqual(["ds:space-marines:assault-intercessors-with-jump-packs", "ds:blood-angels:assault-intercessors-with-jump-packs"]);
      expect(points("ds:black-templars:assault-intercessors-with-jump-packs")).toEqual([]);
      expect(out.warnings).toEqual([]);
    });
  });

  // Imperial Agents lists each unit twice. The second listing gives the price the unit costs in
  // another Imperium army, and both listings belong to the same faction, so only one can be kept.
  it("warns when one file prices the same unit twice, and keeps the first price", () => {
    const yaml = [
      "name: Imperial Agents",
      "slug: imperial-agents",
      "units:",
      "  - name: Inquisitor Draxus",
      "    pricing:",
      "      - range: '[1,)'",
      "        label: Your Unit Costs",
      "        costs:",
      "          - { models: 1, points: 75 }",
      "    wargear:",
      "      - { item: Psychic hood, points: 10 }",
      "  - name: Inquisitor Draxus",
      "    groupTitle: Every Model Has The Imperium Keyword",
      "    pricing:",
      "      - range: '[1,)'",
      "        label: Your Unit Costs",
      "        costs:",
      "          - { models: 1, points: 110 }",
      "    wargear:",
      "      - { item: Psychic hood, points: 15 }",
    ].join("\n");
    const out = parse({ "imperial-agents.yaml": yaml });
    expect(out.priceRules!.map((r) => r.tiers)).toEqual([[{ models: 1, points: 75 }]]);
    expect(out.wargearPrices).toEqual([{ datasheetId: "ds:imperial-agents:inquisitor-draxus", item: "Psychic hood", points: 10 }]);
    expect(out.warnings).toEqual([
      'imperial-agents.yaml: Inquisitor Draxus is priced twice, at 75 for 1 model and at 110 for 1 model under "Every Model Has The Imperium Keyword". The first price is used and the second is dropped.',
      'imperial-agents.yaml: Inquisitor Draxus gives two prices for "Psychic hood", 10 and 15 under "Every Model Has The Imperium Keyword". The first price is used and the second is dropped.',
    ]);
  });

  it("says nothing when the same price is listed twice", () => {
    const twice = ["name: Imperial Agents", "slug: imperial-agents", "units:", ...[0, 1].flatMap(() => ["  - name: Vindicare Assassin", "    pricing:", "      - range: '[1,)'", "        costs:", "          - { models: 1, points: 110 }"])].join("\n");
    const out = parse({ "imperial-agents.yaml": twice });
    expect(out.priceRules!.map((r) => r.tiers)).toEqual([[{ models: 1, points: 110 }]]);
    expect(out.warnings).toEqual([]);
  });

  // The MFM is scraped every day, which is where a row that lost its name comes from.
  it("skips rows without a name and imports the rest of the file", () => {
    const yaml = [
      "name: Ashen Wardens",
      "slug: ashen-wardens",
      "units:",
      "  - name: Warden Squad",
      "    pricing:",
      "      - range: '[1,]'",
      "        costs:",
      "          - models: 5",
      "            points: 90",
      "          - null",
      "  - null",
      "  - name: null",
      "    pricing: []",
      "  - pricing: []",
      "  - Warden Captain",
      "detachments:",
      "  - name: Ember Vanguard",
      "    dp: 2",
      "    enhancements:",
      "      - points: 15",
      "  - dp: 2",
    ].join("\n");
    const bad = parse({ "ashen-wardens.yaml": yaml });
    expect(bad.datasheets!.map((d) => d.id)).toEqual(["ds:ashen-wardens:warden-squad"]);
    expect(bad.priceRules!.map((r) => r.tiers)).toEqual([[{ models: 5, points: 90 }]]);
    expect(bad.detachments!.map((d) => d.id)).toEqual(["det:ashen-wardens:ember-vanguard"]);
    expect(bad.enhancements).toEqual([]);
    expect(bad.warnings).toEqual([
      "ashen-wardens.yaml: malformed unit, ignored",
      "ashen-wardens.yaml: unit without a name, ignored",
      "ashen-wardens.yaml: unit without a name, ignored",
      "ashen-wardens.yaml: malformed unit, ignored",
      `ashen-wardens.yaml: malformed cost of "Warden Squad", ignored`,
      "ashen-wardens.yaml: detachment without a name, ignored",
      `ashen-wardens.yaml: enhancement of "Ember Vanguard" without a name, ignored`,
    ]);
  });
});
