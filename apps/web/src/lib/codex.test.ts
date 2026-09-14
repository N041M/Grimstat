import { describe, expect, it } from "vitest";
import { loadSyntheticSnapshot } from "@grimstat/snapshot";
import type { Datasheet } from "@grimstat/schema";
import { abilityGroups, ALL_FACTIONS, anyFilter, bestIndices, characteristicCell, characteristicRow, characteristicText, codexFactions, codexGroups, codexKeywords, COMPARE_CAP, differs, effectiveFaction, filterCount, ledBy, maxPoints, minPoints, NO_FILTERS, parseCompareSet, parseFilters, passesFilters, pointsLines, representativeProfile, searchDatasheets, sheetsById, sheetType, shownGroups, toggleCompare, unitFigures, unitWounds, wargearPrices, weaponGroups, type CodexFilters } from "./codex";

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
      { id: "faction:ashen-wardens", name: "Ashen Wardens", count: 5 },
      { id: "faction:verdant-swarm", name: "Verdant Swarm", count: 3 },
    ]);
  });

  it("names a faction the snapshot never recorded by its id", () => {
    const stray = { ...snapshot, data: { ...snapshot.data, factions: [], datasheets: [crusher] } };
    expect(codexFactions(stray)).toEqual([{ id: "faction:ashen-wardens", name: "faction:ashen-wardens", count: 1 }]);
  });

  it("groups one faction's sheets the way the army builder's picker does", () => {
    const groups = codexGroups(snapshot, "faction:ashen-wardens", "");
    expect(groups.map((g) => [g.group, g.sheets.map((d) => d.name)])).toEqual([
      ["character", ["Crusher Pilot", "Warden Captain"]],
      ["battleline", ["Ember Skirmishers", "Warden Squad"]],
      ["other", ["Ashen Crusher"]],
    ]);
  });

  it("searches every faction on name, role and keyword when no faction is chosen", () => {
    const all = codexGroups(snapshot, ALL_FACTIONS, "");
    expect(all.flatMap((g) => g.sheets).length).toBe(8);
    expect(codexGroups(snapshot, "", "monster").flatMap((g) => g.sheets.map((d) => d.name))).toEqual(["Spine Drake"]);
    expect(codexGroups(snapshot, "", "  CHARACTERS ").flatMap((g) => g.sheets.map((d) => d.name))).toEqual(["Crusher Pilot", "Swarm Seer", "Warden Captain"]);
  });

  it("ranks an add-box search by how the name matches and leaves out what is already compared", () => {
    // Starts-with first, then contains; the captain has no "s" in its name and only matches on its role.
    expect(searchDatasheets(snapshot.data.datasheets, "s", []).map((d) => d.name)).toEqual(["Spine Drake", "Swarm Seer", "Ashen Crusher", "Crusher Pilot", "Ember Skirmishers", "Thornlings", "Warden Squad", "Warden Captain"]);
    expect(searchDatasheets(snapshot.data.datasheets, "warden", [squad.id]).map((d) => d.name)).toEqual(["Warden Captain"]);
    expect(searchDatasheets(snapshot.data.datasheets, "   ", [])).toEqual([]);
    expect(searchDatasheets(snapshot.data.datasheets, "e", [], 2)).toHaveLength(2);
  });

  it("settles on a faction: the remembered one, else the open sheet's, else every faction", () => {
    const factions = codexFactions(snapshot);
    expect(effectiveFaction(ALL_FACTIONS, factions, squad)).toBe(ALL_FACTIONS);
    expect(effectiveFaction("faction:verdant-swarm", factions, squad)).toBe("faction:verdant-swarm");
    expect(effectiveFaction("faction:gone", factions, squad)).toBe("faction:ashen-wardens");
    expect(effectiveFaction("", factions, undefined)).toBe(ALL_FACTIONS);
    expect(effectiveFaction("", [], undefined)).toBe(ALL_FACTIONS);
  });

  it("draws a batch of the groups at a time, each still saying how many it holds", () => {
    const groups = codexGroups(snapshot, ALL_FACTIONS, "");
    expect(groups.map((g) => [g.group, g.sheets.length])).toEqual([
      ["character", 3],
      ["battleline", 3],
      ["other", 2],
    ]);
    // Three sheets in is halfway through the second group: the third group is not drawn at all.
    expect(shownGroups(groups, 3).map((g) => [g.group, g.sheets.map((d) => d.name), g.total])).toEqual([
      ["character", ["Crusher Pilot", "Swarm Seer", "Warden Captain"], 3],
    ]);
    expect(shownGroups(groups, 0)).toEqual([]);
    expect(shownGroups(groups, 99).flatMap((g) => g.sheets)).toHaveLength(8);
    expect(shownGroups([], 10)).toEqual([]);
  });

  it("resolves compare ids in order and drops the ones the snapshot lacks", () => {
    expect(sheetsById(snapshot, [thornlings.id, "ds:gone", crusher.id]).map((d) => d.name)).toEqual(["Thornlings", "Ashen Crusher"]);
  });
});

