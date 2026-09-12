import { describe, expect, it } from "vitest";
import type { Datasheet, Roster, Snapshot } from "@grimstat/schema";
import { canAddCopy, compositionBounds, describeRevisionChange, diagnosticsForUnit, diffRosters, distributeModelCount, duplicateCap, groupBounds, groupsFromDatasheet, loadoutWargear, moveUnit, newRoster, newRosterUnit, pickerGroupOf, pointsTone, removeUnits, restoreUnits, sectionOf, unitDisplayName, unitIndexFromPath, wargearSummary, wargearSummaryItems, weaponBaseNames, type ModelGroup } from "./roster";
import { decodeRosterPermalink, encodeRosterPermalink, rosterPermalinkUrl, rosterTokenFromHash } from "./rosterPermalink";

const NOW = "2026-09-09T10:00:00.000Z";

function sheet(over: Partial<Datasheet> & Pick<Datasheet, "id" | "name" | "models">): Datasheet {
  return {
    gameSystemId: "wh40k-11e",
    factionId: "f1",
    isLegends: false,
    isCharacter: false,
    isEpicHero: false,
    isBattleline: false,
    isSupport: false,
    keywords: [],
    factionKeywords: [],
    weapons: [],
    abilityIds: [],
    stratagemIds: [],
    leaderTo: [],
    supportTo: [],
    composition: [],
    wargearOptions: [],
    ...over,
  };
}

const weapon = (id: string, name: string, kind: "ranged" | "melee" = "ranged"): Datasheet["weapons"][number] => ({ id, name, kind, range: kind === "ranged" ? 24 : null, A: "1", skill: 3, S: 4, AP: 0, D: "1", keywords: [] });

const squad = sheet({
  id: "ds-squad",
  name: "Warden Squad",
  role: "Battleline",
  isBattleline: true,
  models: [
    { id: "m-sgt", name: "Warden Sergeant", T: 4, Sv: 3, W: 2 },
    { id: "m-trooper", name: "Warden", T: 4, Sv: 3, W: 2 },
  ],
  weapons: [weapon("w1", "Flux carbine"), weapon("w2", "Plasma gun – standard"), weapon("w3", "Plasma gun – supercharge"), weapon("w4", "Shock maul", "melee"), weapon("w5", "Power fist", "melee")],
  composition: [
    { description: "1 Warden Sergeant", min: 1, max: 1 },
    { description: "4-9 Wardens", min: 4, max: 9 },
  ],
  loadout: "Every model is equipped with: flux carbine; shock maul.\nThe Warden Sergeant is also equipped with a power fist.",
});

const captain = sheet({
  id: "ds-captain",
  name: "Warden Captain",
  role: "Characters",
  isCharacter: true,
  models: [{ id: "m-cap", name: "Warden Captain", T: 4, Sv: 3, W: 5 }],
  weapons: [weapon("w6", "Flux pistol"), weapon("w7", "Relic blade", "melee")],
  composition: [{ description: "1 Warden Captain model", min: 1, max: 1 }],
  loadout: "This model is equipped with: flux pistol; relic blade.",
  leaderTo: ["ds-squad"],
  fallbackPoints: 80,
});

const snapshot: Snapshot = {
  id: "snap-1",
  gameSystemId: "wh40k-11e",
  ownerId: "local",
  createdAt: NOW,
  updatedAt: NOW,
  revision: 0,
  sources: [],
  checksum: "x",
  conflicts: [],
  data: {
    gameSystem: { id: "wh40k-11e", name: "Test", edition: "11", costTypes: [] },
    factions: [{ id: "f1", gameSystemId: "wh40k-11e", name: "Ashen Wardens", keywords: [] }],
    publications: [],
    datasheets: [squad, captain],
    abilities: [],
    detachments: [],
    enhancements: [],
    stratagems: [],
    priceRules: [{ datasheetId: "ds-squad", copyRange: { min: 1 }, tiers: [{ models: 5, points: 90 }, { models: 10, points: 180 }] }],
    wargearPrices: [],
  },
};

const groups = (...counts: number[]): ModelGroup[] => counts.map((count, i) => ({ modelProfileId: `p${i}`, count, wargear: [`g${i}`] }));

