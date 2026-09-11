import { describe, expect, it } from "vitest";
import { loadSyntheticSnapshot } from "@grimstat/snapshot";
import type { Datasheet } from "@grimstat/schema";
import { abilityGroups, ALL_FACTIONS, bestIndices, characteristicCell, characteristicRow, characteristicText, codexFactions, codexGroups, COMPARE_CAP, differs, effectiveFaction, ledBy, maxPoints, minPoints, parseCompareSet, pointsLines, representativeProfile, searchDatasheets, sheetsById, toggleCompare, unitFigures, unitWounds, wargearPrices, weaponGroups } from "./codex";

const snapshot = loadSyntheticSnapshot();
const sheet = (id: string): Datasheet => snapshot.data.datasheets.find((d) => d.id === id)!;
const crusher = sheet("ds:ashen-wardens:ashen-crusher");
const squad = sheet("ds:ashen-wardens:warden-squad");
const captain = sheet("ds:ashen-wardens:warden-captain");
const thornlings = sheet("ds:verdant-swarm:thornlings");
const drake = sheet("ds:verdant-swarm:spine-drake");

describe("browsing the snapshot", () => {
  it("lists only factions that have datasheets, by name, with their counts", () => {
    expect(codexFactions(snapshot)).toEqual([
      { id: "faction:ashen-wardens", name: "Ashen Wardens", count: 3 },
      { id: "faction:verdant-swarm", name: "Verdant Swarm", count: 3 },
    ]);
  });

  it("names a faction the snapshot never recorded by its id", () => {
    const stray = { ...snapshot, data: { ...snapshot.data, factions: [], datasheets: [crusher] } };
    expect(codexFactions(stray)).toEqual([{ id: "faction:ashen-wardens", name: "faction:ashen-wardens", count: 1 }]);
  });

  it("groups one faction's sheets the way the army builder's picker does", () => {
    const groups = codexGroups(snapshot.data.datasheets, "faction:ashen-wardens", "");
    expect(groups.map((g) => [g.group, g.sheets.map((d) => d.name)])).toEqual([
      ["character", ["Warden Captain"]],
      ["battleline", ["Warden Squad"]],
      ["other", ["Ashen Crusher"]],
    ]);
  });

  it("searches every faction on name, role and keyword when no faction is chosen", () => {
    const all = codexGroups(snapshot.data.datasheets, ALL_FACTIONS, "");
    expect(all.flatMap((g) => g.sheets).length).toBe(6);
    expect(codexGroups(snapshot.data.datasheets, "", "monster").flatMap((g) => g.sheets.map((d) => d.name))).toEqual(["Spine Drake"]);
    expect(codexGroups(snapshot.data.datasheets, "", "  CHARACTERS ").flatMap((g) => g.sheets.map((d) => d.name))).toEqual(["Swarm Seer", "Warden Captain"]);
  });

  it("ranks an add-box search by how the name matches and leaves out what is already compared", () => {
    // Starts-with first, then contains; the captain has no "s" in its name and only matches on its role.
    expect(searchDatasheets(snapshot.data.datasheets, "s", []).map((d) => d.name)).toEqual(["Spine Drake", "Swarm Seer", "Ashen Crusher", "Thornlings", "Warden Squad", "Warden Captain"]);
    expect(searchDatasheets(snapshot.data.datasheets, "warden", [squad.id]).map((d) => d.name)).toEqual(["Warden Captain"]);
    expect(searchDatasheets(snapshot.data.datasheets, "   ", [])).toEqual([]);
    expect(searchDatasheets(snapshot.data.datasheets, "e", [], 2)).toHaveLength(2);
  });

  it("settles on a faction: the remembered one, else the open sheet's, else the first", () => {
    const factions = codexFactions(snapshot);
    expect(effectiveFaction(ALL_FACTIONS, factions, squad)).toBe(ALL_FACTIONS);
    expect(effectiveFaction("faction:verdant-swarm", factions, squad)).toBe("faction:verdant-swarm");
    expect(effectiveFaction("faction:gone", factions, squad)).toBe("faction:ashen-wardens");
    expect(effectiveFaction("", factions, undefined)).toBe("faction:ashen-wardens");
    expect(effectiveFaction("", [], undefined)).toBe(ALL_FACTIONS);
  });

  it("resolves compare ids in order and drops the ones the snapshot lacks", () => {
    expect(sheetsById(snapshot, [thornlings.id, "ds:gone", crusher.id]).map((d) => d.name)).toEqual(["Thornlings", "Ashen Crusher"]);
  });
});

