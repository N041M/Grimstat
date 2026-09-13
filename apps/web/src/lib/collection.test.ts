import { describe, expect, it } from "vitest";
import type { Datasheet, Roster } from "@grimstat/schema";
import type { CollectionEntryRecord } from "../db";
import { addModels, asCount, byFaction, canField, collectionTotals, coverage, entryFor, rosterNeeds, tidyEntry } from "./collection";

const NOW = "2026-09-13T10:00:00.000Z";

const sheet = (id: string, name: string, factionId = "f1"): Datasheet => ({
  id,
  name,
  factionId,
  gameSystemId: "wh40k-11e",
  isLegends: false,
  isCharacter: false,
  isEpicHero: false,
  isBattleline: false,
  isSupport: false,
  keywords: [],
  factionKeywords: [],
  models: [{ id: `${id}-m`, name, T: 4, Sv: 3, W: 2 }],
  weapons: [],
  abilityIds: [],
  stratagemIds: [],
  leaderTo: [],
  supportTo: [],
  composition: [],
  wargearOptions: [],
});

const entry = (id: string, owned: number, painted = 0, factionId = "f1"): CollectionEntryRecord => ({ id, name: id, factionId, factionName: factionId === "f1" ? "Wardens" : "Aggressors", owned, painted, updatedAt: NOW });

const roster = (units: { datasheetId: string; counts: number[] }[]): Roster =>
  ({
    id: "r1",
    name: "Test army",
    gameSystemId: "wh40k-11e",
    snapshotId: "s1",
    factionId: "f1",
    battleSize: "strike-force",
    pointsLimit: 2000,
    detachments: [],
    ownerId: "local",
    createdAt: NOW,
    updatedAt: NOW,
    revision: 1,
    units: units.map((u, i) => ({ id: `u${i}`, datasheetId: u.datasheetId, models: u.counts.map((count, g) => ({ modelProfileId: `p${g}`, count, wargear: [] })), isWarlord: false })),
  }) as Roster;

describe("counts", () => {
  it("keeps a count whole, positive and a number", () => {
    expect(asCount(3.4)).toBe(3);
    expect(asCount(-2)).toBe(0);
    expect(asCount(Number.NaN)).toBe(0);
  });

  it("never records more painted models than owned ones", () => {
    expect(tidyEntry({ owned: 5, painted: 9 })).toEqual({ owned: 5, painted: 5 });
    expect(tidyEntry({ owned: 10, painted: 4 })).toEqual({ owned: 10, painted: 4 });
  });

  it("totals the shelf: datasheets, models, painted and the factions they belong to", () => {
    const totals = collectionTotals([entry("a", 10, 5), entry("b", 5, 5), entry("c", 3, 0, "f2")]);
    expect(totals).toEqual({ datasheets: 3, models: 18, painted: 10, factions: 2, paintedFraction: 10 / 18 });
    // An empty shelf is 0% painted rather than not a number.
    expect(collectionTotals([]).paintedFraction).toBe(0);
  });
});

describe("adding models", () => {
  it("opens an entry with what the box holds and nothing painted", () => {
    const made = entryFor(sheet("ds1", "Warden Squad"), "Wardens", 10, NOW);
    expect(made).toEqual({ id: "ds1", name: "Warden Squad", factionId: "f1", factionName: "Wardens", owned: 10, painted: 0, updatedAt: NOW });
  });

  it("adds a second box to the first rather than replacing it, and keeps what is painted", () => {
    const first = addModels(undefined, sheet("ds1", "Warden Squad"), "Wardens", 10, NOW);
    const painted = { ...first, painted: 6 };
    const second = addModels(painted, sheet("ds1", "Warden Squad"), "Wardens", 10, NOW);
    expect(second.owned).toBe(20);
    expect(second.painted).toBe(6);
  });

  it("takes the datasheet's name as it now reads, so a renamed sheet stops reading under the old one", () => {
    const had = entry("ds1", 10);
    expect(addModels(had, sheet("ds1", "Warden Squad Mk II"), "Wardens", 0, NOW).name).toBe("Warden Squad Mk II");
  });

  it("groups by faction, both lists in name order", () => {
    const groups = byFaction([entry("zeta", 1), entry("alpha", 1), entry("beta", 1, 0, "f2")]);
    expect(groups.map((g) => g.factionName)).toEqual(["Aggressors", "Wardens"]);
    expect(groups[1]!.entries.map((e) => e.name)).toEqual(["alpha", "zeta"]);
  });
});

describe("what an army asks for", () => {
  const names = new Map([
    ["ds1", "Warden Squad"],
    ["ds2", "Captain"],
  ]);
  const nameOf = (id: string) => names.get(id);

  it("counts every model of a datasheet across the units that field it", () => {
    const needs = rosterNeeds(roster([{ datasheetId: "ds1", counts: [1, 9] }, { datasheetId: "ds2", counts: [1] }, { datasheetId: "ds1", counts: [5] }]), nameOf);
    expect(needs).toEqual([
      { datasheetId: "ds1", name: "Warden Squad", models: 15, units: 2 },
      { datasheetId: "ds2", name: "Captain", models: 1, units: 1 },
    ]);
  });

  it("falls back to the datasheet's id when the snapshot no longer names it", () => {
    expect(rosterNeeds(roster([{ datasheetId: "gone", counts: [3] }]), nameOf)[0]!.name).toBe("gone");
  });
});

describe("coverage", () => {
  const needs = rosterNeeds(roster([{ datasheetId: "ds1", counts: [10] }, { datasheetId: "ds2", counts: [1] }]), (id) => id);

  it("says an army can be fielded when every model it asks for is owned", () => {
    const out = coverage([entry("ds1", 10), entry("ds2", 3)], needs);
    expect(out.ok).toBe(true);
    expect(out.missing).toHaveLength(0);
    // Spare models are not counted as covering more than the army asks for.
    expect(out.owned).toBe(11);
    expect(out.models).toBe(11);
  });

  it("names what is short, and by how many", () => {
    const out = coverage([entry("ds1", 6)], needs);
    expect(out.ok).toBe(false);
    expect(out.missing.map((m) => [m.datasheetId, m.short])).toEqual([
      ["ds1", 4],
      ["ds2", 1],
    ]);
    expect(out.owned).toBe(6);
  });

  it("does not call an empty army one you can field", () => {
    const nothing = coverage([entry("ds1", 10)], []);
    // Nothing is missing from an army with nothing in it, but there is nothing to put on a table.
    expect(nothing.ok).toBe(true);
    expect(canField(nothing)).toBe(false);
    expect(canField(coverage([entry("ds1", 10), entry("ds2", 1)], needs))).toBe(true);
  });

  it("treats a datasheet the collection has never heard of as none owned", () => {
    const out = coverage([], needs);
    expect(out.ok).toBe(false);
    expect(out.needs.every((n) => n.owned === 0)).toBe(true);
    expect(out.owned).toBe(0);
  });
});
