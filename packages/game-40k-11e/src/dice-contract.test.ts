import { describe, expect, it } from "vitest";
import { DiceExpr, isDiceExpr } from "@grimstat/schema";
import { parseDice, dicePMF, diceMean, mean } from "@grimstat/engine";

/**
 * The schema decides what a weapon's Attacks and Damage may say; the engine has to parse whatever
 * gets through. This is the one place the two meet, so it is the one place the agreement is checked.
 */
describe("dice expressions", () => {
  const accepted = ["3", "0", "D6", "d6", "D3", "2D6", "D3+1", "2D6+2", "D6-1", "2 D 6 + 1", " d3 ", "D", "6"];
  const refused = ["", "   ", "+1", "-1", "+ 2", "D12", "DD", "3+", "abc", "D6 or 3"];

  it("everything the schema accepts, the engine parses", () => {
    for (const s of accepted) {
      expect(DiceExpr.safeParse(s).success, s).toBe(true);
      expect(isDiceExpr(s), s).toBe(true);
      expect(() => parseDice(s), s).not.toThrow();
    }
  });

  it("everything the engine would throw on, the schema refuses", () => {
    for (const s of refused) {
      expect(DiceExpr.safeParse(s).success, s).toBe(false);
      expect(isDiceExpr(s), s).toBe(false);
    }
  });

  it("takes a plain non-negative integer as well as a string", () => {
    expect(DiceExpr.safeParse(2).success).toBe(true);
    expect(DiceExpr.safeParse(-1).success).toBe(false);
  });

  it("diceMean agrees with the distribution, including a negative modifier", () => {
    for (const s of accepted) expect(diceMean(s), s).toBeCloseTo(mean(dicePMF(s)), 9);
  });
});