describe("distributeModelCount", () => {
  it("puts the whole count on a single group", () => {
    expect(distributeModelCount(groups(3), 7).map((g) => g.count)).toEqual([7]);
  });

  it("keeps leading groups and grows the last one", () => {
    expect(distributeModelCount(groups(1, 4), 10).map((g) => g.count)).toEqual([1, 9]);
    expect(distributeModelCount(groups(1, 1, 3), 8).map((g) => g.count)).toEqual([1, 1, 6]);
  });

  it("shrinks the last group first, then trims leading groups down to 1", () => {
    expect(distributeModelCount(groups(1, 9), 5).map((g) => g.count)).toEqual([1, 4]);
    expect(distributeModelCount(groups(3, 2, 4), 4).map((g) => g.count)).toEqual([2, 1, 1]);
  });

  it("never drops below one model per group and tolerates junk targets", () => {
    expect(distributeModelCount(groups(1, 4), 0).map((g) => g.count)).toEqual([1, 1]);
    expect(distributeModelCount(groups(2, 2), Number.NaN).map((g) => g.count)).toEqual([1, 1]);
    expect(distributeModelCount(groups(1), -3).map((g) => g.count)).toEqual([1]);
  });

  it("returns fresh objects and keeps wargear", () => {
    const input = groups(1, 4);
    const out = distributeModelCount(input, 6);
    expect(out).not.toBe(input);
    expect(out[1]).not.toBe(input[1]);
    expect(input[1]!.count).toBe(4);
    expect(out.map((g) => g.wargear)).toEqual([["g0"], ["g1"]]);
    expect(out[0]!.wargear).not.toBe(input[0]!.wargear);
  });

  it("handles an empty group list", () => {
    expect(distributeModelCount([], 5)).toEqual([]);
  });
});

describe("compositionBounds", () => {
  it("sums per-profile composition lines", () => {
    expect(compositionBounds(squad)).toEqual({ min: 5, max: 10 });
  });
  it("uses a single line as-is", () => {
    expect(compositionBounds(captain)).toEqual({ min: 1, max: 1 });
    expect(compositionBounds(sheet({ id: "x", name: "x", models: captain.models, composition: [{ description: "5-10 models", min: 5, max: 10 }] }))).toEqual({ min: 5, max: 10 });
  });
  it("falls back to one model per profile when nothing is known", () => {
    expect(compositionBounds(sheet({ id: "x", name: "x", models: squad.models }))).toEqual({ min: 2, max: undefined });
    expect(compositionBounds(sheet({ id: "y", name: "y", models: captain.models }))).toEqual({ min: 1, max: undefined });
  });
});

describe("loadout-based wargear prefill", () => {
  it("picks weapons whose base name appears in the loadout text, case-insensitively", () => {
    expect(loadoutWargear(squad)).toEqual(["Flux carbine", "Shock maul", "Power fist"]);
    expect(loadoutWargear(captain)).toEqual(["Flux pistol", "Relic blade"]);
  });

  it("matches on the part before the profile separator and de-duplicates multi-profile weapons", () => {
    const ds = sheet({ ...squad, id: "z", loadout: "Equipped with: PLASMA GUN and a shock maul." });
    expect(loadoutWargear(ds)).toEqual(["Plasma gun", "Shock maul"]);
    expect(weaponBaseNames(squad)).toEqual(["Flux carbine", "Plasma gun", "Shock maul", "Power fist"]);
  });

  it("returns nothing without loadout text", () => {
    expect(loadoutWargear(sheet({ ...squad, id: "n", loadout: undefined }))).toEqual([]);
  });

  it("builds model groups at the minimum size with the prefilled wargear", () => {
    const g = groupsFromDatasheet(squad);
    expect(g.map((x) => [x.modelProfileId, x.count])).toEqual([
      ["m-sgt", 1],
      ["m-trooper", 4],
    ]);
    // the sergeant's power fist stays on the sergeant; troopers get only the every-model loadout
    expect(g.map((x) => x.wargear.join("|"))).toEqual(["Flux carbine|Shock maul|Power fist", "Flux carbine|Shock maul"]);
    expect(groupsFromDatasheet(captain)).toEqual([{ modelProfileId: "m-cap", count: 1, wargear: ["Flux pistol", "Relic blade"] }]);
    expect(groupsFromDatasheet(squad, 10).map((x) => x.count)).toEqual([1, 9]);
  });

  it("creates a roster unit with fresh ids", () => {
    const a = newRosterUnit(squad);
    const b = newRosterUnit(squad);
    expect(a.id).not.toBe(b.id);
    expect(a.datasheetId).toBe("ds-squad");
    expect(a.isWarlord).toBe(false);
  });
});

