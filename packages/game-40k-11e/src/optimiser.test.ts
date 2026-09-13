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
  /**
   * The Turn tab's shipped defaults: four attackers, each pinned to one 1 CP stratagem, under a
   * budget of 3. The fourth could not afford its option and was dropped from the plan entirely, so
   * the tab showed three rows and a total that silently left a unit's shooting out.
   */
  it("keeps an attacker that cannot afford its pinned stratagem, and says so", () => {
    const pinned = [{ id: "plus1-wound", label: "+1 to wound", cp: 1, enabledToggles: ["plus1-wound"] }];
    const input = {
      attackers: [
        { id: "bolters", unit: a("bolter-squad"), options: pinned },
        { id: "melta", unit: a("melta-squad"), options: pinned },
        { id: "las", unit: a("lascannon-team"), options: pinned },
        { id: "choppas", unit: a("chainsword-mob"), options: pinned },
      ],
      targets: [{ id: "tank", unit: a("heavy-tank") }, { id: "marines", unit: a("marine-like") }],
      context: { rangeBand: "half" as const },
      cpBudget: 3,
      objective: "points" as const,
    };
    const r = optimiseTurn(input);
    expect(r.assignments).toHaveLength(4);
    expect(r.assignments.map((x) => x.attackerId).sort()).toEqual(["bolters", "choppas", "las", "melta"]);
    expect(r.cpSpent).toBe(3);
    // Three of the four bought the stratagem; the fourth fires without it and is named.
    expect(r.assignments.filter((x) => x.optionId === "plus1-wound")).toHaveLength(3);
    expect(r.warnings.filter((w) => w.includes("fires with no stratagem"))).toHaveLength(1);
  });

  it("reports a plan step naming a unit that is not in the input rather than throwing", () => {
    const input = { attackers: [{ id: "b", unit: a("bolter-squad") }], targets: [{ id: "m", unit: a("marine-like") }], cpBudget: 0, objective: "kills" as const, context: { rangeBand: "half" as const } };
    const ghostAttacker = evaluateTurnPlan(input, [{ attackerId: "ghost", targetId: "m" }]);
    expect(ghostAttacker.assignments).toHaveLength(0);
    expect(ghostAttacker.warnings).toContain('The plan assigns "ghost", which is not one of the attackers.');
    // A step naming a target that is gone costs nothing, so the budget check and `cpSpent` agree.
    const ghostTarget = evaluateTurnPlan(input, [{ attackerId: "b", targetId: "ghost", optionId: "plus1-wound" }]);
    expect(ghostTarget.assignments).toHaveLength(0);
    expect(ghostTarget.cpSpent).toBe(0);
    expect(ghostTarget.warnings.some((w) => w.includes("budget"))).toBe(false);
    expect(ghostTarget.warnings).toContain(`${a("bolter-squad").name} is assigned to "ghost", which is not one of the targets.`);
  });
});
