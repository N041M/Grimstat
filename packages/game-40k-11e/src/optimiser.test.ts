import { describe, expect, it } from "vitest";
import { archetypes, evaluateTurnPlan, optimiseTurn } from "./index";

const a = (id: string) => archetypes.find((x) => x.id === id)!.unit;

describe("turn optimiser", () => {
  it("sends melta at the tank and bolters at the infantry, and beats naive plans", () => {
    const input = {
      attackers: [
        { id: "bolters", unit: a("bolter-squad") },
        { id: "melta", unit: a("melta-squad") },
        { id: "lascannons", unit: a("lascannon-team") },
      ],
      targets: [
        { id: "tank", unit: a("heavy-tank") },
        { id: "marines", unit: a("marine-like") },
      ],
      context: { rangeBand: "half" as const },
      cpBudget: 1,
      objective: "points" as const,
    };
    const best = optimiseTurn(input);
    const by = Object.fromEntries(best.assignments.map((x) => [x.attackerId, x]));
    // bolters cannot hurt the tank; the optimiser must send them at the infantry
    expect(by["bolters"]!.targetId).toBe("marines");
    // with the tank as the only target, the anti-tank units all go there and chain their damage
    const tankOnly = optimiseTurn({ ...input, targets: [{ id: "tank", unit: a("heavy-tank") }], objective: "damage" });
    expect(tankOnly.assignments.every((x) => x.targetId === "tank")).toBe(true);
    expect(tankOnly.targets[0]!.pKill).toBeGreaterThan(0);
    expect(best.cpSpent).toBeLessThanOrEqual(1);
    expect(best.evaluations).toBeGreaterThan(5);
    expect(best.slainPMF.reduce((s, v) => s + v, 0)).toBeCloseTo(1, 9);
    const naive = evaluateTurnPlan(input, [
      { attackerId: "bolters", targetId: "tank" },
      { attackerId: "melta", targetId: "marines" },
      { attackerId: "lascannons", targetId: "marines" },
    ]);
    expect(best.score).toBeGreaterThan(naive.score);
    expect(best.totalExpectedPoints).toBeGreaterThan(naive.totalExpectedPoints);
  });
  it("respects the CP budget and reports over-budget manual plans", () => {
    const input = { attackers: [{ id: "b", unit: a("bolter-squad") }, { id: "c", unit: a("chainsword-mob") }], targets: [{ id: "m", unit: a("marine-like") }], cpBudget: 0, objective: "kills" as const, context: { rangeBand: "half" as const } };
    const r = optimiseTurn(input);
    expect(r.cpSpent).toBe(0);
    const manual = evaluateTurnPlan(input, [{ attackerId: "b", targetId: "m", optionId: "plus1-wound" }]);
    expect(manual.warnings.some((w) => w.includes("budget"))).toBe(true);
  });
  it("chained evaluation accounts for overkill: two units on one target slay no more than the target has", () => {
    const input = { attackers: [{ id: "b1", unit: a("bolter-squad") }, { id: "b2", unit: a("bolter-squad") }], targets: [{ id: "g", unit: a("guardsman-like") }], objective: "kills" as const, context: { rangeBand: "half" as const } };
    const r = evaluateTurnPlan(input, [{ attackerId: "b1", targetId: "g" }, { attackerId: "b2", targetId: "g" }]);
    expect(r.totalExpectedSlain).toBeLessThanOrEqual(10 + 1e-9);
    expect(r.targets[0]!.pKill).toBeGreaterThan(0.3);
    expect(r.assignments[1]!.pKillAfter).toBeGreaterThanOrEqual(r.assignments[0]!.pKillAfter);
  });
});