describe("sections", () => {
  const roster = newRoster({ snapshot, factionId: "f1", battleSize: "incursion" });
  it("classifies by flags, role text and keywords", () => {
    expect(sectionOf(captain, roster)).toBe("character");
    expect(sectionOf(squad, roster)).toBe("battleline");
    expect(sectionOf(sheet({ id: "t", name: "t", models: captain.models, role: "Dedicated Transports" }), roster)).toBe("transport");
    expect(sectionOf(sheet({ id: "k", name: "k", models: captain.models, keywords: ["Character"] }), roster)).toBe("character");
    expect(sectionOf(sheet({ id: "v", name: "v", models: captain.models, role: "Vehicles" }), roster)).toBe("other");
    expect(sectionOf(sheet({ id: "a", name: "a", models: captain.models, factionId: "f2" }), roster)).toBe("allied");
    expect(sectionOf(undefined, roster)).toBe("other");
  });
  it("creates rosters with the battle-size limit", () => {
    expect(roster.pointsLimit).toBe(1000);
    expect(roster.name).toBe("Ashen Wardens list");
    expect(roster.snapshotId).toBe("snap-1");
  });
});

describe("diffRosters", () => {
  it("reports added, removed and changed units with points", () => {
    const base = newRoster({ snapshot, factionId: "f1", battleSize: "strike-force" });
    const u1 = { ...newRosterUnit(squad), id: "u1" };
    const u2 = { ...newRosterUnit(captain), id: "u2" };
    const prev: Roster = { ...base, units: [u1, u2] };
    const next: Roster = { ...base, units: [{ ...u1, models: groupsFromDatasheet(squad, 10) }, { ...newRosterUnit(squad), id: "u3" }] };
    const d = diffRosters(prev, next, snapshot);
    expect(d.added.map((x) => [x.name, x.points])).toEqual([["Warden Squad", 90]]);
    expect(d.removed.map((x) => [x.name, x.points])).toEqual([["Warden Captain", 80]]);
    expect(d.changed.map((x) => [x.name, x.before, x.points])).toEqual([["Warden Squad", 90, 180]]);
    expect(d.pointsBefore).toBe(170);
    expect(d.pointsAfter).toBe(270);
  });
  it("flags a wargear-only change even when points stay the same", () => {
    const base = newRoster({ snapshot, factionId: "f1", battleSize: "strike-force" });
    const u1 = { ...newRosterUnit(squad), id: "u1" };
    const next: Roster = { ...base, units: [{ ...u1, models: u1.models.map((g) => ({ ...g, wargear: [] })) }] };
    expect(diffRosters({ ...base, units: [u1] }, next, snapshot).changed).toHaveLength(1);
  });
});

describe("describeRevisionChange", () => {
  const base = newRoster({ snapshot, factionId: "f1", battleSize: "strike-force" });
  const u1 = { ...newRosterUnit(squad), id: "u1" };
  const u2 = { ...newRosterUnit(captain), id: "u2" };
  const prev: Roster = { ...base, units: [u1, u2] };

  it("names the first revision and single unit changes", () => {
    expect(describeRevisionChange(undefined, prev, snapshot)).toEqual({ kind: "created" });
    expect(describeRevisionChange(prev, { ...prev, units: [u1] }, snapshot)).toEqual({ kind: "removed", name: "Warden Captain" });
    expect(describeRevisionChange(prev, { ...prev, units: [u1, u2, { ...newRosterUnit(squad), id: "u3" }] }, snapshot)).toEqual({ kind: "added", name: "Warden Squad" });
    expect(describeRevisionChange(prev, { ...prev, units: [{ ...u1, models: groupsFromDatasheet(squad, 10) }, u2] }, snapshot)).toEqual({ kind: "changed", name: "Warden Squad" });
    expect(describeRevisionChange(prev, { ...prev, units: [] }, snapshot)).toEqual({ kind: "multi", n: 2 });
  });

  it("tells a rename, a settings change and a reorder apart from unit edits", () => {
    expect(describeRevisionChange(prev, { ...prev, name: "Second wave" }, snapshot)).toEqual({ kind: "renamed", name: "Second wave" });
    expect(describeRevisionChange(prev, { ...prev, pointsLimit: 1500 }, snapshot)).toEqual({ kind: "settings" });
    expect(describeRevisionChange(prev, { ...prev, battleSize: "incursion" }, snapshot)).toEqual({ kind: "settings" });
    expect(describeRevisionChange(prev, { ...prev, units: [u2, u1] }, snapshot)).toEqual({ kind: "reordered" });
    expect(describeRevisionChange(prev, { ...prev, detachments: [{ id: "d1", detachmentId: "det-1" }] }, snapshot)).toEqual({ kind: "detachments" });
    expect(describeRevisionChange(prev, { ...prev, notes: "bring glue" }, snapshot)).toEqual({ kind: "other" });
  });

  it("never reports zero changes", () => {
    expect(describeRevisionChange(prev, { ...prev }, snapshot)).toEqual({ kind: "other" });
  });
});

