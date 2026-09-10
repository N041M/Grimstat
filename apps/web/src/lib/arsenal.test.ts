import { describe, expect, it } from "vitest";
import type { ScenarioUnit, ScenarioWeapon } from "@grimstat/schema";
import { arsenalFor, bySkill, damageTiers, defensiveProfile, perModel, saveForced, weaponAttacks, woundTable } from "./arsenal";

const w = (over: Partial<ScenarioWeapon> & Pick<ScenarioWeapon, "name">): ScenarioWeapon => ({ count: 1, kind: "ranged", range: 24, A: "1", skill: 3, S: 4, AP: 0, D: "1", keywords: [], enabled: true, ...over });

const unit = (name: string, models: number, weapons: ScenarioWeapon[], points?: number): ScenarioUnit => ({
  name,
  keywords: [],
  models: [{ name: "m", count: models, T: 4, Sv: 3, W: 2, isCharacter: false, keywords: [] }],
  weapons,
  effects: [],
  ...(points === undefined ? {} : { points }),
});

describe("weaponAttacks", () => {
  it("multiplies the weapon count by the average of a dice expression", () => {
    expect(weaponAttacks(w({ name: "rifle", count: 10, A: "2" }))).toBe(20);
    expect(weaponAttacks(w({ name: "flamer", count: 2, A: "D6" }))).toBeCloseTo(7, 9);
    expect(weaponAttacks(w({ name: "blade", count: 5, A: "D3+1" }))).toBeCloseTo(15, 9);
  });
});

describe("arsenalFor", () => {
  const army = [
    unit("Squad", 10, [w({ name: "Bolt rifle", count: 10, A: "2", S: 4, AP: 1, D: "1" }), w({ name: "Chainsword", count: 10, kind: "melee", range: null, A: "3", S: 4, AP: 0, D: "1" })], 160),
    unit("Gunners", 3, [w({ name: "Lascannon", count: 3, range: 48, A: "1", S: 12, AP: 3, D: "D6+1", keywords: [{ name: "HEAVY" }] })], 90),
  ];
  const a = arsenalFor(army);

  it("counts shooting and melee attacks separately", () => {
    expect(a.shooting.attacks).toBe(23); // 10 rifles x2 + 3 lascannons x1
    expect(a.melee.attacks).toBe(30);
    expect(a.shooting.weapons).toBe(13);
    expect(a.models).toBe(13);
    expect(a.points).toBe(250);
  });

  it("splits shooting attacks by strength, AP and damage", () => {
    expect(a.shooting.byStrength.map((b) => [b.key, b.attacks])).toEqual([
      ["S4", 20],
      ["S12", 3],
    ]);
    expect(a.shooting.byAp.map((b) => [b.key, b.attacks])).toEqual([
      ["AP-1", 20],
      ["AP-3", 3],
    ]);
    // the label keeps the printed characteristic ("1" and "D6+1"), prefixed once
    expect(a.shooting.byDamage.map((b) => b.key)).toEqual(["D1", "D6+1"]);
  });

  it("averages strength, AP and damage over attacks, not over weapons", () => {
    expect(a.shooting.meanStrength).toBeCloseTo((20 * 4 + 3 * 12) / 23, 9);
    expect(a.shooting.meanAp).toBeCloseTo((20 * 1 + 3 * 3) / 23, 9);
    expect(a.shooting.meanDamage).toBeCloseTo((20 * 1 + 3 * 4.5) / 23, 9);
  });

  it("reports attacks whose profile understates them, so the gap is visible", () => {
    const withKw = arsenalFor([unit("A", 5, [w({ name: "Gun", count: 5, A: "1", keywords: [{ name: "RAPID FIRE", value: 1 }, { name: "ANTI", keyword: "VEHICLE", value: 4 }] })])]);
    // ordered by attacks, then by name so equal counts stay stable
    expect(withKw.shooting.conditional.map((c) => [c.name, c.attacks])).toEqual([
      ["ANTI-VEHICLE", 5],
      ["RAPID FIRE", 5],
    ]);
    expect(withKw.shooting.conditional[0]!.weapons).toEqual(["Gun"]);
  });

  it("counts shooting attacks that reach each range band, cumulatively", () => {
    expect(a.ranges.map((r) => [r.label, r.attacks])).toEqual([
      ['12"', 23],
      ['24"', 23],
      ['36"', 3],
      ['48"', 3],
      ['48"+', 0],
    ]);
  });

  it("ignores disabled weapons and empty units", () => {
    const off = arsenalFor([unit("A", 5, [w({ name: "Gun", count: 5, enabled: false })])]);
    expect(off.shooting.attacks).toBe(0);
    expect(arsenalFor([]).models).toBe(0);
    expect(arsenalFor([]).points).toBeUndefined();
  });
});

