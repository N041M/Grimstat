import { describe, expect, it } from "vitest";
import type { ScenarioUnit, SimResult } from "@grimstat/schema";
import { runScenario } from "@grimstat/game-40k-11e";
import { applyDamage, atStrength, newOpponentUnit, NEW_UNIT_STATE, opponentScenarioUnit, woundsLeft } from "../../lib/game";
import { defaultContext, newScenario } from "../../lib/scenario";
import { pAtLeast } from "./OddsPanel";

/**
 * The panel prints two figures for the same shot: "Finish it" is P(damage >= the wounds the target
 * has left), read off the distribution, and "Destroyed" is the solver's own chance of killing it.
 * A target down to one model makes them the same event, so they have to read the same. They only do
 * if the unit reaches the solver carrying the wounds it has already taken.
 */

const gunners: ScenarioUnit = {
  name: "Lascannon team",
  keywords: [],
  models: [{ name: "Gunner", count: 12, T: 3, Sv: 5, W: 1, isCharacter: false, keywords: [] }],
  weapons: [{ name: "Lascannon", count: 12, kind: "ranged", range: 48, A: "1", skill: 3, S: 12, AP: -3, D: "D6+1", keywords: [], enabled: true }],
  attached: [],
  effects: [],
};

const solve = (defender: ScenarioUnit): SimResult => runScenario(newScenario({ attacker: gunners, defender, context: { ...defaultContext(), rangeBand: "half" } }));

describe("odds against a tracked unit", () => {
  // A 14-wound tank with 13 wounds already on it: one wound left, and one model, so every figure on
  // the panel is about the same event.
  const tank = { ...newOpponentUnit("Enemy tank"), id: "e1", models: 1, T: 11, Sv: 2, W: 14 };
  const state = applyDamage(NEW_UNIT_STATE, 13, tank.W, tank.models);
  const current = () => atStrength(opponentScenarioUnit(tank, state), state, tank.models);

  it("hands the solver the wounds the target has left", () => {
    expect(current().models).toEqual([expect.objectContaining({ count: 1, W: 1 })]);
  });

  it("reads the same chance for finishing the target and for destroying it", () => {
    const left = woundsLeft(state, tank.W, tank.models);
    expect(left).toBe(1);
    const result = solve(current());
    expect(pAtLeast(result.damagePMF, left)).toBeCloseTo(result.pKill, 6);
    expect(result.pKill).toBeGreaterThan(0.5);
  });

  it("suggests applying no more wounds than the target has left", () => {
    const result = solve(current());
    // The apply field is seeded with the expected damage rounded to a whole wound.
    expect(Math.max(0, Math.round(result.expectedDamage))).toBeLessThanOrEqual(woundsLeft(state, tank.W, tank.models));
  });

  it("reads nothing like the same shot against the tank at full health", () => {
    const full = solve(opponentScenarioUnit(tank));
    const hurt = solve(current());
    // The untouched profile is what the panel used to solve against: a few percent to kill, and
    // several wounds of expected damage against a target with one wound left.
    expect(full.pKill).toBeLessThan(0.1);
    expect(full.expectedDamage).toBeGreaterThan(3);
    expect(hurt.pKill).toBeGreaterThan(full.pKill);
    expect(hurt.expectedDamage).toBeLessThan(1);
  });
});