describe("the compare set", () => {
  it("adds, removes and refuses past the cap without reordering", () => {
    expect(toggleCompare([], "a")).toEqual(["a"]);
    expect(toggleCompare(["a", "b"], "a")).toEqual(["b"]);
    const full = Array.from({ length: COMPARE_CAP }, (_, i) => `s${i}`);
    expect(toggleCompare(full, "extra")).toEqual(full);
    expect(toggleCompare(full, "s2")).toHaveLength(COMPARE_CAP - 1);
  });

  it("reads a remembered set back only when it is a list of ids, deduplicated and capped", () => {
    expect(parseCompareSet(["a", "a", "b"])).toEqual(["a", "b"]);
    expect(parseCompareSet(Array.from({ length: 20 }, (_, i) => `s${i}`))).toHaveLength(COMPARE_CAP);
    expect(parseCompareSet("a")).toBeUndefined();
    expect(parseCompareSet([1, 2])).toBeUndefined();
  });
});

describe("one sheet", () => {
  it("prices the smallest and the largest size from the first-copy rule", () => {
    expect(minPoints(squad, snapshot)).toBe(90);
    expect(maxPoints(squad, snapshot)).toBe(180);
    expect(minPoints(crusher, snapshot)).toBe(150);
    expect(maxPoints(crusher, snapshot)).toBe(150);
  });

  it("lists every price rule first copies first, tiers by size", () => {
    expect(pointsLines(squad, snapshot)).toEqual([
      { label: "Your 1st To 2nd Units Cost", tiers: [{ models: 5, points: 90 }, { models: 10, points: 180 }] },
      { label: "Your 3rd + Unit Costs", tiers: [{ models: 5, points: 100 }, { models: 10, points: 200 }] },
    ]);
  });

  it("falls back to the sheet's own price, at its minimum size, when there is no rule", () => {
    const bare = { ...snapshot, data: { ...snapshot.data, priceRules: [] } };
    expect(pointsLines(thornlings, bare)).toEqual([{ label: undefined, tiers: [{ models: 10, points: thornlings.fallbackPoints }] }]);
    expect(pointsLines({ ...thornlings, fallbackPoints: undefined }, bare)).toEqual([]);
  });

  it("carries the priced wargear", () => {
    expect(wargearPrices(crusher, snapshot)).toEqual([{ item: "Fusion beamer", points: 10 }]);
    expect(wargearPrices(squad, snapshot)).toEqual([]);
  });

  it("splits weapons by kind in datasheet order", () => {
    expect(weaponGroups(crusher, "ranged").map((g) => g.name)).toEqual(["Vortex cannon", "Fusion beamer", "Twin hail gun"]);
    expect(weaponGroups(crusher, "melee").map((g) => g.name)).toEqual(["Crusher fists"]);
    expect(weaponGroups(crusher, "ranged").every((g) => g.profiles.length === 1 && g.profiles[0]!.label === undefined)).toBe(true);
  });

  it("folds a multi-profile weapon under its name and labels each profile by what differs", () => {
    const plasma = crusher.weapons[0]!;
    const multi: Datasheet = {
      ...crusher,
      weapons: [
        { ...plasma, id: "w1", name: "Plasma gun - standard", groupName: "Plasma gun" },
        { ...plasma, id: "w2", name: "Plasma gun - supercharge", groupName: "Plasma gun" },
        { ...plasma, id: "w3", name: "Bolt rifle – hail of fire" },
        { ...plasma, id: "w4", name: "Bolt rifle" },
        { ...plasma, id: "w5", name: "Odd name", groupName: "Something else" },
      ],
    };
    const groups = weaponGroups(multi, "ranged");
    expect(groups.map((g) => [g.name, g.profiles.map((p) => p.label)])).toEqual([
      ["Plasma gun", ["standard", "supercharge"]],
      ["Bolt rifle", ["hail of fire", undefined]],
      ["Something else", ["Odd name"]],
    ]);
  });

  it("buckets abilities as a datasheet prints them and reports ids the snapshot lacks", () => {
    const { groups, missing } = abilityGroups(crusher, snapshot);
    expect(groups.map((g) => [g.bucket, g.abilities.map((a) => a.name)])).toEqual([
      ["core", ["Deadly Demise D3"]],
      ["datasheet", ["Siege Protocols"]],
      ["wargear", ["Ablative Plating"]],
    ]);
    expect(missing).toEqual([]);
    expect(abilityGroups(captain, snapshot).groups.map((g) => g.bucket)).toEqual(["core", "faction", "datasheet"]);
    expect(abilityGroups({ ...crusher, abilityIds: ["ab:nowhere", ...crusher.abilityIds] }, snapshot).missing).toEqual(["ab:nowhere"]);
  });

  it("knows who can lead a unit", () => {
    expect(ledBy(squad, snapshot).map((d) => d.name)).toEqual(["Warden Captain"]);
    expect(ledBy(captain, snapshot)).toEqual([]);
  });
});