describe("perModel", () => {
  it("divides attacks and raw damage by the model count", () => {
    const a = arsenalFor([unit("Squad", 10, [w({ name: "Rifle", count: 10, A: "2", D: "1" }), w({ name: "Blade", count: 10, kind: "melee", range: null, A: "3", D: "2" })])]);
    const p = perModel(a);
    expect(p.shootingAttacks).toBe(2);
    expect(p.meleeAttacks).toBe(3);
    expect(p.shootingDamage).toBe(2);
    expect(p.meleeDamage).toBe(6);
  });

  it("does not divide by zero for an empty army", () => {
    expect(perModel(arsenalFor([])).shootingAttacks).toBe(0);
  });
});

describe("wound table", () => {
  const army = [unit("A", 1, [w({ name: "Bolter", count: 10, A: "1", S: 4 }), w({ name: "Lascannon", count: 2, A: "1", S: 12 })])];

  it("reports the roll each attack needs against every toughness", () => {
    const rows = woundTable(army, "shooting", [4, 8]);
    // S4 vs T4 is 4+, S12 vs T4 is 2+ (twice the toughness)
    expect(rows[0]!.byRoll).toMatchObject({ 2: 2, 4: 10 });
    // S4 vs T8 is 6+ (half or less), S12 vs T8 is 3+
    expect(rows[1]!.byRoll).toMatchObject({ 3: 2, 6: 10 });
    expect(rows[0]!.attacks).toBe(12);
  });

  it("counts attacks wounding on 4+ or better as the comfortable share", () => {
    expect(woundTable(army, "shooting", [4])[0]!.comfortable).toBe(12);
    expect(woundTable(army, "shooting", [8])[0]!.comfortable).toBe(2);
  });
});

describe("skill and saves", () => {
  const army = [unit("A", 1, [w({ name: "Bolter", count: 6, skill: 3, AP: 1 }), w({ name: "Flamer", count: 2, skill: null, AP: 0, keywords: [{ name: "TORRENT" }] }), w({ name: "Plasma", count: 2, skill: 2, AP: 3 })])];

  it("groups attacks by the roll they need to hit, auto-hits first", () => {
    expect(bySkill(army, "shooting")).toEqual([
      { skill: null, attacks: 2 },
      { skill: 2, attacks: 2 },
      { skill: 3, attacks: 6 },
    ]);
  });

  it("reports the save left after AP, and what leaves none", () => {
    const rows = saveForced(army, "shooting", [3, 6]);
    // a 3+ save: AP0 leaves 3+, AP-1 leaves 4+, AP-3 leaves 6+
    expect(rows[0]!.byModified).toEqual({ 3: 2, 4: 6, 6: 2 });
    expect(rows[0]!.noSave).toBe(0);
    // a 6+ save: AP-1 and AP-3 leave nothing
    expect(rows[1]!.noSave).toBe(8);
  });
});

describe("damage tiers and the defensive profile", () => {
  it("separates flat damage from random damage", () => {
    const tiers = damageTiers([unit("A", 1, [w({ name: "a", count: 4, D: "1" }), w({ name: "b", count: 2, D: "2" }), w({ name: "c", count: 1, D: "3" }), w({ name: "d", count: 1, D: "D6" })])], "shooting");
    expect(tiers.map((t) => [t.key, t.attacks])).toEqual([
      ["1", 4],
      ["2", 2],
      ["3+", 1],
      ["dice", 1],
    ]);
    expect(tiers[3]!.meanDamage).toBeCloseTo(3.5, 9);
  });

  it("groups wounds by toughness, save and invulnerable", () => {
    const a: ScenarioUnit = { name: "Squad", keywords: [], effects: [], weapons: [], models: [{ name: "m", count: 5, T: 4, Sv: 3, W: 2, isCharacter: false, keywords: [] }] };
    const b: ScenarioUnit = { name: "Tank", keywords: [], effects: [], weapons: [], models: [{ name: "t", count: 1, T: 11, Sv: 2, InvSv: 5, W: 14, isCharacter: false, keywords: [] }] };
    const rows = defensiveProfile([a, b]);
    expect(rows.map((r) => [r.toughness, r.save, r.invuln, r.models, r.wounds])).toEqual([
      [11, 2, 5, 1, 14],
      [4, 3, null, 5, 10],
    ]);
    expect(rows[1]!.units).toEqual(["Squad"]);
  });
});
