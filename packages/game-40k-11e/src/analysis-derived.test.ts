import { describe, expect, it } from "vitest";
import type { Archetype, EffectRecord, ScenarioUnit } from "@grimstat/schema";
import { archetypes } from "./archetypes";
import { durabilityIndex, durabilityProfile, effectiveWounds, efficiencyRanking, incomingFire, makeScenario, phaseFor, removalChain, runMatrix } from "./analysis";
import { reverseMathhammer } from "./reverse";

const byId = (id: string) => archetypes.find((a) => a.id === id)!.unit;

/** A bare unit with the given models, so a test can state a defensive profile and nothing else. */
function defender(models: ScenarioUnit["models"], extra: Partial<ScenarioUnit> = {}): ScenarioUnit {
  return { name: "Defender", keywords: [], models, weapons: [], attached: [], effects: [], ...extra };
}

/** Run `body` with one extra archetype in the shared list, then put the list back. */
function withArchetype<T>(extra: Archetype, body: () => T): T {
  archetypes.push(extra);
  try {
    return body();
  } finally {
    archetypes.splice(archetypes.indexOf(extra), 1);
  }
}

describe("points needed to remove a unit", () => {
  /**
   * One attack, resolved by hand.
   *
   * BS 4+ hits half the time. Strength 8 against Toughness 4 wounds on a 2+, which is five rolls in
   * six. Save 7+ leaves only the unmodified 6 that always saves, so five unsaved wounds in six get
   * through. One attack strips a wound with probability 1/2 × 5/6 × 5/6 = 25/72.
   */
  const pStick = (1 / 2) * (5 / 6) * (5 / 6);
  const probe: ScenarioUnit = {
    name: "One shot",
    keywords: [],
    models: [],
    weapons: [{ name: "Shot", count: 1, kind: "ranged", range: null, A: "1", skill: 4, S: 8, AP: 0, D: "2", keywords: [], enabled: true }],
    attached: [],
    effects: [],
    points: 100,
  };
  /** Three wounds, no save worth the name, so the shot's 2 damage kills on the second one that lands. */
  const target = defender([{ name: "Target", count: 1, T: 4, Sv: 7, W: 3, isCharacter: false, keywords: [] }]);

  it("counts the activations a kill takes rather than scaling one activation up", () => {
    const chain = removalChain(makeScenario(probe, target, { rangeBand: "full" }));
    expect(chain.exact).toBe(true);
    expect(chain.first.expectedDamage).toBeCloseTo(2 * pStick, 9);
    // The model dies on the second attack that sticks, and the attacks are independent, so the
    // number of activations is the sum of two geometric waits: 2 / pStick = 5.76.
    expect(chain.activations).toBeCloseTo(2 / pStick, 5);
    expect(2 / pStick).toBeCloseTo(5.76, 9);
    // Scaling the first activation up to the wound count instead gives 3 / (2 × pStick) = 4.32,
    // because it counts the second hit's wasted point of damage as if it had landed.
    const extrapolated = 3 / chain.first.expectedDamage;
    expect(extrapolated).toBeCloseTo(4.32, 9);
    expect(chain.activations / extrapolated).toBeCloseTo(4 / 3, 5);
  });

  it("reports Infinity when the attacker cannot hurt the unit", () => {
    const harmless: ScenarioUnit = { ...probe, weapons: [] };
    const chain = removalChain(makeScenario(harmless, target, { rangeBand: "full" }));
    expect(chain.activations).toBe(Number.POSITIVE_INFINITY);
    expect(chain.exact).toBe(true);
  });

  it("archetype endpoints use each archetype's own points and come from the exact chain", () => {
    const row = incomingFire([byId("heavy-tank")], { context: { rangeBand: "half" } })[0]!;
    expect(row.entries.length).toBe(4);
    for (const e of row.entries) {
      expect(e.exact).toBe(true);
      const source = archetypes.find((a) => a.name === e.archetype)!;
      expect(e.attackerPoints).toBe(source.unit.points);
      // The stopping time never sits below the extrapolation, because overkill only adds cost.
      expect(e.pointsToRemove).toBeGreaterThan((e.attackerPoints * row.wounds) / e.expectedDamage - 1e-6);
    }
    // A tank soaks far more melta than the extrapolation claimed: 400 points rather than 314.
    const melta = row.entries.find((e) => e.archetype.includes("melta"))!;
    expect(melta.pointsToRemove).toBeCloseTo(400.1, 0);
    expect((melta.attackerPoints * row.wounds) / melta.expectedDamage).toBeCloseTo(313.5, 0);
  });
});

