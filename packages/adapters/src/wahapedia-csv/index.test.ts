import { describe, expect, it } from "vitest";
import { parse } from "./index";
import { readFixtureDir } from "../test-utils";

const out = parse(readFixtureDir("wahapedia", /\.csv$/), { fetchedAt: "2026-01-01T00:00:00.000Z" });
const ds = (name: string) => out.datasheets!.find((d) => d.name === name)!;

describe("wahapedia-csv adapter (synthetic fixture)", () => {
  it("uses the last update as the source ref and skips virtual datasheets", () => {
    expect(out.sourceRef.ref).toBe("2026-01-01 00:00:00");
    expect(out.datasheets).toHaveLength(6);
    expect(out.warnings.some((w) => w.includes("virtual"))).toBe(true);
  });

  it("parses model profiles including invulnerable saves and base sizes", () => {
    const captain = ds("Warden Captain");
    expect(captain.models).toEqual([{ id: "mp:ashen-wardens:warden-captain:warden-captain", name: "Warden Captain", M: 6, T: 5, Sv: 3, InvSv: 4, W: 5, Ld: 6, OC: 1, baseSize: "40mm" }]);
    expect(ds("Warden Squad").models!.map((m) => `${m.name}:${m.W}`)).toEqual(["Warden Sergeant:3", "Warden:2"]);
  });

  it("parses weapons with keywords, AP magnitude, dice and N/A skill", () => {
    const drake = ds("Spine Drake");
    const volley = drake.weapons!.find((w) => w.name === "Spine volley")!;
    expect(volley).toMatchObject({ kind: "ranged", range: 18, A: "D6+3", skill: null, S: 6, AP: 1, D: 1 });
    expect(volley.keywords.map((k) => k.name)).toEqual(["TORRENT", "IGNORES COVER"]);
    const lance = drake.weapons!.find((w) => w.name === "Acid lance")!;
    expect(lance.keywords).toEqual([
      { name: "ANTI", keyword: "VEHICLE", value: 4, raw: "Anti-vehicle 4+" },
      { name: "DEVASTATING WOUNDS", raw: "Devastating Wounds" },
    ]);
    const talons = drake.weapons!.find((w) => w.name === "Rending talons")!;
    expect(talons).toMatchObject({ kind: "melee", range: null, A: 6, skill: 3, S: 9, AP: 2, D: 3 });
  });

  it("derives keywords, flags and faction keywords", () => {
    const captain = ds("Warden Captain");
    expect(captain.factionKeywords).toEqual(["ASHEN WARDENS"]);
    expect(captain.isCharacter).toBe(true);
    expect(ds("Warden Squad").isBattleline).toBe(true);
    expect(ds("Ashen Crusher").damagedProfile).toEqual({ threshold: "1-4", description: "While this model has 1-4 wounds remaining, subtract 1 from its hit rolls and its Objective Control characteristic is 1." });
    expect(ds("Ashen Crusher").loadout).toBe("This model is equipped with: vortex cannon; twin hail gun; crusher fists.");
  });

  it("maps core abilities to coreKeyword/coreValue and keeps datasheet abilities as text", () => {
    const byId = new Map(out.abilities!.map((a) => [a.id, a]));
    expect(byId.get("ab:core:feel-no-pain:5")).toMatchObject({ scope: "core", coreKeyword: "FEEL NO PAIN", coreValue: 5, name: "Feel No Pain 5+" });
    expect(byId.get("ab:core:deadly-demise:d3")).toMatchObject({ coreKeyword: "DEADLY DEMISE", coreValue: "D3" });
    expect(byId.get("ab:core:deep-strike")).toMatchObject({ coreKeyword: "DEEP STRIKE" });
    expect(ds("Thornlings").abilityIds).toEqual(["ab:core:feel-no-pain:5"]);
    const rally = byId.get("ab:ashen-wardens:warden-captain:rally-the-line")!;
    expect(rally).toMatchObject({ scope: "datasheet", text: "Each time this unit makes a ranged attack, re-roll a hit roll of 1." });
    expect(rally.coreKeyword).toBeUndefined();
    const faction = byId.get("ab:ashen-wardens:ember-resolve")!;
    expect(faction.scope).toBe("faction");
    expect(faction.factionId).toBe("faction:ashen-wardens");
    const wargear = byId.get("ab:ashen-wardens:ashen-crusher:ablative-plating")!;
    expect(wargear.scope).toBe("wargear");
  });

  it("keeps multi-line HTML descriptions intact after stripping", () => {
    const shield = out.abilities!.find((a) => a.name.startsWith("Shield Wall"))!;
    expect(shield.text).toContain("this unit can brace.");
    expect(shield.text).toContain('- It cannot be selected as the target of ranged attacks made by models more than 18" away.');
    expect(shield.text).toContain("- It cannot make Overwatch attacks.");
    expect(shield.text).not.toContain("<");
  });

  it("joins leaders to the units they can lead", () => {
    expect(ds("Warden Captain").leaderTo).toEqual(["ds:ashen-wardens:warden-squad"]);
    expect(ds("Swarm Seer").leaderTo).toEqual(["ds:verdant-swarm:thornlings"]);
    expect(ds("Swarm Seer").isSupport).toBe(false);
  });

  it("parses composition lines with min/max and wargear option prose", () => {
    expect(ds("Warden Squad").composition).toEqual([
      { description: "1 Warden Sergeant", min: 1, max: 1 },
      { description: "4-9 Wardens", min: 4, max: 9 },
    ]);
    expect(ds("Thornlings").composition).toEqual([{ description: "10-20 Thornlings", min: 10, max: 20 }]);
    expect(ds("Ashen Crusher").wargearOptions).toEqual(["This model’s twin hail gun can be replaced with one of the following:\n\n- 1 fusion beamer\n- 1 vortex cannon"]);
  });

  it("parses points tables into price rules, wargear prices and fallback points", () => {
    const squad = out.priceRules!.filter((r) => r.datasheetId === "ds:ashen-wardens:warden-squad");
    expect(squad.map((r) => [r.copyRange, r.tiers])).toEqual([
      [{ min: 1, max: 2 }, [{ models: 5, points: 90 }, { models: 10, points: 180 }]],
      [{ min: 3 }, [{ models: 5, points: 100 }, { models: 10, points: 200 }]],
    ]);
    expect(out.wargearPrices).toEqual([{ datasheetId: "ds:ashen-wardens:ashen-crusher", item: "Fusion beamer", points: 10 }]);
    expect(ds("Warden Captain").fallbackPoints).toBe(85);
    expect(ds("Swarm Seer").fallbackPoints).toBe(70);
  });

  it("decomposes stratagems into when/target/effect/restrictions with turn and phases", () => {
    const hold = out.stratagems!.find((s) => s.name === "HOLD FAST")!;
    expect(hold).toMatchObject({ cpCost: 1, turn: "your", phases: ["Fight"], detachmentId: "det:ashen-wardens:ember-vanguard", factionId: "faction:ashen-wardens" });
    expect(hold.when).toBe("Your Fight phase.");
    expect(hold.target).toContain("ASHEN WARDENS unit from your army");
    expect(hold.effect).toContain("add 1 to the hit roll");
    expect(hold.restrictions).toContain("cannot use this Stratagem");
    const surge = out.stratagems!.find((s) => s.name === "SURGE OF THORNS")!;
    expect(surge).toMatchObject({ cpCost: 2, turn: "either", phases: ["Shooting", "Fight"] });
    const core = out.stratagems!.find((s) => s.name === "RE-ROLL DICE")!;
    expect(core.factionId).toBeUndefined();
    expect(core.id).toBe("strat:core:re-roll-dice");
    expect(core.phases).toEqual(["Any"]);
  });

  it("groups detachment rules, enhancements and stratagems into detachments (dp defaults to 1 with a warning)", () => {
    const det = out.detachments!.find((d) => d.id === "det:ashen-wardens:ember-vanguard")!;
    expect(det.dp).toBe(1);
    expect(det.ruleAbilityIds).toEqual(["ab:det-ashen-wardens:ember-vanguard:ember-doctrine"]);
    expect(det.enhancementIds).toEqual(["enh:ashen-wardens:ember-blade", "enh:ashen-wardens:wardens-aegis"]);
    expect(det.stratagemIds).toEqual(["strat:ashen-wardens:ember-vanguard:hold-fast", "strat:ashen-wardens:ember-vanguard:covering-volley"]);
    expect(out.warnings.some((w) => w.includes("no Detachment Points"))).toBe(true);
    const aegis = out.enhancements!.find((e) => e.name === "Warden's Aegis")!;
    expect(aegis.cost).toBe(25);
    expect(aegis.restrictions).toBe("LEADER: WARDEN SQUAD");
    expect(aegis.supportOnly).toBe(false);
  });

  it("keeps datasheet -> stratagem / enhancement availability in staging", () => {
    const staging = out.staging as { datasheetStratagems: Record<string, string[]>; upstreamDatasheetIds: Record<string, string> };
    expect(staging.datasheetStratagems["ds:ashen-wardens:warden-squad"]).toEqual(["strat:ashen-wardens:ember-vanguard:hold-fast", "strat:ashen-wardens:ember-vanguard:covering-volley"]);
    expect(staging.upstreamDatasheetIds["ds:ashen-wardens:warden-captain"]).toBe("000000101");
  });

  it("rejects a single string input", () => {
    expect(() => parse("id|name|\n")).toThrow(/map of table name/);
  });
});
