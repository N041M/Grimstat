import { describe, expect, it } from "vitest";
import type { Datasheet, Roster, Snapshot } from "@grimstat/schema";
import { compositionBounds, diffRosters, distributeModelCount, groupsFromDatasheet, loadoutWargear, newRoster, newRosterUnit, sectionOf, unitIndexFromPath, weaponBaseNames, type ModelGroup } from "./roster";
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
    expect(g.every((x) => x.wargear.join("|") === "Flux carbine|Shock maul|Power fist")).toBe(true);
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
