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

  it("keeps every price step of a unit with three model bands", () => {
    const unit = {
      name: "Bramble Host",
      id: "se-bramble-host",
      type: "unit",
      costs: [{ name: "pts", typeId: "ct-pts", value: 40 }],
      modifiers: [
        { field: "ct-pts", type: "set", value: 80, conditions: [{ childId: "model", field: "selections", scope: "se-bramble-host", type: "atLeast", value: 4 }] },
        { field: "ct-pts", type: "set", value: 120, conditions: [{ childId: "model", field: "selections", scope: "se-bramble-host", type: "atLeast", value: 7 }] },
      ],
      selectionEntryGroups: [
        {
          name: "3-9 Brambles",
          id: "seg-bramble",
          constraints: [
            { id: "c-min", field: "selections", scope: "parent", type: "min", value: 3 },
            { id: "c-max", field: "selections", scope: "parent", type: "max", value: 9 },
          ],
          selectionEntries: [{ name: "Bramble", id: "se-bramble", type: "model", profiles: [{ id: "p-bramble", name: "Bramble", typeId: "pt-unit", typeName: "Unit", characteristics: [{ name: "M", $text: "6\"" }, { name: "T", $text: "4" }, { name: "Sv", $text: "5+" }, { name: "W", $text: "1" }, { name: "LD", $text: "7+" }, { name: "OC", $text: "1" }] }] }],
        },
      ],
    };
    const cat = { catalogue: { name: "Xenos - Bramble Court", id: "cat-bramble", costTypes: [{ id: "ct-pts", name: "pts" }], selectionEntries: [unit] } };
    const r = parse({ "Xenos - Bramble Court.json": JSON.stringify(cat) });
    expect(r.datasheets!.find((d) => d.name === "Bramble Host")!.composition).toEqual([{ description: "3-9 Brambles", min: 3, max: 9 }]);
    expect(r.priceRules!.find((p) => p.datasheetId === "ds:bramble-court:bramble-host")!.tiers).toEqual([{ models: 3, points: 40 }, { models: 6, points: 80 }, { models: 9, points: 120 }]);
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

  it("skips rows without a name and reads the rest of the catalogue", () => {
    const char = (name: string, text: string) => ({ name, $text: text });
    const unit = {
      name: "Bramble Host",
      id: "se-bramble-host",
      type: "unit",
      profiles: [
        { id: "p-nameless", typeName: "Unit", characteristics: [char("T", "4"), char("Sv", "5+"), char("W", "1")] },
        { id: "p-bramble", name: "Bramble", typeName: "Unit", characteristics: [char("M", '6"'), char("T", "4"), char("Sv", "5+"), char("W", "1"), char("LD", "7+"), char("OC", "1")] },
      ],
      rules: [{ id: "r-nameless", description: "no name" }, { id: "r-thorns", name: "Thorns", description: "Hurts." }],
    };
    const detachment = {
      name: "Detachment",
      id: "se-detachments",
      type: "upgrade",
      selectionEntries: [{ name: "Bramble Tide", id: "se-bramble-tide", type: "upgrade", costs: [{ typeId: "ct-dp", value: 2 }], rules: [{ id: "r-det-nameless", description: "no name" }] }],
    };
    const cat = {
      catalogue: {
        name: "Xenos - Bramble Court",
        id: "cat-bramble",
        costTypes: [{ id: "ct-pts", name: "pts" }, { id: "ct-nameless" }, { id: "ct-dp", name: "Detachment Points" }],
        selectionEntries: [unit, detachment],
      },
    };
    const r = parse({ "Xenos - Bramble Court.json": JSON.stringify(cat) });
    expect(r.datasheets!.map((d) => d.name)).toEqual(["Bramble Host"]);
    expect(r.datasheets![0]!.models!.map((m) => m.name)).toEqual(["Bramble"]);
    expect(r.abilities!.map((a) => a.name)).toEqual(["Thorns"]);
    expect(r.detachments!.map((d) => `${d.name}:${d.dp}`)).toEqual(["Bramble Tide:2"]);
    expect(r.detachments![0]!.ruleAbilityIds).toEqual([]);
    expect(r.warnings).toContain("Xenos - Bramble Court.json: cost type without a name, ignored");
    expect(r.warnings).toContain("profile without a name (skipped): Bramble Host");
    expect(r.warnings).toContain("rule without a name (skipped): Bramble Host");
    expect(r.warnings).toContain("detachment rule without a name (skipped): Bramble Court/Bramble Tide");
  });

  it("ignores non-BSData JSON", () => {
    const r = parse({ "tree.json": '{"sha":"x","tree":[]}', "bad.json": "{" });
    expect(r.warnings).toHaveLength(3);
    expect(r.datasheets).toEqual([]);
  });
});

