import { describe, expect, it } from "vitest";
import { FAIR_KILL, FAIR_SHARE, GOOD_KILL, GOOD_SHARE, matchupOf } from "./matchup";

describe("matchupOf", () => {
  it("reads the share of the defender's wounds removed", () => {
    expect(matchupOf({ pKill: 0, expectedDamage: 10, defenderWounds: 20 })).toBe("good");
    expect(matchupOf({ pKill: 0, expectedDamage: 5, defenderWounds: 20 })).toBe("fair");
    expect(matchupOf({ pKill: 0, expectedDamage: 4.9, defenderWounds: 20 })).toBe("poor");
    expect(GOOD_SHARE).toBe(0.5);
    expect(FAIR_SHARE).toBe(0.25);
  });

  it("lets the kill chance carry a unit whose average is low", () => {
    // A single model that dies half the time and is untouched the other half: 5 of 10 wounds on
    // average, and a kill one time in two. Either reading makes it good.
    expect(matchupOf({ pKill: 0.5, expectedDamage: 5, defenderWounds: 10 })).toBe("good");
    // A quarter of the wounds on average would be fair, and the kill chance lifts nothing here.
    expect(matchupOf({ pKill: 0.19, expectedDamage: 2.5, defenderWounds: 10 })).toBe("fair");
    expect(matchupOf({ pKill: FAIR_KILL, expectedDamage: 0, defenderWounds: 10 })).toBe("fair");
    expect(matchupOf({ pKill: GOOD_KILL, expectedDamage: 0, defenderWounds: 10 })).toBe("good");
  });

  it("falls back on the kill chance when the defender's wounds are not recorded", () => {
    // A result stored before the wounds were written into it still gets a mark.
    expect(matchupOf({ pKill: 0.6, expectedDamage: 30 })).toBe("good");
    expect(matchupOf({ pKill: 0.3, expectedDamage: 30 })).toBe("fair");
    expect(matchupOf({ pKill: 0.1, expectedDamage: 30 })).toBe("poor");
    expect(matchupOf({ pKill: 0, expectedDamage: 30, defenderWounds: 0 })).toBe("poor");
  });

  it("does not let a rounding error drop a value that sits on the line", () => {
    expect(matchupOf({ pKill: 0, expectedDamage: 0.1 + 0.2, defenderWounds: 0.6 })).toBe("good");
  });
});
