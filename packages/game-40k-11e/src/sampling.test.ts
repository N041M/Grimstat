import { describe, expect, it } from "vitest";
import type { ScenarioContext, ScenarioUnit } from "@grimstat/schema";
import { archetypes } from "./archetypes";
import { combineSampling, durabilityProfile, efficiencyRanking, incomingFire, makeScenario, phaseFor } from "./analysis";
import { reverseMathhammer } from "./reverse";
import { sensitivity } from "./sensitivity";
import { runScenario } from "./scenario";

const byId = (id: string) => archetypes.find((a) => a.id === id)!.unit;

/** Every analysis in this file is pinned at this sample size, because the interval depends on it. */
const SAMPLED: Partial<ScenarioContext> = { rangeBand: "half", backend: "mc", mcIterations: 2000 };

describe("combining the sampling of several runs", () => {
  it("averages the half-widths for a mean and adds them for a sum", () => {
    const parts = [
      { backend: "mc" as const, ciHalfWidth: 0.4 },
      { backend: "exact" as const },
      { backend: "mc" as const, ciHalfWidth: 0.2 },
      { backend: "exact" as const },
    ];
    // A mean over four runs. The two exact ones contribute nothing to the sum and still count in the
    // divisor, because each of them contributed a value to the mean.
    expect(combineSampling(parts, 4).backend).toBe("mc");
    expect(combineSampling(parts, 4).ciHalfWidth).toBeCloseTo(0.15, 12);
    // A sum leaves the total undivided.
    expect(combineSampling(parts).ciHalfWidth).toBeCloseTo(0.6, 12);
  });

  it("adds the half-widths rather than taking their root-sum-square", () => {
    const parts = [
      { backend: "mc" as const, ciHalfWidth: 0.4 },
      { backend: "mc" as const, ciHalfWidth: 0.2 },
    ];
    const rss = Math.sqrt(0.4 ** 2 + 0.2 ** 2);
    expect(rss).toBeCloseTo(0.4472135955, 9);
    // The root-sum-square is a quarter narrower here, and it only holds when the two runs' errors are
    // independent. One hardcoded seed leaves them positively correlated, so it would read narrower
    // than the method can support.
    expect(combineSampling(parts).ciHalfWidth).toBeCloseTo(0.6, 12);
    expect(combineSampling(parts).ciHalfWidth! / rss).toBeCloseTo(1.3416407865, 9);
  });

  it("leaves a figure every run solved exactly without a half-width at all", () => {
    const out = combineSampling([{ backend: "exact" }, { backend: "exact" }], 2);
    expect(out.backend).toBe("exact");
    expect(out.ciHalfWidth).toBeUndefined();
    // The field is absent instead of holding a zero, which would read as sampled and certain.
    expect("ciHalfWidth" in out).toBe(false);
  });

  it("quotes nothing for a sampled figure no run could put an interval on", () => {
    const out = combineSampling([{ backend: "mc" }, { backend: "exact" }], 2);
    expect(out).toEqual({ backend: "mc" });
    expect("ciHalfWidth" in out).toBe(false);
  });

  it("ignores a half-width that is not a finite number", () => {
    const out = combineSampling([{ backend: "mc", ciHalfWidth: Number.POSITIVE_INFINITY }, { backend: "mc", ciHalfWidth: 0.5 }], 2);
    expect(out.backend).toBe("mc");
    expect(out.ciHalfWidth).toBeCloseTo(0.25, 12);
  });
});

