import { describe, expect, it } from "vitest";
import { catalogueFactionName, parse, type BsdataStaging } from "./index";
import { readFixtureDir } from "../test-utils";

const out = parse(readFixtureDir("bsdata", /\.json$/), { fetchedAt: "2026-01-01T00:00:00.000Z", ref: "abc123" });
const ds = (name: string) => out.datasheets!.find((d) => d.name === name)!;

describe("bsdata-json adapter (synthetic fixture)", () => {
  it("reads the game system and pins the ref", () => {
    expect(out.gameSystem).toMatchObject({ id: "wh40k-11e", edition: "11", version: "r1" });
    expect(out.gameSystem!.costTypes.map((c) => c.name)).toEqual(["pts", "Detachment Points"]);
    expect(out.sourceRef.ref).toBe("abc123");
    expect(out.publications).toEqual([{ id: "pub:bsdata:pub-synthetic", name: "Synthetic fixtures" }]);
  });

  it("derives faction names from catalogue names", () => {
    expect(catalogueFactionName("Imperium - Ashen Wardens - Library")).toBe("Ashen Wardens");
    expect(catalogueFactionName("Xenos - Verdant Swarm")).toBe("Verdant Swarm");
    expect(catalogueFactionName("Library - Titans")).toBe("Titans");
    expect(catalogueFactionName("Aeldari - Aeldari Library")).toBe("Aeldari");
    expect(out.factions!.map((f) => f.id).sort()).toEqual(["faction:ashen-wardens", "faction:verdant-swarm"]);
  });

  it("resolves entry links through the imported library and warns about missing catalogues", () => {
    expect(out.datasheets!.map((d) => d.id).sort()).toEqual([
      "ds:ashen-wardens:ashen-crusher",
      "ds:ashen-wardens:warden-captain",
      "ds:ashen-wardens:warden-squad",
      "ds:verdant-swarm:spine-drake",
      "ds:verdant-swarm:swarm-seer",
      "ds:verdant-swarm:thornlings",
    ]);
    expect(out.warnings.some((w) => w.includes("Some Missing Allies"))).toBe(true);
    expect(out.warnings.some((w) => w.includes("Old Thornback"))).toBe(true);
  });

  it("extracts model profiles (including nested sergeant/trooper profiles) and weapons", () => {
    expect(ds("Warden Squad").models!.map((m) => `${m.name} T${m.T} Sv${m.Sv} W${m.W} OC${m.OC}`)).toEqual(["Warden Sergeant T5 Sv3 W3 OC2", "Warden T5 Sv3 W2 OC2"]);
    expect(ds("Warden Captain").models![0]).toMatchObject({ M: 6, T: 5, Sv: 3, InvSv: 4, W: 5, Ld: 6, OC: 1 });
    const weapons = ds("Ashen Crusher").weapons!.map((w) => `${w.name}|${w.kind}|${w.range}|${w.A}|${w.skill}|${w.S}|${w.AP}|${w.D}|${w.keywords.map((k) => k.name + (k.value ?? "")).join(",")}`);
    expect(weapons).toEqual([
      "Fusion beamer|ranged|12|1|3|9|4|D6|MELTA2",
      "Twin hail gun|ranged|24|6|3|5|1|1|TWIN-LINKED,SUSTAINED HITS1",
      "Vortex cannon|ranged|36|D6|3|9|2|3|BLAST,HEAVY",
      "Crusher fists|melee|null|4|3|12|3|4|",
    ]);
    expect(ds("Spine Drake").weapons!.find((w) => w.name === "Spine volley")!.skill).toBeNull();
  });

  it("maps categories to keywords and flags", () => {
    const captain = ds("Warden Captain");
    expect(captain.factionKeywords).toEqual(["ASHEN WARDENS"]);
    expect(captain.keywords).toEqual(["INFANTRY", "CHARACTER", "WARDEN CAPTAIN"]);
    expect(captain.isCharacter).toBe(true);
    expect(ds("Thornlings").isBattleline).toBe(true);
    expect(ds("Ashen Crusher").keywords).toContain("VEHICLE");
  });

  it("builds abilities: profiles, core rules with values, faction rules, and no detachment-rule leakage", () => {
    const byId = new Map(out.abilities!.map((a) => [a.id, a]));
    const crusher = ds("Ashen Crusher");
    expect(crusher.abilityIds).toContain("ab:core:deadly-demise:d3");
    expect(crusher.abilityIds).not.toContain("ab:core:deadly-demise");
    expect(crusher.abilityIds).toContain("ab:core:damaged:1-4");
    expect(crusher.abilityIds).toContain("ab:ashen-wardens:ashen-crusher:siege-protocols");
    expect(byId.get("ab:ashen-wardens:ashen-crusher:ablative-plating")!.scope).toBe("wargear");
    const captain = ds("Warden Captain");
    expect(captain.abilityIds).toEqual(["ab:ashen-wardens:warden-captain:rally-the-line", "ab:core:leader", "ab:core:deep-strike", "ab:ashen-wardens:ember-resolve"]);
    expect(byId.get("ab:ashen-wardens:ember-resolve")).toMatchObject({ scope: "faction", factionId: "faction:ashen-wardens" });
    expect(captain.abilityIds!.some((id) => id.includes("ember-doctrine"))).toBe(false);
    expect(byId.get("ab:core:feel-no-pain:5")).toMatchObject({ coreKeyword: "FEEL NO PAIN", coreValue: 5 });
    expect(ds("Thornlings").abilityIds).toEqual(["ab:core:feel-no-pain:5"]);
  });

  it("resolves leader / support associations through unit categories", () => {
    expect(ds("Warden Captain").leaderTo).toEqual(["ds:ashen-wardens:warden-squad"]);
    expect(ds("Swarm Seer").leaderTo).toEqual(["ds:verdant-swarm:thornlings"]);
    expect(ds("Swarm Seer").supportTo).toEqual([]);
  });

  it("derives composition from group constraints and points tiers from cost modifiers", () => {
    expect(ds("Warden Squad").composition).toEqual([
      { description: "1 Warden Sergeant", min: 1, max: 1 },
      { description: "4-9 Warden", min: 4, max: 9 },
    ]);
    expect(ds("Thornlings").composition).toEqual([{ description: "10-20 Thornlings", min: 10, max: 20 }]);
    expect(out.priceRules!.find((r) => r.datasheetId === "ds:ashen-wardens:warden-squad")).toEqual({ datasheetId: "ds:ashen-wardens:warden-squad", copyRange: { min: 1 }, tiers: [{ models: 5, points: 90 }, { models: 10, points: 180 }] });
    expect(out.priceRules!.find((r) => r.datasheetId === "ds:verdant-swarm:thornlings")!.tiers).toEqual([{ models: 10, points: 60 }, { models: 20, points: 120 }]);
    expect(out.wargearPrices).toEqual([{ datasheetId: "ds:ashen-wardens:ashen-crusher", item: "Fusion beamer", points: 10 }]);
    expect(ds("Spine Drake").fallbackPoints).toBe(210);
  });

  it("extracts detachments with DP, unique tags and rules, and links enhancements to them", () => {
    const ember = out.detachments!.find((d) => d.id === "det:ashen-wardens:ember-vanguard")!;
    expect(ember).toMatchObject({ dp: 2, uniqueTag: "Ember", forceDispositions: [] });
    expect(ember.ruleAbilityIds).toEqual(["ab:det-ashen-wardens:ember-vanguard:ember-doctrine"]);
    expect(ember.enhancementIds).toEqual(["enh:ashen-wardens:ember-blade", "enh:ashen-wardens:wardens-aegis"]);
    expect(out.enhancements!.find((e) => e.name === "Ember Blade")).toMatchObject({ cost: 15, detachmentId: "det:ashen-wardens:ember-vanguard", text: "Improve the Strength and Damage characteristics of the bearer's melee weapons by 1." });
    const tide = out.detachments!.find((d) => d.name === "Thorn Tide")!;
    expect(tide.dp).toBe(1);
    expect(tide.enhancementIds).toEqual(["enh:verdant-swarm:venom-sac"]);
  });

  it("keeps the raw selection-entry tree in staging", () => {
    const staging = out.staging as BsdataStaging;
    expect(staging.entries["ds:ashen-wardens:warden-squad"]!.id).toBe("se-warden-squad");
    expect(staging.upstreamIds["ds:verdant-swarm:spine-drake"]).toBe("se-spine-drake");
    expect(staging.catalogues.map((c) => `${c.name}:${c.library}`)).toContain("Imperium - Ashen Wardens - Library:true");
    expect(staging.unresolvedLinks[0]).toMatchObject({ name: "Some Missing Allies" });
  });

  it("ignores non-BSData JSON", () => {
    const r = parse({ "tree.json": '{"sha":"x","tree":[]}', "bad.json": "{" });
    expect(r.warnings).toHaveLength(3);
    expect(r.datasheets).toEqual([]);
  });
});