describe("averaging the attacker archetypes", () => {
  const defenders = ["heavy-tank", "light-vehicle", "terminator-like", "marine-like", "horde-like"].map(byId);

  it("the endpoint and the casualty curve's slope are the same reading", () => {
    for (const row of incomingFire(defenders, { context: { rangeBand: "half" } })) {
      // The casualty curve strips the unit when its wounds run out at `woundsPer100`. That point
      // has to be the number the Durability column prints.
      expect((row.wounds / row.woundsPer100) * 100).toBeCloseTo(row.pointsToRemove, 6);
    }
  });

  it("is the harmonic mean of the archetype endpoints, so the worst matchup cannot dominate", () => {
    for (const row of incomingFire(defenders, { context: { rangeBand: "half" } })) {
      const needs = Object.values(row.byArchetype);
      const harmonic = needs.length / needs.reduce((s, n) => s + 1 / n, 0);
      const arithmetic = needs.reduce((s, n) => s + n, 0) / needs.length;
      expect(row.pointsToRemove).toBeCloseTo(harmonic, 6);
      expect(row.pointsToRemove).toBeLessThan(arithmetic);
      // No single archetype may carry more than half of the reading.
      const worst = Math.max(...needs);
      expect(1 / worst / needs.reduce((s, n) => s + 1 / n, 0)).toBeLessThan(0.5);
    }
  });

  it("counts an archetype that cannot hurt the unit as a rate of zero", () => {
    // Light infantry carry no weapons, so they remove nothing however long they shoot.
    const both = incomingFire([byId("heavy-tank")], { attackerIds: ["melta-squad", "guardsman-like"], context: { rangeBand: "half" } })[0]!;
    const alone = incomingFire([byId("heavy-tank")], { attackerIds: ["melta-squad"], context: { rangeBand: "half" } })[0]!;
    const idle = both.entries.find((e) => e.archetype.includes("Light infantry"))!;
    expect(idle.expectedDamage).toBe(0);
    expect(idle.pointsToRemove).toBe(Number.POSITIVE_INFINITY);
    // Dropping it would leave the reading unchanged. Counting it at zero halves the rate instead.
    expect(both.woundsPer100).toBeCloseTo(alone.woundsPer100 / 2, 9);
    expect(both.pointsToRemove).toBeCloseTo(alone.pointsToRemove * 2, 6);
  });

  it("durabilityIndex reports the same endpoints as incomingFire", () => {
    const rows = incomingFire(defenders, { context: { rangeBand: "half" } });
    const index = durabilityIndex(defenders, { context: { rangeBand: "half" } });
    expect(index.map((r) => r.pointsToRemove)).toEqual(rows.map((r) => r.pointsToRemove));
    expect(index.map((r) => r.byArchetype)).toEqual(rows.map((r) => r.byArchetype));
  });
});

