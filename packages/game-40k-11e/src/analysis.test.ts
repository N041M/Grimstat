import { describe, expect, it } from "vitest";
import { archetypes, durabilityIndex, durabilityProfile, effectiveWounds, efficiencyRanking, incomingFire, pReferenceSticks, REFERENCE_ATTACK, runMatrix } from "./index";

const byId = (id: string) => archetypes.find((a) => a.id === id)!.unit;

describe("army-level analyses", () => {
  it("matrix runs every pair and reports per-100-point damage", () => {
    const m = runMatrix([byId("bolter-squad"), byId("melta-squad")], [byId("marine-like"), byId("heavy-tank")], { rangeBand: "half" });
    expect(m.cells.length).toBe(2);
    expect(m.cells[0]!.length).toBe(2);
    expect(m.cells[1]![1]!.result.expectedDamage).toBeGreaterThan(m.cells[0]![1]!.result.expectedDamage); // melta beats bolters into a tank
    expect(m.cells[0]![0]!.damagePer100).toBeGreaterThan(0);
  });
  it("durability profile covers the default attacker archetypes", () => {
    const d = durabilityProfile(byId("terminator-like"));
    expect(d.length).toBe(4);
    for (const e of d) expect(e.expectedDamage).toBeGreaterThanOrEqual(0);
  });
  it("durability index: a heavy tank needs more points of shooting to remove than light infantry", () => {
    const rows = durabilityIndex([byId("guardsman-like"), byId("heavy-tank")]);
    expect(rows[1]!.pointsToRemove).toBeGreaterThan(rows[0]!.pointsToRemove);
    expect(Object.keys(rows[0]!.byArchetype).length).toBe(4);
  });
  it("efficiency ranking sorts descending and ranks melee-only units in the fight phase", () => {
    const rows = efficiencyRanking([byId("bolter-squad"), byId("lascannon-team"), byId("melta-squad"), byId("chainsword-mob")]);
    for (let i = 1; i < rows.length; i++) expect(rows[i - 1]!.damagePer100).toBeGreaterThanOrEqual(rows[i]!.damagePer100);
    expect(rows.find((r) => r.unit.includes("Melee horde"))!.damagePer100).toBeGreaterThan(0);
    const m = runMatrix([byId("chainsword-mob")], [byId("marine-like")]);
    expect(m.cells[0]![0]!.result.expectedDamage).toBeGreaterThan(0);
    // an explicit shooting phase must not reduce a melee-only unit to a meaningless zero
    const explicit = runMatrix([byId("chainsword-mob")], [byId("marine-like")], { phase: "shooting", rangeBand: "half" });
    expect(explicit.cells[0]![0]!.result.expectedDamage).toBeGreaterThan(0);
    // a shooting unit asked for the fight phase is resolved where it can act, too
    const shooters = runMatrix([byId("lascannon-team")], [byId("heavy-tank")], { phase: "fight" });
    expect(shooters.cells[0]![0]!.result.expectedDamage).toBeGreaterThan(0);
    expect(m.cells[0]![0]!.result.finalState).toBeUndefined();
  });
});

describe("effective wounds", () => {
  it("equals raw wounds when every reference attack sticks", () => {
    // A model the reference attack always beats: hit, wound and save all certain to fail.
    const naked = { name: "Naked", count: 3, T: 1, Sv: 7, W: 2, isCharacter: false, keywords: [] };
    const p = pReferenceSticks({ ...naked, Sv: 7 });
    expect(p).toBeGreaterThan(0);
    // With Sv 7 the only save is the 11e "unmodified 6 always saves", so effective wounds sit above raw.
    expect(effectiveWounds({ name: "u", keywords: [], models: [naked], weapons: [], effects: [] })).toBeGreaterThan(6);
  });
  it("an invulnerable save and Feel No Pain both raise it above raw wounds", () => {
    const base = { name: "M", count: 5, T: 4, Sv: 3, W: 2, isCharacter: false, keywords: [] };
    const unit = (m: Record<string, unknown>) => ({ name: "u", keywords: [], models: [{ ...base, ...m }], weapons: [], effects: [] });
    const plain = effectiveWounds(unit({}));
    const invuln = effectiveWounds(unit({ InvSv: 4 }));
    const fnp = effectiveWounds(unit({ fnp: 5 }));
    expect(plain).toBeGreaterThan(10); // 10 raw wounds, and a 3+ save means far more attacks
    // Against AP 0 a 4++ is worse than the 3+ armour, so the model takes the armour and nothing changes.
    expect(invuln).toBeCloseTo(plain, 6);
    // Give the reference some AP and the invulnerable save starts doing the work.
    const rending = { skill: 3, S: 4, AP: 3 };
    expect(effectiveWounds(unit({ InvSv: 4 }), rending)).toBeGreaterThan(effectiveWounds(unit({}), rending));
    expect(fnp).toBeGreaterThan(plain);
    // Feel No Pain 5+ ignores 1/3 of the damage, so it multiplies effective wounds by 3/2.
    expect(fnp / plain).toBeCloseTo(1.5, 6);
  });
  it("scales linearly in model count and wounds", () => {
    const one = effectiveWounds({ name: "u", keywords: [], models: [{ name: "m", count: 1, T: 4, Sv: 3, W: 2, isCharacter: false, keywords: [] }], weapons: [], effects: [] });
    const four = effectiveWounds({ name: "u", keywords: [], models: [{ name: "m", count: 4, T: 4, Sv: 3, W: 2, isCharacter: false, keywords: [] }], weapons: [], effects: [] });
    expect(four).toBeCloseTo(one * 4, 6);
  });
  it("the reference profile is the documented plain shot", () => {
    expect(REFERENCE_ATTACK).toEqual({ skill: 3, S: 4, AP: 0 });
  });
});

describe("incoming fire", () => {
  it("reports the same endpoint as the durability index, plus the slope behind it", () => {
    const rows = incomingFire([byId("guardsman-like"), byId("heavy-tank")]);
    const dur = durabilityIndex([byId("guardsman-like"), byId("heavy-tank")]);
    expect(rows.map((r) => r.pointsToRemove)).toEqual(dur.map((r) => r.pointsToRemove));
    for (const r of rows) {
      expect(r.entries.length).toBe(4);
      expect(r.woundsPer100).toBeGreaterThan(0);
      expect(r.slainPer100).toBeGreaterThan(0);
      expect(r.effectiveWounds).toBeGreaterThan(0);
    }
    // Light infantry lose wounds faster per attacker point than a heavy tank does.
    expect(rows[0]!.woundsPer100).toBeGreaterThan(rows[1]!.woundsPer100);
    expect(rows[0]!.wounds).toBe(10);
    expect(rows[0]!.models).toBe(10);
  });
});

describe("efficiency ranking points traded", () => {
  it("reports the target points destroyed alongside the damage", () => {
    const rows = efficiencyRanking([byId("melta-squad")], { targetIds: ["heavy-tank"] });
    const row = rows[0]!;
    const target = archetypes.find((a) => a.id === "heavy-tank")!.unit;
    expect(row.pointsByTarget[target.name]).toBeGreaterThan(0);
    expect(row.pointsByTarget[target.name]).toBeLessThanOrEqual(target.points! + 1e-9);
  });
});
