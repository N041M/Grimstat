import { describe, expect, it } from "vitest";
import type { Scenario, ScenarioUnit, SimResult, Snapshot } from "./schema";
import { createAnalyses, type AnalysisHost } from "./index";

/**
 * Proof that the analyses hold for a game system that is not 40k.
 *
 * The host below is a made-up game. A unit's strength is one number on a keyword, damage is that
 * number times the attacker's model count, and nothing in it has a Strength, a Toughness, an armour
 * save or a hit roll. Every analysis still runs and still reads the way it should: the matrix is the
 * right shape, the efficiency ranking puts the better unit first, the turn optimiser spends its
 * command points, and the what-if analysis reports the variant's delta.
 *
 * If a characteristic 40k happens to use creeps back into this package, this test stops compiling or
 * stops passing.
 */

const strengthOf = (u: ScenarioUnit): number => Number(u.keywords.find((k) => k.startsWith("POWER-"))?.slice(6) ?? 0);
const modelsOf = (u: ScenarioUnit): number => u.models.reduce((n, m) => n + m.count, 0);
const woundsOf = (u: ScenarioUnit): number => u.models.reduce((n, m) => n + m.count * m.W, 0);

/** A whole game system in one function: damage is the attacker's power times its models. */
function runScenario(scenario: Scenario): SimResult {
  const { attacker, defender } = scenario;
  const bonus = scenario.enabledToggles.includes("rally") ? 2 : 0;
  const raw = (strengthOf(attacker) + bonus) * Math.max(1, modelsOf(attacker));
  const capacity = woundsOf(defender);
  const damage = Math.min(raw, capacity);
  const perModel = defender.models[0]?.W ?? 1;
  const slain = Math.floor(damage / perModel);
  const zeroes = { p5: 0, p25: 0, p50: 0, p75: 0, p95: 0 };
  return {
    backend: "exact",
    damagePMF: [],
    slainPMF: [],
    expectedDamage: damage,
    expectedSlain: slain,
    pKill: capacity > 0 && raw >= capacity ? 1 : 0,
    pAtLeastSlain: [],
    damagePercentiles: zeroes,
    slainPercentiles: zeroes,
    expectedWasted: Math.max(0, raw - capacity),
    expectedSelfMortals: 0,
    weapons: [],
    coverage: { tier1: 0, tier2: 0, tier3: 0, unmodelled: [], advice: {} },
    warnings: [],
    ...(defender.points !== undefined ? { pointsSlain: (damage / Math.max(1, capacity)) * defender.points } : {}),
  };
}

const unit = (name: string, power: number, models: number, W: number, points?: number): ScenarioUnit => ({
  name,
  keywords: [`POWER-${power}`],
  models: [{ name: `${name} model`, count: models, T: 1, Sv: 7, W, isCharacter: false, keywords: [] }],
  weapons: [{ name: "swing", count: models, kind: "melee", range: null, A: "1", skill: null, S: 1, AP: 0, D: "1", keywords: [], enabled: true }],
  attached: [],
  effects: [],
  ...(points !== undefined ? { points } : {}),
});

const host: AnalysisHost = {
  defaultGameSystemId: "not-40k",
  runScenario: (scenario: Scenario, _opts?: { snapshot?: Snapshot; initialState?: number[] }) => runScenario(scenario),
  archetypes: [
    { id: "rabble", name: "Rabble", unit: unit("Rabble", 1, 6, 1, 60) },
    { id: "guard", name: "Guard", unit: unit("Guard", 2, 4, 2, 100) },
  ],
  sensitivityVariants: [{ id: "rally", label: "Rally", side: "attacker", toggles: ["rally"] }],
  referenceAttack: { power: 1 },
  referenceAttacker: (ref) => unit("Reference", ref.power ?? 1, 1, 1),
  defaultAttackerIds: ["rabble", "guard"],
  defaultTargetIds: ["rabble", "guard"],
  defaultTurnOptions: [
    { id: "none", label: "Nothing", cp: 0, enabledToggles: [] },
    { id: "rally", label: "Rally", cp: 1, enabledToggles: ["rally"] },
  ],
};

const A = createAnalyses(host);
const weak = unit("Weak", 1, 2, 1, 50);
const strong = unit("Strong", 4, 2, 1, 50);
const target = unit("Target", 0, 5, 2, 120);

describe("the analyses over a game system that is not 40k", () => {
  it("fills a matchup matrix", () => {
    const m = A.runMatrix([weak, strong], [target]);
    expect(m.attackers).toEqual(["Weak", "Strong"]);
    expect(m.cells[0]![0]!.result.expectedDamage).toBe(2);
    expect(m.cells[1]![0]!.result.expectedDamage).toBe(8);
    expect(m.cells[1]![0]!.damagePer100).toBe(16);
  });

  it("ranks the stronger unit above the weaker one", () => {
    const rows = A.efficiencyRanking([weak, strong]);
    expect(rows.map((r) => r.unit)).toEqual(["Strong", "Weak"]);
    expect(rows[0]!.perPoints).toBe(true);
  });

  it("profiles what the archetypes do to a unit", () => {
    const entries = A.durabilityProfile(target);
    expect(entries.map((e) => e.archetype)).toEqual(["Rabble", "Guard"]);
    expect(entries.map((e) => e.expectedDamage)).toEqual([6, 8]);
  });

  it("measures effective wounds against the host's own reference attack", () => {
    // The reference attack has power 1 and one model, so it takes one wound off a model every time.
    expect(A.effectiveWounds(unit("Anyone", 0, 3, 2))).toBe(6);
  });

  it("spends the command points it has on the option that pays", () => {
    const plan = A.optimiseTurn({
      attackers: [{ id: "a", unit: weak }],
      targets: [{ id: "t", unit: target }],
      cpBudget: 1,
      objective: "damage",
    });
    expect(plan.assignments).toHaveLength(1);
    expect(plan.assignments[0]!.optionId).toBe("rally");
    expect(plan.cpSpent).toBe(1);
    // Rally adds 2 power across 2 models: 2 damage becomes 6.
    expect(plan.totalExpectedDamage).toBe(6);
  });

  it("reports what one change is worth", () => {
    const s = A.makeScenario(weak, target);
    const out = A.sensitivity(s);
    expect(out.base.expectedDamage).toBe(2);
    expect(out.variants.map((v) => v.id)).toEqual(["rally"]);
    expect(out.variants[0]!.deltaDamage).toBe(4);
  });

  it("finds which unit removes the target", () => {
    const out = A.reverseMathhammer({
      target: unit("Small", 0, 1, 3),
      candidates: [{ id: "w", unit: weak }, { id: "s", unit: strong }],
      metric: "pKill",
      threshold: 1,
      maxCombo: 1,
    });
    // Strong puts out 8 against a 3-wound model and removes it. Weak puts out 2 and leaves it standing.
    const row = (id: string) => out.rows.find((r) => r.candidateIds.join() === id)!;
    expect([row("s").pKill, row("s").meets]).toEqual([1, true]);
    expect([row("w").pKill, row("w").meets]).toEqual([0, false]);
    expect(out.cheapest?.names).toEqual(["Strong"]);
  });

  it("scores under the game system the host names", () => {
    expect(A.makeScenario(weak, target).gameSystemId).toBe("not-40k");
    expect(A.editionOf({})).toBe("not-40k");
    expect(A.editionOf({ gameSystemId: "another" })).toBe("another");
  });
});