/**
 * A catalogue of `units` datasheets, each with a unit profile, `abilities` abilities of its own, and
 * the pair of core abilities the reader has to weigh against each other.
 */
function syntheticCatalogue(units: number, abilities: number): Record<string, string> {
  const entries = [];
  for (let u = 0; u < units; u++) {
    const profiles: unknown[] = [
      { id: `p-u${u}`, name: `Synthetic Unit ${u}`, typeName: "Unit", characteristics: [{ name: "M", $text: '6"' }, { name: "T", $text: "4" }, { name: "Sv", $text: "3+" }, { name: "W", $text: "2" }, { name: "LD", $text: "6+" }, { name: "OC", $text: "2" }] },
      { id: `p-u${u}-fnp`, name: "Feel No Pain 5+", typeName: "Abilities", characteristics: [{ name: "Description", $text: "Ignore some of it." }] },
    ];
    for (let a = 0; a < abilities; a++) profiles.push({ id: `p-u${u}-a${a}`, name: `Ability ${u}-${a}`, typeName: "Abilities", characteristics: [{ name: "Description", $text: "Add 1 to the hit roll." }] });
    entries.push({
      name: `Synthetic Unit ${u}`,
      id: `se-u${u}`,
      type: "unit",
      costs: [{ name: "pts", typeId: "ct-pts", value: 100 }],
      categoryLinks: [{ name: "Faction: Synthetics", id: `cl-u${u}`, targetId: "cat-faction", primary: true }],
      profiles,
      rules: [{ id: `r-u${u}`, name: "Feel No Pain", description: "Named without a value." }],
      constraints: [{ id: `cn-u${u}`, field: "selections", scope: "parent", type: "min", value: 5 }],
    });
  }
  const catalogue = { name: "Xenos - Synthetics", id: "cat-synthetics", costTypes: [{ id: "ct-pts", name: "pts" }], categoryEntries: [{ id: "cat-faction", name: "Faction: Synthetics" }], selectionEntries: entries };
  return { "Xenos - Synthetics.json": JSON.stringify({ catalogue }) };
}

describe("a catalogue the size of the shipped snapshot", () => {
  const out = parse(syntheticCatalogue(1700, 2));

  it("reads every datasheet's own abilities, however many came before it", () => {
    expect(out.datasheets).toHaveLength(1700);
    expect(out.abilities!.filter((a) => a.scope === "datasheet")).toHaveLength(1700 * 2);
    // The last datasheet gets two abilities of its own and the valued core ability. The value-less
    // one of the same keyword is dropped, which needs every ability emitted so far to be in reach.
    const last = out.datasheets!.at(-1)!;
    expect(last.abilityIds).toHaveLength(3);
    expect(last.abilityIds).toContain("ab:core:feel-no-pain:5");
    expect(last.abilityIds).toContain("ab:synthetics:synthetic-unit-1699:ability-1699-1");
    expect(last.abilityIds).not.toContain("ab:core:feel-no-pain");
  });
});

describe("the glossary of keyword rules", () => {
  it("reads the game system's shared rules, keyed by the keyword a datasheet prints", () => {
    const byKey = new Map(out.glossary!.map((g) => [g.key, g]));
    expect(byKey.get("SUSTAINED HITS")).toMatchObject({ id: "gl:sustained-hits", name: "Sustained Hits", sourceId: "pub:bsdata:pub-synthetic" });
    expect(byKey.get("ANTI")!.name).toBe("Anti");
    expect(byKey.get("TWIN-LINKED")!.text).toContain("re-roll a failed wound roll");
    // Core abilities are named the same way, so the same lookup reaches them.
    expect(byKey.get("DEEP STRIKE")!.text).toContain("more than 9");
    expect(byKey.get("FEEL NO PAIN")).toBeDefined();
  });

  it("takes the emphasis marks off, drops a rule with no text, and keeps one entry per keyword", () => {
    const gameSystem = {
      name: "Test System",
      id: "gs-test",
      revision: 1,
      costTypes: [{ id: "ct-pts", name: "pts" }],
      sharedRules: [
        { id: "r-1", name: "Sustained Hits 2", description: "The long name arrives first." },
        { id: "r-2", name: "Sustained Hits", description: "A **critical hit** scores ^^X^^ more hits." },
        { id: "r-3", name: "Melta", description: "   " },
        { id: "r-4", name: "Heavy", description: "Add 1 to the hit roll:\n\n\n- when the unit did not move." },
      ],
    };
    const glossary = parse({ "gs.json": JSON.stringify({ gameSystem }) }).glossary!;
    expect(glossary.map((g) => g.key)).toEqual(["SUSTAINED HITS", "HEAVY"]);
    expect(glossary[0]).toMatchObject({ name: "Sustained Hits", text: "A critical hit scores X more hits." });
    expect(glossary[1]!.text).toBe("Add 1 to the hit roll:\n\n- when the unit did not move.");
  });
});
