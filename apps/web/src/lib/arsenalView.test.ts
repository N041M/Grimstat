import { describe, expect, it } from "vitest";
import type { ScenarioUnit, ScenarioWeapon } from "@grimstat/schema";
import { arsenalFor } from "./arsenal";
import { ARSENAL_PHASES, attacksLabel, mergeBuckets, mergeKeywords, parseArsenalPhase, peak, phaseView, saveLabel, shareOf } from "./arsenalView";

const w = (over: Partial<ScenarioWeapon> & Pick<ScenarioWeapon, "name">): ScenarioWeapon => ({ count: 1, kind: "ranged", range: 24, A: "1", skill: 3, S: 4, AP: 0, D: "1", keywords: [], enabled: true, ...over });

const unit = (name: string, models: number, weapons: ScenarioWeapon[]): ScenarioUnit => ({
  name,
  keywords: [],
  models: [{ name: "m", count: models, T: 4, Sv: 3, W: 2, isCharacter: false, keywords: [] }],
  weapons,
  effects: [],
});

describe("parseArsenalPhase", () => {
  it("accepts the three switch positions and nothing else", () => {
    for (const p of ARSENAL_PHASES) expect(parseArsenalPhase(p)).toBe(p);
    expect(parseArsenalPhase("psychic")).toBeUndefined();
    expect(parseArsenalPhase(undefined)).toBeUndefined();
    expect(parseArsenalPhase(3)).toBeUndefined();
  });
});

describe("mergeBuckets", () => {
  it("sums shared keys and keeps the axis in its own order", () => {
    const a = [
      { key: "S4", order: 4, attacks: 20 },
      { key: "S12", order: 12, attacks: 3 },
    ];
    const b = [
      { key: "S5", order: 5, attacks: 6 },
      { key: "S4", order: 4, attacks: 10 },
    ];
    expect(mergeBuckets(a, b)).toEqual([
      { key: "S4", order: 4, attacks: 30 },
      { key: "S5", order: 5, attacks: 6 },
      { key: "S12", order: 12, attacks: 3 },
    ]);
  });

  it("does not mutate either input", () => {
    const a = [{ key: "S4", order: 4, attacks: 2 }];
    const b = [{ key: "S4", order: 4, attacks: 5 }];
    mergeBuckets(a, b);
    expect(a[0]!.attacks).toBe(2);
    expect(b[0]!.attacks).toBe(5);
  });
});

describe("mergeKeywords", () => {
  it("sums attacks, unions the weapons and orders by attacks", () => {
    const merged = mergeKeywords(
      [{ name: "MELTA-2", attacks: 4, weapons: ["Melta"] }],
      [
        { name: "MELTA-2", attacks: 2, weapons: ["Melta", "Combi-melta"] },
        { name: "LANCE", attacks: 9, weapons: ["Spear"] },
      ],
    );
    expect(merged.map((k) => [k.name, k.attacks])).toEqual([
      ["LANCE", 9],
      ["MELTA-2", 6],
    ]);
    expect(merged.find((k) => k.name === "MELTA-2")!.weapons).toEqual(["Melta", "Combi-melta"]);
  });
});

describe("phaseView", () => {
  const army = [
    unit("Squad", 10, [
      w({ name: "Bolt rifle", count: 10, A: "2", S: 4, AP: 1, D: "1" }),
      w({ name: "Chainsword", count: 10, kind: "melee", range: null, A: "3", S: 4, AP: 0, D: "1", keywords: [{ name: "SUSTAINED HITS", value: 1 }] }),
    ]),
    unit("Gunners", 3, [w({ name: "Lascannon", count: 3, range: 48, A: "1", S: 12, AP: 3, D: "D6+1", keywords: [{ name: "HEAVY" }] })]),
  ];
  const a = arsenalFor(army);

  it("hands back the summary's own half for a single phase", () => {
    expect(phaseView(a, "shooting")).toBe(a.shooting);
    expect(phaseView(a, "melee")).toBe(a.melee);
  });

  it("adds the two phases together for both", () => {
    const both = phaseView(a, "both");
    expect(both.attacks).toBe(a.shooting.attacks + a.melee.attacks);
    expect(both.weapons).toBe(a.shooting.weapons + a.melee.weapons);
    expect(both.byStrength.map((b) => [b.key, b.attacks])).toEqual([
      ["S4", 50], // 20 shooting + 30 melee
      ["S12", 3],
    ]);
    expect(both.conditional.map((k) => k.name)).toEqual(["SUSTAINED HITS", "HEAVY"]);
  });

  it("averages the characteristics over attacks, not over the two phases", () => {
    const both = phaseView(a, "both");
    const n = a.shooting.attacks + a.melee.attacks;
    expect(both.meanStrength).toBeCloseTo((a.shooting.meanStrength * a.shooting.attacks + a.melee.meanStrength * a.melee.attacks) / n, 9);
    expect(both.meanDamage).toBeCloseTo((a.shooting.meanDamage * a.shooting.attacks + a.melee.meanDamage * a.melee.attacks) / n, 9);
  });

  it("reports zeroes rather than NaN for an army with nothing to shoot with", () => {
    const both = phaseView(arsenalFor([]), "both");
    expect(both.attacks).toBe(0);
    expect(both.meanStrength).toBe(0);
    expect(both.meanAp).toBe(0);
    expect(both.byStrength).toEqual([]);
  });
});

describe("attacksLabel", () => {
  it("shows a decimal only when the dice average has one", () => {
    expect(attacksLabel(20)).toBe("20");
    expect(attacksLabel(10.5)).toBe("10.5");
    expect(attacksLabel(7.04)).toBe("7");
    expect(attacksLabel(0)).toBe("0");
    expect(attacksLabel(undefined)).toBe("–");
    expect(attacksLabel(Number.NaN)).toBe("–");
  });
});

describe("saveLabel", () => {
  it("labels a save that survives AP and gives up on one that does not", () => {
    expect(saveLabel(2)).toBe("2+");
    expect(saveLabel(6)).toBe("6+");
    expect(saveLabel(7)).toBeNull();
  });
});

describe("shareOf and peak", () => {
  it("clamps a share and stays safe on an empty total", () => {
    expect(shareOf(5, 20)).toBe(0.25);
    expect(shareOf(5, 0)).toBe(0);
    expect(shareOf(30, 20)).toBe(1);
  });

  it("finds the tallest bar, ignoring nothing-at-all", () => {
    expect(peak([1, 9, 4])).toBe(9);
    expect(peak([])).toBe(0);
    expect(peak([Number.NaN, 2])).toBe(2);
  });
});
