import { describe, expect, it } from "vitest";
import { archetypes, reverseMathhammer, sensitivity, makeScenario, SENSITIVITY_VARIANTS, CHANNEL_INFO } from "./index";

const a = (id: string) => archetypes.find((x) => x.id === id)!.unit;

describe("reverse mathhammer", () => {
  it("finds the cheapest unit or pair that kills the target with the required probability", () => {
    const r = reverseMathhammer({
      target: a("marine-like"),
      candidates: [
        { id: "bolters", unit: a("bolter-squad") },
        { id: "melta", unit: a("melta-squad") },
        { id: "las", unit: a("lascannon-team") },
        { id: "mob", unit: a("chainsword-mob") },
      ],
      metric: "pKill",
      threshold: 0.5,
      context: { rangeBand: "half" },
      maxCombo: 2,
    });
    expect(r.rows.length).toBe(4 + 6);
    expect(r.evaluations).toBeGreaterThan(4);
    const meeting = r.rows.filter((x) => x.meets);
    for (let i = 1; i < meeting.length; i++) expect(meeting[i - 1]!.points).toBeLessThanOrEqual(meeting[i]!.points);
    if (r.cheapest) {
      expect(r.cheapest.pKill).toBeGreaterThanOrEqual(0.5);
      expect(r.cheapest.points).toBe(Math.min(...meeting.map((x) => x.points)));
    }
    // melee-only candidates are resolved in the fight phase automatically
    expect(r.rows.find((x) => x.candidateIds.join() === "mob")!.expectedDamage).toBeGreaterThan(0);
  });
  it("expected damage metric and combination chaining respect the target's wounds", () => {
    const r = reverseMathhammer({ target: a("guardsman-like"), candidates: [{ id: "b1", unit: a("bolter-squad") }, { id: "b2", unit: a("bolter-squad") }], metric: "expectedSlain", threshold: 5, context: { rangeBand: "half" }, maxCombo: 2 });
    const pair = r.rows.find((x) => x.candidateIds.length === 2)!;
    expect(pair.expectedSlain).toBeLessThanOrEqual(10);
    expect(pair.expectedSlain).toBeGreaterThan(r.rows.find((x) => x.candidateIds.length === 1)!.expectedSlain);
  });
});

describe("sensitivity", () => {
  it("reports deltas for every variant and buffs never reduce expected damage", () => {
    const s = makeScenario(a("bolter-squad"), a("marine-like"), { rangeBand: "full" });
    const r = sensitivity(s);
    expect(r.variants.length).toBe(SENSITIVITY_VARIANTS.length);
    for (const v of r.variants) {
      if (v.side === "attacker") expect(v.deltaDamage).toBeGreaterThanOrEqual(-1e-9);
      else expect(v.deltaDamage).toBeLessThanOrEqual(1e-9);
    }
    expect(r.variants.find((v) => v.id === "half-range")!.deltaDamage).toBeGreaterThan(0);
    expect(r.variants.find((v) => v.id === "cover")!.deltaDamage).toBeLessThan(0);
    expect(CHANNEL_INFO.some((c) => c.channel === "hit-roll")).toBe(true);
  });
});
