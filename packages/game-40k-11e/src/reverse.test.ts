import { describe, expect, it } from "vitest";
import { archetypes, reverseMathhammer, sensitivity, makeScenario, SENSITIVITY_VARIANTS, CHANNEL_INFO } from "./index";
import { runScenario } from "./scenario";

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

describe("the sampled fallback keeps the chain", () => {
  // When a target's state space is too large to solve exactly, `reverseMathhammer` falls back to the
  // sampled backend for that member of the group. That fallback has to be handed the same starting
  // state as the exact run it replaces. Without it the member fires into a fresh, undamaged target
  // and its damage is added on top of what the group had already done: for a melta squad firing
  // second into a heavy tank the kill chance read 0.07 where the truth is 0.30.
  const tank = a("heavy-tank");
  const melta = a("melta-squad");
  const shot = (backend: "exact" | "mc", initialState?: number[]) =>
    runScenario(makeScenario(melta, tank, { phase: "shooting", rangeBand: "half", backend }), initialState ? { initialState } : {});

  it("starts a sampled run from the state it was given", () => {
    const first = shot("exact");
    const state = first.finalState;
    expect(state).toBeDefined();

    const exactChain = shot("exact", state);
    const sampledChain = shot("mc", state);
    const sampledAlone = shot("mc");

    // The sampled chain tracks the exact chain, and both are well clear of a run that forgot the state.
    expect(sampledChain.pKill).toBeCloseTo(exactChain.pKill!, 1);
    expect(sampledChain.expectedDamage).toBeCloseTo(exactChain.expectedDamage, 0);
    expect(Math.abs(sampledAlone.pKill! - exactChain.pKill!)).toBeGreaterThan(0.1);
  });
});