describe("the unit as a whole", () => {
  it("counts the wounds at the smallest size with one of each named model and the rest rank and file", () => {
    // 1 sergeant at W3 + 4 wardens at W2.
    expect(unitWounds(squad)).toBe(11);
    expect(unitWounds(thornlings)).toBe(10);
    expect(unitWounds(crusher)).toBe(12);
  });

  it("stands the unit on its most numerous model, the later one on a tie", () => {
    expect(representativeProfile(squad)?.name).toBe("Warden");
    expect(representativeProfile(crusher)?.name).toBe("Ashen Crusher");
    const pair: Datasheet = { ...squad, composition: [{ description: "1 A", min: 1, max: 1 }, { description: "1 B", min: 1, max: 1 }] };
    expect(representativeProfile(pair)?.name).toBe("Warden");
  });

  it("puts the figures together", () => {
    expect(unitFigures(squad, snapshot)).toEqual({ minModels: 5, maxModels: 10, minPoints: 90, maxPoints: 180, wounds: 11, pointsPerWound: 90 / 11 });
    const unpriced = { ...snapshot, data: { ...snapshot.data, priceRules: [] } };
    expect(unitFigures({ ...crusher, fallbackPoints: undefined }, unpriced).pointsPerWound).toBeUndefined();
  });
});

describe("comparing", () => {
  it("prints a characteristic the way the sheet does", () => {
    expect(characteristicText("M", 6)).toBe('6"');
    expect(characteristicText("Sv", 3)).toBe("3+");
    expect(characteristicText("InvSv", null)).toBe("—");
    expect(characteristicText("W", 12)).toBe("12");
  });

  it("joins the distinct values of a sheet's profiles", () => {
    expect(characteristicCell(squad, "W")).toBe("3 / 2");
    expect(characteristicCell(squad, "T")).toBe("5");
    expect(characteristicCell(crusher, "InvSv")).toBe("—");
  });

  it("marks the best column, never a missing value, and nobody when all agree", () => {
    expect(bestIndices([5, 10, 3], "higher")).toEqual([1]);
    expect(bestIndices([3, 2, 2], "lower")).toEqual([1, 2]);
    expect(bestIndices([null, 4, null], "lower")).toEqual([]);
    expect(bestIndices([null, 4, 5], "lower")).toEqual([1]);
    expect(bestIndices([4, 4], "higher")).toEqual([]);
    expect(bestIndices([], "higher")).toEqual([]);
  });

  it("tells rows that differ from rows that do not", () => {
    expect(differs(["2", "2 "])).toBe(false);
    expect(differs(["2", "3"])).toBe(true);
    expect(differs(["2"])).toBe(false);
  });

  it("builds a characteristic row on the representative model", () => {
    const row = characteristicRow([squad, thornlings, drake], { key: "T", better: "higher" });
    expect(row).toEqual({ key: "T", cells: ["5", "3", "11"], best: [2], differs: true });
    // The squad's representative is the Warden at W2, not the sergeant at W3.
    expect(characteristicRow([squad, crusher], { key: "W", better: "higher" })).toEqual({ key: "W", cells: ["3 / 2", "12"], best: [1], differs: true });
    expect(characteristicRow([squad, captain], { key: "T", better: "higher" }).best).toEqual([]);
    expect(characteristicRow([squad, captain], { key: "InvSv", better: "lower" })).toEqual({ key: "InvSv", cells: ["—", "4+"], best: [], differs: true });
  });
});