describe("the efficiency ranking's interval", () => {
  const melta = byId("melta-squad");
  const targetIds = ["marine-like", "heavy-tank"];

  it("is the mean of the target runs' half-widths, denominated the way the row is", () => {
    const row = efficiencyRanking([melta], { targetIds, context: SAMPLED })[0]!;
    expect(row.backend).toBe("mc");
    expect(row.perPoints).toBe(true);
    expect(melta.points).toBe(110);

    // Re-run each target on its own and put its half-width on the row's per-100-points scale.
    const halves = targetIds.map((id) => {
      const t = byId(id);
      const r = runScenario(makeScenario(melta, t, phaseFor(melta, SAMPLED)));
      expect(r.backend).toBe("mc");
      return (r.ciHalfWidth! / 110) * 100;
    });
    expect(halves[0]).toBeCloseTo(0.0881929714, 9);
    expect(halves[1]).toBeCloseTo(0.1798598332, 9);
    expect(row.ciHalfWidth).toBeCloseTo((halves[0]! + halves[1]!) / 2, 12);
    expect(row.ciHalfWidth).toBeCloseTo(0.1340264023, 9);
    // The interval is on the same scale as the figure, which is damage per 100 points here.
    expect(row.damagePer100).toBeCloseTo(4.2663636364, 9);
  });

  it("stays on raw damage when the column does", () => {
    const unpriced: ScenarioUnit = { ...melta, name: "Unpriced melta", points: undefined };
    const rows = efficiencyRanking([melta, unpriced], { targetIds, context: SAMPLED });
    expect(rows.every((r) => r.perPoints === false)).toBe(true);
    // Undenominated, the row's interval is the plain mean of the two runs' half-widths, which is the
    // per-100 reading above scaled back by 110 / 100.
    for (const r of rows) expect(r.ciHalfWidth).toBeCloseTo(0.1474290425, 9);
    expect(rows[0]!.ciHalfWidth).toBeCloseTo((0.1340264023 * 110) / 100, 6);
  });

  it("is absent on a row every target was solved exactly for", () => {
    const row = efficiencyRanking([melta], { targetIds, context: { rangeBand: "half" } })[0]!;
    expect(row.backend).toBe("exact");
    expect(row.ciHalfWidth).toBeUndefined();
    expect("ciHalfWidth" in row).toBe(false);
  });
});

describe("the durability profile's interval", () => {
  it("comes straight off the one run behind the entry", () => {
    const [entry] = durabilityProfile(byId("marine-like"), { attackerIds: ["bolter-squad"], context: SAMPLED });
    const bolters = byId("bolter-squad");
    const r = runScenario(makeScenario(bolters, byId("marine-like"), phaseFor(bolters, { ...SAMPLED, phase: "shooting", rangeBand: "half" })));
    expect(entry!.backend).toBe("mc");
    expect(entry!.ciHalfWidth).toBe(r.ciHalfWidth);
    expect(entry!.ciHalfWidth).toBeCloseTo(0.0602825236, 9);
    expect(entry!.expectedDamage).toBeCloseTo(2.217, 9);
  });

  it("is absent when the run was solved exactly", () => {
    const [entry] = durabilityProfile(byId("marine-like"), { attackerIds: ["bolter-squad"] });
    expect(entry!.backend).toBe("exact");
    expect("ciHalfWidth" in entry!).toBe(false);
  });
});

describe("incoming fire's interval", () => {
  const attackerIds = ["bolter-squad", "melta-squad"];

  it("averages the archetypes' rates after putting each on the rate's own scale", () => {
    const row = incomingFire([byId("marine-like")], { attackerIds, context: SAMPLED })[0]!;
    expect(row.backend).toBe("mc");
    expect(row.entries.length).toBe(2);

    for (const e of row.entries) {
      expect(e.backend).toBe("mc");
      // A sampled run hands back no state, so the chain falls to the extrapolation, where the rate is
      // the first activation's damage scaled by 100 / points. That is what makes the scaling exact.
      expect(e.exact).toBe(false);
      expect(e.woundsPer100).toBeCloseTo((e.expectedDamage / e.attackerPoints) * 100, 12);
    }
    const scaled = row.entries.map((e) => (e.ciHalfWidth! / e.attackerPoints) * 100);
    expect(scaled[0]).toBeCloseTo(0.0376765772, 9);
    expect(scaled[1]).toBeCloseTo(0.0881929714, 9);
    expect(row.ciHalfWidth).toBeCloseTo((scaled[0]! + scaled[1]!) / 2, 12);
    expect(row.ciHalfWidth).toBeCloseTo(0.0629347743, 9);
    expect(row.woundsPer100).toBeCloseTo(2.8105397727, 9);
  });

  it("puts each entry's own half-width on that entry's expected damage", () => {
    const row = incomingFire([byId("marine-like")], { attackerIds: ["bolter-squad"], context: SAMPLED })[0]!;
    const bolters = byId("bolter-squad");
    const r = runScenario(makeScenario(bolters, byId("marine-like"), phaseFor(bolters, { ...SAMPLED, phase: "shooting", rangeBand: "half" })));
    expect(row.entries[0]!.ciHalfWidth).toBe(r.ciHalfWidth);
    expect(row.entries[0]!.expectedDamage).toBe(r.expectedDamage);
  });

  it("is absent when every archetype was chained exactly", () => {
    const row = incomingFire([byId("marine-like")], { attackerIds, context: { rangeBand: "half" } })[0]!;
    expect(row.backend).toBe("exact");
    expect("ciHalfWidth" in row).toBe(false);
    for (const e of row.entries) {
      expect(e.exact).toBe(true);
      expect(e.backend).toBe("exact");
      expect("ciHalfWidth" in e).toBe(false);
    }
  });
});

