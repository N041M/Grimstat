import { describe, expect, it } from "vitest";
import type { ScenarioUnit, ScenarioWeapon } from "@grimstat/schema";
import { arsenalFor, perModel, weaponAttacks } from "./arsenal";

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