describe("the filters", () => {
  const f = (part: Partial<CodexFilters> = {}): CodexFilters => ({ ...NO_FILTERS, ...part });
  const names = (part: Partial<CodexFilters>) =>
    codexGroups(snapshot, ALL_FACTIONS, "", f(part))
      .flatMap((g) => g.sheets.map((d) => d.name))
      .sort();

  it("tells what a sheet is without letting Legends stand in for it", () => {
    expect(sheetType(captain)).toBe("character");
    expect(sheetType(squad)).toBe("battleline");
    expect(sheetType(crusher)).toBe("other");
    // A Legends character is still a character, so a search for characters finds it.
    expect(sheetType({ ...captain, isLegends: true })).toBe("character");
    expect(sheetType({ ...crusher, keywords: [...crusher.keywords, "DEDICATED TRANSPORT"] })).toBe("transport");
    expect(sheetType({ ...crusher, role: "Fortifications" })).toBe("fortification");
  });

  it("filters on what the unit is", () => {
    expect(names({ type: "character" })).toEqual(["Crusher Pilot", "Swarm Seer", "Warden Captain"]);
    expect(names({ type: "battleline" })).toEqual(["Ember Skirmishers", "Thornlings", "Warden Squad"]);
    expect(names({ type: "other" })).toEqual(["Ashen Crusher", "Spine Drake"]);
    expect(names({ type: "any" })).toHaveLength(8);
  });

  it("leaves Legends out when asked, and only then", () => {
    const legendary = { ...snapshot, data: { ...snapshot.data, datasheets: snapshot.data.datasheets.map((d) => (d.id === crusher.id ? { ...d, isLegends: true } : d)) } };
    const shown = (legends: boolean) =>
      codexGroups(legendary, ALL_FACTIONS, "", f({ legends }))
        .flatMap((g) => g.sheets.map((d) => d.name))
        .sort();
    expect(shown(true)).toContain("Ashen Crusher");
    expect(shown(false)).not.toContain("Ashen Crusher");
    expect(shown(false)).toHaveLength(7);
  });

  it("wants every chosen keyword, on the sheet or on its faction", () => {
    expect(names({ keywords: ["INFANTRY"] })).toEqual(["Crusher Pilot", "Ember Skirmishers", "Swarm Seer", "Thornlings", "Warden Captain", "Warden Squad"]);
    expect(names({ keywords: ["INFANTRY", "PSYKER"] })).toEqual(["Swarm Seer"]);
    expect(names({ keywords: ["INFANTRY", "MONSTER"] })).toEqual([]);
    expect(names({ keywords: ["ASHEN WARDENS"] })).toEqual(["Ashen Crusher", "Crusher Pilot", "Ember Skirmishers", "Warden Captain", "Warden Squad"]);
  });

  it("filters on points at the smallest legal size", () => {
    // the Crusher Pilot costs nothing and has no points line of its own, so a points filter passes it by
    expect(names({ maxPoints: 80 })).toEqual(["Ember Skirmishers", "Swarm Seer", "Thornlings", "Warden Captain"]);
    expect(names({ minPoints: 150 })).toEqual(["Ashen Crusher", "Spine Drake"]);
    expect(names({ minPoints: 80, maxPoints: 90 })).toEqual(["Warden Captain", "Warden Squad"]);
  });

  it("filters on the representative model's characteristics", () => {
    expect(names({ minT: 10 })).toEqual(["Ashen Crusher", "Spine Drake"]);
    expect(names({ minW: 5 })).toEqual(["Ashen Crusher", "Spine Drake", "Warden Captain"]);
    expect(names({ maxSv: 3 })).toEqual(["Ashen Crusher", "Spine Drake", "Warden Captain", "Warden Squad"]);
    expect(names({ minM: 8 })).toEqual(["Ashen Crusher", "Spine Drake", "Thornlings"]);
    expect(names({ minOC: 3 })).toEqual(["Ashen Crusher", "Spine Drake"]);
    expect(names({ invuln: true })).toEqual(["Swarm Seer", "Warden Captain"]);
  });

  it("asks for all of them at once", () => {
    expect(names({ type: "character", keywords: ["INFANTRY"], maxPoints: 75, invuln: true })).toEqual(["Swarm Seer"]);
  });

  it("counts how many filters are on", () => {
    expect(filterCount(NO_FILTERS)).toBe(0);
    expect(anyFilter(NO_FILTERS)).toBe(false);
    expect(filterCount(f({ type: "character", legends: false, keywords: ["INFANTRY", "FLY"], minPoints: 10, invuln: true }))).toBe(6);
  });

  it("reads a remembered set back, and shrugs off one that makes no sense", () => {
    const stored = { type: "battleline", legends: false, keywords: ["FLY", "FLY", 7], invuln: true, minT: 5, maxSv: "3" };
    expect(parseFilters(stored)).toEqual({ ...NO_FILTERS, type: "battleline", legends: false, keywords: ["FLY"], invuln: true, minT: 5, maxSv: undefined, minPoints: undefined, maxPoints: undefined, minM: undefined, minW: undefined, minOC: undefined });
    expect(parseFilters({ type: "nonsense" })?.type).toBe("any");
    expect(parseFilters(null)).toBeUndefined();
    expect(parseFilters("no")).toBeUndefined();
  });

  it("offers the keywords of the faction in view, by name, with how many carry each", () => {
    const all = codexKeywords(snapshot.data.datasheets, ALL_FACTIONS);
    const names = all.map((k) => k.name);
    expect(names).toContain("PSYKER");
    expect(names).toContain("ASHEN WARDENS");
    expect([...names]).toEqual([...names].sort((a, b) => a.localeCompare(b)));
    expect(all.find((k) => k.name === "INFANTRY")?.count).toBe(6);
    expect(all.find((k) => k.name === "ASHEN WARDENS")?.count).toBe(5);
    expect(codexKeywords(snapshot.data.datasheets, "faction:verdant-swarm").map((k) => k.name)).not.toContain("WALKER");
  });

  it("keeps a sheet with no profile out of a question about one", () => {
    expect(passesFilters({ ...crusher, models: [] }, snapshot, f({ minT: 1 }))).toBe(false);
    expect(passesFilters({ ...crusher, models: [] }, snapshot, NO_FILTERS)).toBe(true);
  });
});

describe("the compare set", () => {
  it("adds, removes and refuses past the cap without reordering", () => {
    expect(toggleCompare([], "a")).toEqual(["a"]);
    expect(toggleCompare(["a", "b"], "a")).toEqual(["b"]);
    const full = Array.from({ length: COMPARE_CAP }, (_, i) => `s${i}`);
    expect(toggleCompare(full, "extra")).toEqual(full);
    // The same array back, so the screen can tell that nothing happened and store nothing.
    expect(toggleCompare(full, "extra")).toBe(full);
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
    expect(wargearPrices(squad, snapshot)).toEqual([{ item: "Ash Sentry", points: 20 }, { item: "Warden Champion", points: 15 }]);
    expect(wargearPrices(thornlings, snapshot)).toEqual([]);
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
