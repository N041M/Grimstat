import { describe, expect, it } from "vitest";
import type { ScenarioUnit } from "@grimstat/schema";
import { archetypes, evaluateTurnPlan } from "@grimstat/game-40k-11e";
import { isMeleeOnly, jointOutput, jointRequests, STAT_TARGET_IDS, type StatTargetId } from "./useArmyStats";

/**
 * The joint run behind Armies → Statistics, driven straight through the plugin so the arithmetic is
 * tested without a worker.
 *
 * The list is the six-unit army from the bug report: four attacker archetypes, two of them twice.
 * Measured as six separate duels and added up, it took 23.0 wounds off a 10-wound squad and
 * destroyed 194.2 points of a 90-point one.
 */
const ARMY = ["bolter-squad", "lascannon-team", "melta-squad", "chainsword-mob", "bolter-squad", "melta-squad"];

const unitOf = (id: string): ScenarioUnit => {
  const unit = archetypes.find((a) => a.id === id)?.unit;
  if (!unit) throw new Error(`no archetype ${id}`);
  return unit;
};

const army = ARMY.map((id, i) => ({ id: `u${i}`, unit: unitOf(id) }));

const targetOf = (id: StatTargetId) => unitOf(id);
const woundsOf = (u: ScenarioUnit) => u.models.reduce((s, m) => s + m.count * m.W, 0);

const solve = (units: Array<{ id: string; unit: ScenarioUnit }>) => jointOutput(jointRequests(units).map((r) => evaluateTurnPlan(r.input, r.plan)));

describe("the army's output against one target", () => {
  it("never takes more wounds off a target than it has, or destroys more points than it costs", () => {
    const out = solve(army);
    for (const id of STAT_TARGET_IDS) {
      const target = targetOf(id);
      const row = out[id];
      expect(row, id).toBeDefined();
      expect(row!.damage).toBeGreaterThan(0);
      expect(row!.damage).toBeLessThanOrEqual(woundsOf(target) + 1e-9);
      expect(row!.removed).toBeLessThanOrEqual(1 + 1e-9);
      expect(row!.pointsSlain).toBeDefined();
      expect(row!.pointsSlain!).toBeLessThanOrEqual(target.points! + 1e-9);
    }
  });

  it("wipes the power-armour squad the six separate duels destroyed 2.2 times over", () => {
    const power = solve(army)["marine-like"]!;
    // 10 wounds and 90 points: the list clears one of these and stops there.
    expect(power.damage).toBeCloseTo(10, 1);
    expect(power.removed).toBeCloseTo(1, 2);
    expect(power.pointsSlain!).toBeCloseTo(90, 1);
  });

  it("counts what the units after the first one add, rather than what they would do alone", () => {
    const alone = solve([army[1]!])["heavy-tank"]!;
    const all = solve(army)["heavy-tank"]!;
    // A 14-wound tank survives any one of these units, so the whole list does strictly more to it.
    expect(all.damage).toBeGreaterThan(alone.damage);
    expect(all.pointsSlain!).toBeGreaterThan(alone.pointsSlain!);
    expect(all.damage).toBeLessThanOrEqual(14 + 1e-9);
  });

  it("reports nothing for an army with no weapons switched on", () => {
    expect(jointRequests([])).toEqual([]);
    expect(jointOutput([])["marine-like"]!.damage).toBe(0);
  });
});

describe("the phase a unit is measured in", () => {
  it("keeps a melee-only unit in the same plan as the rest", () => {
    expect(isMeleeOnly(unitOf("chainsword-mob"))).toBe(true);
    expect(isMeleeOnly(unitOf("bolter-squad"))).toBe(false);
    // A unit with nothing switched on has no output at all, so it is not a melee unit either.
    expect(isMeleeOnly(unitOf("marine-like"))).toBe(false);

    // The plugin resolves each attacker in the phase it can fight in, so splitting the list into a
    // shooting plan and a fight plan would only break the chain: the target would start each half at
    // full health and the two halves would be added together.
    const plans = jointRequests(army);
    expect(plans).toHaveLength(1);
    expect(plans[0]!.input.attackers.map((a) => a.id)).toEqual(army.map((u) => u.id));
  });

  it("asks every unit to fire at every target, in the order the list holds them", () => {
    const plans = jointRequests(army);
    expect(plans[0]!.input.targets.map((t) => t.id)).toEqual([...STAT_TARGET_IDS]);
    expect(plans[0]!.plan).toHaveLength(STAT_TARGET_IDS.length * army.length);
    expect(plans[0]!.plan.slice(0, army.length).map((s) => s.attackerId)).toEqual(army.map((u) => u.id));
  });
});