describe("moveUnit", () => {
  const base = newRoster({ snapshot, factionId: "f1", battleSize: "strike-force" });
  const ids = (r: Roster) => r.units.map((u) => u.id);
  const roster: Roster = { ...base, units: ["a", "b", "c", "d"].map((id) => ({ ...newRosterUnit(squad), id })) };

  it("moves by a signed number of places", () => {
    expect(ids(moveUnit(roster, "c", -1))).toEqual(["a", "c", "b", "d"]);
    expect(ids(moveUnit(roster, "a", 2))).toEqual(["b", "c", "a", "d"]);
    expect(ids(moveUnit(roster, "b", -5))).toEqual(["b", "a", "c", "d"]);
    expect(ids(moveUnit(roster, "b", 9))).toEqual(["a", "c", "d", "b"]);
  });

  it("returns the same roster when nothing moves", () => {
    expect(moveUnit(roster, "a", -1)).toBe(roster);
    expect(moveUnit(roster, "d", 1)).toBe(roster);
    expect(moveUnit(roster, "b", 0)).toBe(roster);
    expect(moveUnit(roster, "nope", 1)).toBe(roster);
    expect(moveUnit(roster, "b", Number.NaN)).toBe(roster);
    expect(ids(roster)).toEqual(["a", "b", "c", "d"]);
  });
});

describe("removeUnits / restoreUnits", () => {
  const base = newRoster({ snapshot, factionId: "f1", battleSize: "strike-force" });
  const squadA = { ...newRosterUnit(squad), id: "sqA" };
  const squadB = { ...newRosterUnit(squad), id: "sqB" };
  const leader = { ...newRosterUnit(captain), id: "cap", attachedTo: { unitId: "sqA", role: "leader" as const } };
  const roster: Roster = { ...base, units: [squadA, leader, squadB] };

  it("takes the units out and frees the characters attached to them", () => {
    const { roster: next, removed } = removeUnits(roster, ["sqA"]);
    expect(next.units.map((u) => u.id)).toEqual(["cap", "sqB"]);
    expect(next.units[0]!.attachedTo).toBeUndefined();
    expect(removed).toEqual([{ unit: squadA, index: 0, detached: [{ id: "cap", attachedTo: { unitId: "sqA", role: "leader" } }] }]);
    expect(roster.units).toHaveLength(3);
  });

  it("removes several at once and reports each former index", () => {
    const { roster: next, removed } = removeUnits(roster, ["cap", "sqB"]);
    expect(next.units.map((u) => u.id)).toEqual(["sqA"]);
    expect(removed.map((r) => [r.unit.id, r.index])).toEqual([
      ["cap", 1],
      ["sqB", 2],
    ]);
    expect(removeUnits(roster, ["nope"]).roster).toBe(roster);
  });

  it("puts them back where they were, attachments included", () => {
    const { roster: next, removed } = removeUnits(roster, ["sqA", "sqB"]);
    expect(restoreUnits(next, removed)).toEqual(roster);
    const one = removeUnits(roster, ["sqA"]);
    expect(restoreUnits(one.roster, one.removed)).toEqual(roster);
  });

  it("copes with edits made in between", () => {
    const { roster: next, removed } = removeUnits(roster, ["sqA"]);
    // the list shrank: the former index is clamped
    const shorter = { ...next, units: next.units.filter((u) => u.id !== "sqB") };
    expect(restoreUnits(shorter, removed).units.map((u) => u.id)).toEqual(["sqA", "cap"]);
    // the character attached elsewhere meanwhile: it keeps that attachment
    const moved = { ...next, units: next.units.map((u) => (u.id === "cap" ? { ...u, attachedTo: { unitId: "sqB", role: "leader" as const } } : u)) };
    expect(restoreUnits(moved, removed).units.find((u) => u.id === "cap")?.attachedTo).toEqual({ unitId: "sqB", role: "leader" });
    // the unit is already back: nothing is duplicated
    const back = restoreUnits(next, removed);
    expect(restoreUnits(back, removed).units).toHaveLength(3);
  });
});