describe("reverse mathhammer's interval", () => {
  /**
   * Sixty models in three profiles put the defender's state space past what the exact backend will
   * solve, which is the one route by which this analysis samples: it asks for the exact backend and
   * falls back only when that refuses.
   */
  const blob: ScenarioUnit = {
    name: "Huge blob",
    keywords: [],
    models: [
      { name: "A", count: 20, T: 4, Sv: 3, W: 3, isCharacter: false, keywords: [] },
      { name: "B", count: 20, T: 5, Sv: 4, W: 3, isCharacter: false, keywords: [] },
      { name: "C", count: 20, T: 6, Sv: 2, W: 3, isCharacter: false, keywords: [] },
    ],
    weapons: [],
    attached: [],
    effects: [],
    points: 500,
  };

  it("adds the members' half-widths across a combination", () => {
    const r = reverseMathhammer({
      target: blob,
      candidates: [
        { id: "melta", unit: byId("melta-squad") },
        { id: "bolters", unit: byId("bolter-squad") },
      ],
      metric: "expectedDamage",
      threshold: 1,
      context: { rangeBand: "half" },
      maxCombo: 2,
    });
    expect(r.warnings.some((w) => w.includes("sampled"))).toBe(true);
    const single = (id: string) => r.rows.find((x) => x.candidateIds.join() === id)!;
    const pair = r.rows.find((x) => x.candidateIds.length === 2)!;
    expect(single("melta").backend).toBe("mc");
    expect(single("melta").ciHalfWidth).toBeCloseTo(0.0633670923, 9);
    expect(single("bolters").ciHalfWidth).toBeCloseTo(0.0228292022, 9);
    // The two are fired in sequence and their damage is added, so the interval is the plain sum.
    expect(pair.ciHalfWidth).toBeCloseTo(single("melta").ciHalfWidth! + single("bolters").ciHalfWidth!, 12);
    expect(pair.ciHalfWidth).toBeCloseTo(0.0861962945, 9);
    expect(pair.expectedDamage).toBeCloseTo(7.0611, 9);
  });

  it("is absent on a combination solved exactly", () => {
    const r = reverseMathhammer({
      target: byId("marine-like"),
      candidates: [
        { id: "melta", unit: byId("melta-squad") },
        { id: "bolters", unit: byId("bolter-squad") },
      ],
      metric: "expectedDamage",
      threshold: 1,
      context: { rangeBand: "half" },
      maxCombo: 2,
    });
    for (const row of r.rows) {
      expect(row.backend).toBe("exact");
      expect("ciHalfWidth" in row).toBe(false);
    }
  });
});

describe("what-if levels and deltas", () => {
  const base = makeScenario(byId("bolter-squad"), byId("marine-like"), SAMPLED);

  it("carries an interval on the levels and none on the deltas", () => {
    const r = sensitivity(base, { variantIds: ["plus1-hit"] });
    const v = r.variants[0]!;
    expect(r.base.backend).toBe("mc");
    expect(r.base.ciHalfWidth).toBeCloseTo(0.0602825236, 9);
    expect(v.backend).toBe("mc");
    expect(v.ciHalfWidth).toBeCloseTo(0.0684846515, 9);
    expect(v.deltaBackend).toBe("mc");
    expect(v.deltaDamage).toBeCloseTo(0.6195, 9);
    // The two runs share one seed, so the delta is far tighter than either level's interval implies.
    // Nothing is quoted for it until the paired difference's own spread is measured.
    expect("deltaCiHalfWidth" in v).toBe(false);
    expect(Object.keys(v).filter((k) => k.startsWith("delta"))).toEqual(["deltaDamage", "deltaSlain", "deltaPKill", "deltaBackend"]);
  });

  it("marks the delta sampled when either run was", () => {
    const exact = sensitivity(makeScenario(byId("bolter-squad"), byId("marine-like"), { rangeBand: "half" }), { variantIds: ["plus1-hit"] });
    expect(exact.base.backend).toBe("exact");
    expect(exact.variants[0]!.deltaBackend).toBe("exact");
    expect("ciHalfWidth" in exact.base).toBe(false);
    expect("ciHalfWidth" in exact.variants[0]!).toBe(false);
  });
});