describe("archetypes without a points value", () => {
  const unpricedAttacker: Archetype = {
    id: "test-unpriced-attacker",
    name: "Test attacker with no points",
    unit: {
      name: "Unpriced attacker",
      keywords: [],
      models: [{ name: "Gunner", count: 1, T: 4, Sv: 3, W: 1, isCharacter: false, keywords: [] }],
      weapons: [{ name: "Gun", count: 4, kind: "ranged", range: 24, A: "1", skill: 3, S: 8, AP: 2, D: "2", keywords: [], enabled: true }],
      attached: [],
      effects: [],
    },
  };

  it("are left out of the points-denominated figures and named instead", () => {
    withArchetype(unpricedAttacker, () => {
      const row = incomingFire([byId("light-vehicle")], { attackerIds: ["melta-squad", "test-unpriced-attacker"], context: { rangeBand: "half" } })[0]!;
      const alone = incomingFire([byId("light-vehicle")], { attackerIds: ["melta-squad"], context: { rangeBand: "half" } })[0]!;
      expect(row.unpriced).toEqual(["Test attacker with no points"]);
      expect(row.entries.map((e) => e.archetype)).not.toContain("Test attacker with no points");
      expect(Object.keys(row.byArchetype)).not.toContain("Test attacker with no points");
      // Nothing is priced at a stand-in 100 points, so the reading is the priced archetype's alone.
      expect(row.pointsToRemove).toBeCloseTo(alone.pointsToRemove, 9);
    });
  });

  it("give a target no points-destroyed entry, which is not the same as destroying nothing", () => {
    const unpricedTarget: Archetype = { id: "test-unpriced-target", name: "Test target with no points", unit: defender([{ name: "Body", count: 2, T: 5, Sv: 4, W: 3, isCharacter: false, keywords: [] }], { name: "Unpriced target" }) };
    withArchetype(unpricedTarget, () => {
      const row = efficiencyRanking([byId("melta-squad")], { targetIds: ["heavy-tank", "test-unpriced-target"], context: { rangeBand: "half" } })[0]!;
      expect(row.byTarget["Unpriced target"]).toBeGreaterThan(0);
      expect(row.pointsByTarget["Unpriced target"]).toBeUndefined();
      expect(row.pointsByTarget["Heavy tank"]).toBeGreaterThan(0);
    });
  });

  it("matrix cells trade no points against an unpriced defender", () => {
    const priced = defender([{ name: "Body", count: 2, T: 5, Sv: 4, W: 3, isCharacter: false, keywords: [] }], { name: "Priced", points: 120 });
    const free = defender([{ name: "Body", count: 2, T: 5, Sv: 4, W: 3, isCharacter: false, keywords: [] }], { name: "Free" });
    const m = runMatrix([byId("melta-squad")], [priced, free], { rangeBand: "half" });
    expect(m.cells[0]![0]!.pointsTradePer100).toBeGreaterThan(0);
    expect(m.cells[0]![1]!.pointsTradePer100).toBeUndefined();
  });
});

describe("efficiency ranking scales", () => {
  const gun: ScenarioUnit["weapons"] = [{ name: "Gun", count: 6, kind: "ranged", range: 24, A: "1", skill: 3, S: 6, AP: 1, D: "1", keywords: [], enabled: true }];
  const model: ScenarioUnit["models"] = [{ name: "Trooper", count: 6, T: 4, Sv: 3, W: 1, isCharacter: false, keywords: [] }];
  const pricedUnit: ScenarioUnit = { name: "Priced squad", keywords: ["INFANTRY"], models: model, weapons: gun, attached: [], effects: [], points: 110 };
  const freeUnit: ScenarioUnit = { ...pricedUnit, name: "Unpriced squad", points: undefined };

  it("uses one scale for the whole column, so the same unit cannot outrank itself unpriced", () => {
    const mixed = efficiencyRanking([pricedUnit, freeUnit], { targetIds: ["marine-like"], context: { rangeBand: "half" } });
    expect(mixed.every((r) => r.perPoints === false)).toBe(true);
    expect(mixed[0]!.damagePer100).toBeCloseTo(mixed[1]!.damagePer100, 9);
    const priced = efficiencyRanking([pricedUnit], { targetIds: ["marine-like"], context: { rangeBand: "half" } })[0]!;
    expect(priced.perPoints).toBe(true);
    expect(priced.damagePer100).toBeCloseTo((priced.byTarget["Power armour ×5"]! / 110) * 100, 9);
  });
});

