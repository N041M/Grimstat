import { describe, expect, it } from "vitest";
import type { ScenarioUnit } from "@grimstat/schema";
import type { UnitPresetRecord } from "../db";
import { findPresetByName, newPreset, presetSummary, presetWeaponNames, replacePresetUnit, samePresetName, suggestPresetName } from "./unitPreset";

const unit = (over: Partial<ScenarioUnit> = {}): ScenarioUnit => ({
  name: "Warden Squad",
  keywords: ["INFANTRY"],
  models: [
    { name: "Warden Sergeant", count: 1, T: 4, Sv: 3, W: 2, isCharacter: false, keywords: [] },
    { name: "Warden", count: 9, T: 4, Sv: 3, W: 2, isCharacter: false, keywords: [] },
  ],
  weapons: [
    { name: "Flux carbine", count: 9, kind: "ranged", range: 24, A: "2", skill: 3, S: 5, AP: 1, D: "1", keywords: [], enabled: true },
    { name: "Power fist", count: 1, kind: "melee", range: null, A: "3", skill: 3, S: 8, AP: 2, D: "2", keywords: [], enabled: true },
    { name: "Shock maul", count: 10, kind: "melee", range: null, A: "3", skill: 3, S: 5, AP: 1, D: "1", keywords: [], enabled: false },
    { name: "Ember lance", count: 0, kind: "ranged", range: 12, A: "1", skill: 3, S: 9, AP: 3, D: "3", keywords: [], enabled: true },
  ],
  attached: [],
  effects: [],
  points: 180,
  ...over,
});

const preset = (name: string): UnitPresetRecord => newPreset(name, unit());

describe("naming a preset", () => {
  it("matches names regardless of case and surrounding space", () => {
    expect(samePresetName("My Wardens", "  my wardens ")).toBe(true);
    expect(samePresetName("My Wardens", "My Warden")).toBe(false);
    expect(findPresetByName([preset("My Wardens")], "MY WARDENS")?.name).toBe("My Wardens");
  });

  it("suggests the unit's own name, then numbers it rather than overwriting", () => {
    expect(suggestPresetName(unit(), [])).toBe("Warden Squad");
    expect(suggestPresetName(unit(), [preset("Warden Squad")])).toBe("Warden Squad 2");
    expect(suggestPresetName(unit(), [preset("Warden Squad"), preset("Warden Squad 2")])).toBe("Warden Squad 3");
  });

  it("falls back to the unit's name when the given one is blank", () => {
    expect(newPreset("   ", unit()).name).toBe("Warden Squad");
  });
});

describe("saving a preset", () => {
  it("keeps a copy of the unit rather than a reference to it", () => {
    const u = unit();
    const p = newPreset("Mine", u);
    u.weapons[0]!.count = 99;
    expect(p.unit.weapons[0]!.count).toBe(9);
  });

  it("records nothing about a datasheet for a unit that came from none", () => {
    const p = newPreset("Mine", unit());
    expect(p.datasheetId).toBeUndefined();
    expect(p.factionId).toBeUndefined();
    expect(p.snapshotId).toBeUndefined();
  });

  it("keeps the id and the first-saved date when the unit is replaced", () => {
    const first = newPreset("Mine", unit());
    const later = replacePresetUnit(first, unit({ name: "Changed" }));
    expect(later.id).toBe(first.id);
    expect(later.createdAt).toBe(first.createdAt);
    expect(later.name).toBe("Mine");
    expect(later.unit.name).toBe("Changed");
  });
});

describe("describing a preset", () => {
  it("lists only the weapons that will actually fire, with their counts", () => {
    // Shock maul is switched off and the ember lance is down to none, so neither is carried.
    expect(presetWeaponNames(unit())).toEqual(["9× Flux carbine", "Power fist"]);
  });

  it("counts the models and carries the points through", () => {
    const s = presetSummary(newPreset("Mine", unit()));
    expect(s.models).toBe(10);
    expect(s.points).toBe(180);
    expect(s.weapons).toHaveLength(2);
  });
});
