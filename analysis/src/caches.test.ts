import { describe, expect, it } from "vitest";
import type { Scenario, ScenarioUnit, SimResult, Snapshot } from "./schema";
import { createAnalyses, type AnalysisHost } from "./index";

/**
 * The reverse search and the turn optimiser cache runs by the state the target starts in. Two
 * different states must never share an entry.
 *
 * The host below is a made-up game whose states are two numbers. "Lead" leaves [0, 0.000031] and
 * "Other" leaves [0.000001, 0], which a 32-bit hash of the rounded values maps to the same number.
 * "Finisher" reports the state it was handed as its damage, so a run served from the wrong entry
 * shows up in the figures.
 */
const bare = (name: string, points = 10): ScenarioUnit => ({ name, keywords: [], models: [{ name, count: 1, T: 1, Sv: 7, W: 1, isCharacter: false, keywords: [] }], weapons: [], attached: [], effects: [], points });

const LEAD = [0, 0.000031];
const OTHER = [0.000001, 0];

function result(damage: number, finalState: number[] | undefined): SimResult {
  const zeroes = { p5: 0, p25: 0, p50: 0, p75: 0, p95: 0 };
  return {
    backend: "exact",
    damagePMF: [],
    slainPMF: [1],
    expectedDamage: damage,
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
    pointsSlain: 0,
    ...(finalState ? { finalState } : {}),
  };
}

function counting() {
  const calls: Array<{ attacker: string; toggles: string[]; initial?: number[] }> = [];
  const runScenario = (scenario: Scenario, opts?: { snapshot?: Snapshot; initialState?: number[] }): SimResult => {
    const name = scenario.attacker.name;
    calls.push({ attacker: name, toggles: scenario.enabledToggles, ...(opts?.initialState ? { initial: opts.initialState } : {}) });
    if (name === "Lead") return result(1, LEAD.slice());
    if (name === "Other") return result(1, OTHER.slice());
    // A run against a target with more states than a run hands back.
    if (name === "Stateless") return result(1, undefined);
    const s = opts?.initialState;
    // What the finisher adds depends on the state it starts from, and it leaves that state alone.
    const damage = scenario.enabledToggles.includes("boost") ? 7 : s ? 1 + s[0]! * 1e6 + s[1]! * 1e6 : 1;
    return result(damage, s ? s.slice() : [1, 0]);
  };
  const host: AnalysisHost = {
    defaultGameSystemId: "two-numbers",
    runScenario,
    archetypes: [],
    sensitivityVariants: [
      { id: "boost", label: "Boost", side: "attacker", toggles: ["boost"] },
      { id: "none", label: "Nothing", side: "defender", toggles: ["nothing"] },
    ],
    referenceAttack: {},
    referenceAttacker: () => bare("Reference"),
    defaultAttackerIds: [],
    defaultTargetIds: [],
    defaultTurnOptions: [{ id: "none", label: "Nothing", cp: 0, enabledToggles: [] }],
  };
  return { calls, analyses: createAnalyses(host) };
}

describe("runs cached by the state the target starts in", () => {
  it("keeps apart two states a hash of their rounded values would merge", () => {
    const { analyses } = counting();
    const out = analyses.reverseMathhammer({
      target: bare("Target"),
      candidates: [
        { id: "lead", unit: bare("Lead") },
        { id: "other", unit: bare("Other") },
        { id: "finisher", unit: bare("Finisher") },
      ],
      metric: "expectedDamage",
      threshold: 100,
      maxCombo: 2,
    });
    const row = (ids: string) => out.rows.find((r) => r.candidateIds.join() === ids)!;
    // Lead then Finisher: 1 + (0 + 31). Other then Finisher: 1 + (1 + 0).
    expect(row("lead,finisher").expectedDamage).toBeCloseTo(33, 9);
    expect(row("other,finisher").expectedDamage).toBeCloseTo(3, 9);
  });

  it("does the same in the turn optimiser", () => {
    const { analyses } = counting();
    const units = { lead: bare("Lead"), other: bare("Other"), finisher: bare("Finisher") };
    const plan = analyses.evaluateTurnPlan(
      { attackers: Object.entries(units).map(([id, unit]) => ({ id, unit })), targets: [{ id: "t", unit: bare("Target") }], objective: "damage" },
      [
        { attackerId: "lead", targetId: "t" },
        { attackerId: "finisher", targetId: "t" },
        { attackerId: "other", targetId: "t" },
        { attackerId: "finisher", targetId: "t" },
      ],
    );
    // The finisher fires at Lead's state, then at Other's: 1 + 32 + 1 + 2.
    expect(plan.assignments.map((a) => a.expectedDamage)).toEqual([1, 32, 1, 2]);
  });

  it("still serves a state reached again from the cache", () => {
    const { analyses, calls } = counting();
    analyses.reverseMathhammer({
      target: bare("Target"),
      candidates: [
        { id: "lead", unit: bare("Lead") },
        { id: "finisher", unit: bare("Finisher") },
        { id: "other", unit: bare("Other") },
      ],
      metric: "expectedDamage",
      threshold: 100,
      maxCombo: 3,
    });
    // Lead's state is reached by lead, lead+finisher and lead+other, and is run from once per member after it.
    expect(calls.filter((c) => c.attacker === "Lead").length).toBe(1);
    expect(calls.filter((c) => c.attacker === "Finisher" && c.initial?.[1] === LEAD[1]).length).toBe(1);
  });
});

describe("a group whose state cannot be carried from one member to the next", () => {
  const search = (first: string, second: string) =>
    counting().analyses.reverseMathhammer({
      target: bare("Target"),
      candidates: [
        { id: first.toLowerCase(), unit: bare(first) },
        { id: second.toLowerCase(), unit: bare(second) },
      ],
      metric: "expectedDamage",
      threshold: 100,
      maxCombo: 2,
    });

  it("says the reverse search started the next member on a fresh unit", () => {
    const out = search("Stateless", "Finisher");
    // The finisher fired at a fresh target, which it reports as 1.
    expect(out.rows.find((r) => r.candidateIds.join() === "stateless,finisher")!.expectedDamage).toBe(2);
    expect(out.warnings).toContain("Stateless vs Target: too many states to carry into the next attack, so later attacks on this target start from a fresh unit.");
  });

  it("says nothing when that member fires last", () => {
    expect(search("Finisher", "Stateless").warnings).toEqual([]);
  });
});

describe("what-if variants run a few at a time", () => {
  it("reuses the base it is handed and gives the same deltas as one call", () => {
    const { analyses, calls } = counting();
    const scenario = analyses.makeScenario(bare("Finisher"), bare("Target"));
    const whole = analyses.sensitivity(scenario);
    const before = calls.length;
    const head = analyses.sensitivity(scenario, { variantIds: [] });
    expect(head.variants).toEqual([]);
    const parts = ["boost", "none"].flatMap((id) => analyses.sensitivity(scenario, { variantIds: [id], base: head.base }).variants);
    // One base run for the head, one run per variant and no base run after that.
    expect(calls.length - before).toBe(3);
    expect(parts).toEqual(whole.variants);
    expect(parts[0]!.deltaDamage).toBe(6);
  });
});