describe("the phase an attacker is measured in", () => {
  const weaponless: ScenarioUnit = { name: "Weaponless", keywords: [], models: [], weapons: [], attached: [], effects: [] };
  const meleeOnlyLive: ScenarioUnit = {
    name: "Switched off guns",
    keywords: [],
    models: [{ name: "Fighter", count: 5, T: 4, Sv: 3, W: 2, isCharacter: false, keywords: [] }],
    weapons: [
      { name: "Pistol", count: 5, kind: "ranged", range: 12, A: "1", skill: 3, S: 4, AP: 0, D: "1", keywords: [], enabled: false },
      { name: "Blade", count: 5, kind: "melee", range: null, A: "4", skill: 3, S: 6, AP: 2, D: "2", keywords: [], enabled: true },
    ],
    attached: [],
    effects: [],
    points: 120,
  };

  it("a unit with no weapons stays in the phase it was asked for", () => {
    expect(phaseFor(weaponless, { phase: "shooting" })).toEqual({ phase: "shooting" });
    expect(phaseFor(weaponless, { phase: "fight" })).toEqual({ phase: "fight" });
  });

  it("a unit whose only live weapon is melee is moved to the fight phase", () => {
    expect(phaseFor(meleeOnlyLive, { phase: "shooting" })).toEqual({ phase: "fight", charged: true });
  });

  it("incoming fire measures such a unit where it can act", () => {
    const archetype: Archetype = { id: "test-melee-only", name: "Test melee-only attacker", unit: meleeOnlyLive };
    withArchetype(archetype, () => {
      const row = incomingFire([byId("marine-like")], { attackerIds: ["test-melee-only"], context: { rangeBand: "half" } })[0]!;
      expect(row.entries[0]!.expectedDamage).toBeGreaterThan(0);
      expect(row.pointsToRemove).toBeLessThan(Number.POSITIVE_INFINITY);
      const profile = durabilityProfile(byId("marine-like"), { attackerIds: ["test-melee-only"] });
      expect(profile[0]!.expectedDamage).toBeGreaterThan(0);
    });
  });

  it("an archetype with no weapons removes nothing, in either analysis", () => {
    const row = incomingFire([byId("marine-like")], { attackerIds: ["guardsman-like"], context: { rangeBand: "half" } })[0]!;
    expect(row.entries[0]!.expectedDamage).toBe(0);
    expect(row.pointsToRemove).toBe(Number.POSITIVE_INFINITY);
    expect(durabilityProfile(byId("marine-like"), { attackerIds: ["guardsman-like" ] })[0]!.expectedDamage).toBe(0);
  });
});

describe("effective wounds and the save the engine takes", () => {
  const model = { name: "Body", count: 10, T: 4, Sv: 7, W: 2, isCharacter: false, keywords: [] };
  const invulnFromAbility: EffectRecord = { when: { stage: "save", side: "defender" }, op: "cap", target: "invuln", value: 5, source: "5+ invulnerable save" };

  it("counts an invulnerable save that arrives as ability text", () => {
    const bare = effectiveWounds(defender([model]));
    const onProfile = effectiveWounds(defender([{ ...model, InvSv: 5 }]));
    const fromAbility = effectiveWounds(defender([model], { effects: [invulnFromAbility] }));
    // 20 raw wounds. Without a save worth the name only the unmodified 6 saves, and a 5+
    // invulnerable save raises the unit's effective wounds by a quarter.
    expect(bare).toBeCloseTo(72, 6);
    expect(onProfile).toBeCloseTo(90, 6);
    expect(fromAbility).toBeCloseTo(onProfile, 6);
  });

  it("still scales with model count and wounds", () => {
    const one = effectiveWounds(defender([{ ...model, count: 1 }]));
    expect(effectiveWounds(defender([model]))).toBeCloseTo(one * 10, 6);
  });
});

describe("reverse search candidates without a points value", () => {
  const squad: ScenarioUnit = {
    name: "Squad",
    keywords: ["INFANTRY"],
    models: [{ name: "Trooper", count: 10, T: 4, Sv: 3, W: 2, isCharacter: false, keywords: [] }],
    weapons: [{ name: "Gun", count: 10, kind: "ranged", range: 24, A: "2", skill: 3, S: 8, AP: 3, D: "2", keywords: [], enabled: true }],
    attached: [],
    effects: [],
    points: 150,
  };

  it("rank behind an identical priced unit instead of sorting in at zero points", () => {
    const r = reverseMathhammer({
      target: byId("marine-like"),
      candidates: [
        { id: "free", unit: { ...squad, name: "Unpriced squad", points: undefined } },
        { id: "paid", unit: squad },
      ],
      metric: "pKill",
      threshold: 0.5,
      context: { rangeBand: "half" },
      maxCombo: 1,
    });
    const paid = r.rows.find((x) => x.candidateIds[0] === "paid")!;
    const free = r.rows.find((x) => x.candidateIds[0] === "free")!;
    expect(paid.meets && free.meets).toBe(true);
    expect(paid.priced).toBe(true);
    expect(free.priced).toBe(false);
    expect(r.rows.indexOf(paid)).toBeLessThan(r.rows.indexOf(free));
    expect(r.cheapest?.candidateIds).toEqual(["paid"]);
    expect(r.cheapest?.points).toBe(150);
    expect(r.warnings.some((w) => w.includes("no points value"))).toBe(true);
  });
});

describe("archetype points are disclosed", () => {
  it("every archetype spells its points out in its display name", () => {
    for (const a of archetypes) {
      expect(a.unit.points).toBeGreaterThan(0);
      expect(a.name).toContain(`${a.unit.points} pts`);
    }
  });
});
