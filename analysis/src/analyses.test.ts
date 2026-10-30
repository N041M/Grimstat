import { describe, expect, it } from "vitest";
import type { Scenario, ScenarioUnit, SimResult } from "./schema";
import { createAnalyses, type AnalysisHost } from "./index";

/*
 * A made-up game whose runs are sampled. A target's damage and the half-width of its interval are
 * written on the target, so a ranking's figure and interval can be worked out by hand.
 */
const zeroes = { p5: 0, p25: 0, p50: 0, p75: 0, p95: 0 };
const numberOn = (u: ScenarioUnit, prefix: string): number => Number(u.keywords.find((k) => k.startsWith(prefix))?.slice(prefix.length) ?? 0);

function runScenario(scenario: Scenario): SimResult {
  return {
    backend: "mc",
    damagePMF: [],
    slainPMF: [],
    expectedDamage: numberOn(scenario.defender, "DAMAGE-"),
    ciHalfWidth: numberOn(scenario.defender, "HALF-"),
    expectedSlain: 0,
    pKill: 0,
    pAtLeastSlain: [],
    damagePercentiles: zeroes,
    slainPercentiles: zeroes,
    expectedWasted: 0,
    expectedSelfMortals: 0,
    weapons: [],
    coverage: { tier1: 0, tier2: 0, tier3: 0, unmodelled: [], advice: {} },
    warnings: [],
  };
}

const unit = (name: string, keywords: string[] = [], points?: number): ScenarioUnit => ({
  name,
  keywords,
  models: [{ name, count: 1, T: 1, Sv: 7, W: 1, isCharacter: false, keywords: [] }],
  weapons: [{ name: "swing", count: 1, kind: "melee", range: null, A: "1", skill: null, S: 1, AP: 0, D: "1", keywords: [], enabled: true }],
  attached: [],
  effects: [],
  ...(points !== undefined ? { points } : {}),
});

const rabble = unit("Rabble", ["DAMAGE-9", "HALF-3"]);
const host: AnalysisHost = {
  defaultGameSystemId: "sampled",
  runScenario: (scenario: Scenario) => runScenario(scenario),
  archetypes: [{ id: "rabble", name: "Rabble", unit: rabble }],
  sensitivityVariants: [],
  referenceAttack: {},
  referenceAttacker: () => unit("Reference"),
  defaultAttackerIds: ["rabble"],
  defaultTargetIds: ["rabble"],
  defaultTurnOptions: [],
};
const A = createAnalyses(host);
const attacker = unit("Attacker", [], 50);

describe("efficiency against weighted targets", () => {
  const light = unit("Light", ["DAMAGE-10", "HALF-2"]);
  const heavy = unit("Heavy", ["DAMAGE-4", "HALF-6"]);

  it("weighs each target's interval as it weighs the target's damage", () => {
    const [row] = A.efficiencyRanking([attacker], { targets: [{ unit: light, weight: 3 }, { unit: heavy, weight: 1 }] });
    // Per 100 points on a 50-point unit, each figure doubles: 20 ± 4 and 8 ± 12.
    expect(row!.damagePer100).toBeCloseTo((3 * 20 + 8) / 4, 9);
    expect(row!.ciHalfWidth).toBeCloseTo((3 * 4 + 12) / 4, 9);
    expect(row!.backend).toBe("mc");
  });

  it("ranks against no target when every target weighs nothing", () => {
    const [row] = A.efficiencyRanking([attacker], { targets: [{ unit: light, weight: 0 }, { unit: heavy, weight: 0 }] });
    expect(row!.damagePer100).toBe(0);
    expect(row!.byTarget).toEqual({});
    expect(row!.ciHalfWidth).toBeUndefined();
  });
});