describe("diagnostic paths and permalinks", () => {
  it("parses unit paths", () => {
    expect(unitIndexFromPath("/units/3")).toBe(3);
    expect(unitIndexFromPath("/units/0/models")).toBe(0);
    expect(unitIndexFromPath("/detachments/1")).toBeUndefined();
    expect(unitIndexFromPath(undefined)).toBeUndefined();
  });

  it("round-trips a roster through a permalink", () => {
    const roster = { ...newRoster({ snapshot, factionId: "f1", battleSize: "strike-force" }), units: [newRosterUnit(squad)] };
    const url = rosterPermalinkUrl({ roster, snapshotId: "snap-1" }, "https://example.test/");
    expect(url.startsWith("https://example.test/#/armies?r=")).toBe(true);
    const token = rosterTokenFromHash(url.slice(url.indexOf("#")));
    expect(token).toBeDefined();
    const back = decodeRosterPermalink(token!);
    expect(back.roster).toEqual(roster);
    expect(back.snapshotId).toBe("snap-1");
    expect(rosterTokenFromHash("#/armies")).toBeUndefined();
    expect(rosterTokenFromHash("#/armies/abc")).toBeUndefined();
    expect(() => decodeRosterPermalink("garbage")).toThrow();
    expect(() => decodeRosterPermalink(encodeRosterPermalink({ roster: { nope: 1 } as unknown as Roster, snapshotId: "s" }))).toThrow();
  });
});

describe("wargearSummary", () => {
  it("aggregates weapons over model groups in datasheet order with ×N counts", () => {
    const unit = newRosterUnit(squad);
    // 1 Sergeant + 4 Wardens, every model: flux carbine + shock maul; only the sergeant has the power fist.
    unit.models[1] = { ...unit.models[1]!, wargear: ["Flux carbine", "Shock maul"] };
    expect(wargearSummary(unit, squad)).toBe("Flux carbine ×5, Shock maul ×5, Power fist ×1");
  });

  it("drops the ×1 noise on single-model units", () => {
    expect(wargearSummary(newRosterUnit(captain), captain)).toBe("Flux pistol, Relic blade");
  });

  it("lists other wargear after the weapons, prefixed with +count, and de-duplicates case-insensitively", () => {
    const unit = newRosterUnit(squad);
    unit.models[0] = { ...unit.models[0]!, wargear: ["flux carbine", "Banner", "banner"] };
    unit.models[1] = { ...unit.models[1]!, wargear: ["Flux carbine", "Banner", "Shock maul"] };
    const items = wargearSummaryItems(unit, squad);
    expect(items).toEqual([
      { name: "Flux carbine", count: 5, extra: false },
      { name: "Shock maul", count: 4, extra: false },
      { name: "Banner", count: 5, extra: true },
    ]);
    expect(wargearSummary(unit, squad)).toBe("Flux carbine ×5, Shock maul ×4 · +5 Banner");
  });

  it("returns an empty string for a bare unit and tolerates a missing datasheet", () => {
    const unit = { ...newRosterUnit(captain), models: [{ modelProfileId: "m-cap", count: 1, wargear: [] }] };
    expect(wargearSummary(unit, captain)).toBe("");
    expect(wargearSummary({ ...unit, models: [{ modelProfileId: "x", count: 3, wargear: ["Club"] }] }, undefined)).toBe("+3 Club");
  });

  it("uses the custom name when set", () => {
    const unit = newRosterUnit(captain);
    expect(unitDisplayName(unit, captain)).toBe("Warden Captain");
    expect(unitDisplayName({ ...unit, customName: "  " }, captain)).toBe("Warden Captain");
    expect(unitDisplayName({ ...unit, customName: "Old Tomas" }, captain)).toBe("Old Tomas");
    expect(unitDisplayName(unit, undefined)).toBe("ds-captain");
  });
});

describe("duplicateCap / canAddCopy (mirrors the diagnostics rule)", () => {
  const plain = { isEpicHero: false, isBattleline: false };
  const battleline = { isEpicHero: false, isBattleline: true };
  const epic = { isEpicHero: true, isBattleline: true };

  it("uses the battle size figure, doubled for Battleline, one for Epic Heroes", () => {
    expect(duplicateCap(plain, "strike-force")).toEqual({ cap: 3, kind: "standard" });
    expect(duplicateCap(battleline, "strike-force")).toEqual({ cap: 6, kind: "battleline" });
    expect(duplicateCap(epic, "strike-force")).toEqual({ cap: 1, kind: "epicHero" });
    expect(duplicateCap(plain, "incursion").cap).toBe(2);
    expect(duplicateCap(battleline, "onslaught").cap).toBe(8);
    expect(duplicateCap(plain, "combat-patrol").cap).toBe(99);
  });

  it("treats a custom size like Strike Force", () => {
    expect(duplicateCap(plain, "custom").cap).toBe(3);
    expect(duplicateCap(battleline, "custom").cap).toBe(6);
  });

  it("allows copies strictly below the cap", () => {
    expect(canAddCopy(plain, 2, "strike-force")).toBe(true);
    expect(canAddCopy(plain, 3, "strike-force")).toBe(false);
    expect(canAddCopy(epic, 0, "onslaught")).toBe(true);
    expect(canAddCopy(epic, 1, "onslaught")).toBe(false);
    expect(canAddCopy(battleline, 5, "strike-force")).toBe(true);
    expect(canAddCopy(battleline, 6, "strike-force")).toBe(false);
  });
});

describe("pickerGroupOf", () => {
  it("groups by role flags and sends Legends last", () => {
    expect(pickerGroupOf(captain)).toBe("character");
    expect(pickerGroupOf(squad)).toBe("battleline");
    expect(pickerGroupOf(sheet({ id: "t", name: "Truck", role: "Dedicated Transports", models: [{ id: "m", name: "Truck", T: 9, Sv: 3, W: 10 }] }))).toBe("transport");
    expect(pickerGroupOf(sheet({ id: "v", name: "Tank", role: "Vehicles", models: [{ id: "m", name: "Tank", T: 10, Sv: 3, W: 12 }] }))).toBe("other");
    expect(pickerGroupOf({ ...captain, isLegends: true })).toBe("legends");
  });
});

describe("pointsTone", () => {
  it("warns above 90 % and flags anything over the limit", () => {
    expect(pointsTone(0, 2000)).toBe("ok");
    expect(pointsTone(1800, 2000)).toBe("ok");
    expect(pointsTone(1801, 2000)).toBe("warn");
    expect(pointsTone(2000, 2000)).toBe("warn");
    expect(pointsTone(2005, 2000)).toBe("danger");
    expect(pointsTone(5, 0)).toBe("danger");
  });
});

describe("groupBounds", () => {
  it("uses the matching composition line when there is one per group", () => {
    const unit = newRosterUnit(squad);
    expect(groupBounds(squad, unit.models, 0)).toEqual({ min: 1, max: 1 });
    expect(groupBounds(squad, unit.models, 1)).toEqual({ min: 4, max: 9 });
  });

  it("shares the total bounds out when the lines do not match the groups", () => {
    const g = [
      { modelProfileId: "a", count: 2, wargear: [] },
      { modelProfileId: "b", count: 3, wargear: [] },
    ];
    const ds = sheet({ id: "x", name: "Blob", models: [{ id: "a", name: "A", T: 4, Sv: 4, W: 1 }, { id: "b", name: "B", T: 4, Sv: 4, W: 1 }], composition: [{ description: "5-10 models", min: 5, max: 10 }] });
    expect(groupBounds(ds, g, 0)).toEqual({ min: 2, max: 7 });
    expect(groupBounds(ds, g, 1)).toEqual({ min: 3, max: 8 });
    expect(groupBounds(undefined, g, 0)).toEqual({ min: 1, max: undefined });
  });
});

describe("diagnosticsForUnit", () => {
  it("filters by the /units/<index> path", () => {
    const diags = [
      { code: "a", path: "/units/0" },
      { code: "b", path: "/units/1/models" },
      { code: "c" },
      { code: "d", path: "/units/1" },
    ];
    expect(diagnosticsForUnit(diags, 1).map((d) => d.code)).toEqual(["b", "d"]);
    expect(diagnosticsForUnit(diags, 2)).toEqual([]);
  });
});
