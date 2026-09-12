import { describe, expect, it } from "vitest";
import type { MatrixCell, MatrixResult } from "@grimstat/game-40k-11e";
import type { SimResult } from "@grimstat/schema";
import { HEAT_STEPS, ALPHA_BASE, ALPHA_SPAN, FLIP_AT, heatColour, heatRamp, heatT, heatmapModel, metricIsAverage, metricValue } from "./heatmap";
import { DURABILITY_CSV_HEADER, MATRIX_CSV_HEADER, TURN_PLAN_CSV_HEADER, TURN_TARGET_CSV_HEADER, TURN_TOTAL_CSV_HEADER, csvEscape, csvLine, durabilityToCsv, matrixToCsv, turnPlanToCsv } from "./matrixCsv";

function result(over: Partial<SimResult>): SimResult {
  return {
    backend: "exact",
    damagePMF: [1],
    slainPMF: [1],
    expectedDamage: 0,
    expectedSlain: 0,
    pKill: 0,
    pAtLeastSlain: [1],
    damagePercentiles: { p5: 0, p25: 0, p50: 0, p75: 0, p95: 0 },
    slainPercentiles: { p5: 0, p25: 0, p50: 0, p75: 0, p95: 0 },
    expectedWasted: 0,
    expectedSelfMortals: 0,
    weapons: [],
    coverage: { tier1: 0, tier2: 0, tier3: 0, unmodelled: [] },
    warnings: [],
    ...over,
  };
}

function cell(attacker: string, defender: string, over: Partial<SimResult>, extra: Partial<MatrixCell> = {}): MatrixCell {
  return { attacker, defender, result: result(over), ...extra };
}

const matrix: MatrixResult = {
  attackers: ["Bolters, \"ten\"", "Lascannons"],
  defenders: ["Marines", "Tank"],
  cells: [
    [cell("Bolters, \"ten\"", "Marines", { expectedDamage: 4, expectedSlain: 2, pKill: 0.1, attackerPoints: 160, defenderPoints: 90, expectedWasted: 0.5 }, { damagePer100: 2.5, pointsTradePer100: 22.5 }), cell("Bolters, \"ten\"", "Tank", { expectedDamage: 1, expectedSlain: 0, pKill: 0, attackerPoints: 160 }, { damagePer100: 0.625 })],
    [cell("Lascannons", "Marines", { expectedDamage: 3, expectedSlain: 1.5, pKill: 0.05 }), cell("Lascannons", "Tank", { expectedDamage: 6, expectedSlain: 0.3, pKill: 0.3 })],
  ],
};

describe("heatColour", () => {
  it("runs the alpha ramp from 0.04 to 0.74 across the range", () => {
    const lo = heatColour(0, 0, 10);
    const hi = heatColour(10, 0, 10);
    expect(lo.t).toBe(0);
    expect(hi.t).toBe(1);
    expect(lo.alpha).toBeCloseTo(ALPHA_BASE);
    expect(hi.alpha).toBeCloseTo(ALPHA_BASE + ALPHA_SPAN);
    // Painted as the ink token at that opacity, so it is rgba(23,24,27,α) light and rgba(237,236,232,α) dark.
    expect(lo.background).toBe("color-mix(in srgb, var(--ink) 4.0%, transparent)");
    expect(hi.background).toBe("color-mix(in srgb, var(--ink) 74.0%, transparent)");
  });

  it("snaps to six classes, so neighbouring cells are always separable", () => {
    const classes = [...new Set(Array.from({ length: 101 }, (_, i) => heatT(i / 10, 0, 10)))].sort((a, b) => a - b);
    expect(classes).toHaveLength(HEAT_STEPS);
    expect(classes[0]).toBe(0);
    expect(classes[HEAT_STEPS - 1]).toBe(1);
    // values within a class share a shade; the printed number carries the detail
    expect(heatT(2.5, 0, 10)).toBe(heatT(2.9, 0, 10));
    expect(heatT(2.5, 0, 10)).not.toBe(heatT(4.5, 0, 10));
  });

  it("flips the label to the inverse ink for the dark classes, and does so per class", () => {
    // with six classes the flip lands between them, so no cell sits ambiguously on the threshold
    expect(heatColour(0, 0, 10).color).toBe("var(--ink-2)");
    expect(heatColour(4, 0, 10).color).toBe("var(--ink-2)");
    expect(heatColour(10, 0, 10).color).toBe("var(--btn-fg)");
    expect(heatColour(FLIP_AT * 10 + 1, 0, 10).color).toBe("var(--btn-fg)");
  });

  it("clamps out-of-range values and tolerates a degenerate range", () => {
    expect(heatColour(-5, 0, 10).t).toBe(0);
    expect(heatColour(50, 0, 10).t).toBe(1);
    expect(heatColour(3, 3, 3).t).toBe(0.5);
    expect(heatColour(0, 0, 0).t).toBe(0);
  });

  it("renders missing values transparently", () => {
    expect(heatColour(undefined, 0, 1)).toEqual({ t: 0, alpha: 0, background: "transparent", color: undefined });
    expect(heatColour(Number.NaN, 0, 1).background).toBe("transparent");
  });
});

describe("heatRamp", () => {
  it("samples the ramp end to end for the legend strip", () => {
    const swatches = heatRamp(1.2, 14.6);
    expect(swatches).toHaveLength(HEAT_STEPS);
    expect(swatches[0]!.alpha).toBeCloseTo(ALPHA_BASE);
    expect(swatches[HEAT_STEPS - 1]!.alpha).toBeCloseTo(ALPHA_BASE + ALPHA_SPAN);
    const alphas = swatches.map((s) => s.alpha);
    expect([...alphas].sort((a, b) => a - b)).toEqual(alphas);
  });
});

describe("heatmapModel", () => {
  it("extracts the chosen metric with sums for additive metrics", () => {
    const m = heatmapModel(matrix, "damage");
    expect(m.values).toEqual([
      [4, 1],
      [3, 6],
    ]);
    expect(m.rowTotals).toEqual([5, 9]);
    expect(m.colTotals).toEqual([7, 7]);
    expect(m.min).toBe(1);
    expect(m.max).toBe(6);
  });

  it("averages probabilities and skips cells without points", () => {
    expect(metricIsAverage("pKill")).toBe(true);
    const p = heatmapModel(matrix, "pKill");
    expect(p.rowTotals[0]).toBeCloseTo(0.05);
    expect(p.colTotals[1]).toBeCloseTo(0.15);
    const per100 = heatmapModel(matrix, "damagePer100");
    expect(per100.values[1]).toEqual([undefined, undefined]);
    expect(per100.rowTotals[1]).toBeUndefined();
    expect(per100.colTotals[0]).toBe(2.5);
    expect(per100.min).toBe(0.625);
    expect(per100.max).toBe(2.5);
    expect(metricValue(matrix.cells[0]![0]!, "pointsPer100")).toBe(22.5);
  });

  it("handles an empty matrix", () => {
    const m = heatmapModel({ attackers: [], defenders: [], cells: [] }, "slain");
    expect(m).toEqual({ values: [], rowTotals: [], colTotals: [], min: 0, max: 0 });
  });
});

describe("matrix CSV", () => {
  it("escapes commas, quotes and newlines", () => {
    expect(csvEscape("plain")).toBe("plain");
    expect(csvEscape('a "b", c')).toBe('"a ""b"", c"');
    expect(csvEscape("line\nbreak")).toBe('"line\nbreak"');
    expect(csvEscape(undefined)).toBe("");
    expect(csvEscape(Number.NaN)).toBe("");
    expect(csvLine(["x", 1.5, undefined])).toBe("x,1.5,");
  });

  it("writes one row per pair with every metric", () => {
    const csv = matrixToCsv(matrix);
    const lines = csv.split("\r\n").filter(Boolean);
    expect(lines).toHaveLength(1 + 4);
    expect(lines[0]).toBe(MATRIX_CSV_HEADER.join(","));
    expect(lines[1]).toBe('"Bolters, ""ten""",160,Marines,90,4,2,0.1,2.5,22.5,0.5,exact');
    expect(lines[4]).toBe("Lascannons,,Tank,,6,0.3,0.3,,,0,exact");
    expect(csv.endsWith("\r\n")).toBe(true);
  });
});

describe("durability CSV", () => {
  it("names the defender on every row and leaves the per-100 column empty when the unit has no points", () => {
    const csv = durabilityToCsv("Intercessors", [
      { archetype: "Bolter squad", expectedDamage: 3.21, pKill: 0.125, damageTakenPer100: 2.5 },
      { archetype: "Lascannon team", expectedDamage: 6, pKill: 0.5 },
    ]);
    const lines = csv.split("\r\n").filter(Boolean);
    expect(lines[0]).toBe(DURABILITY_CSV_HEADER.join(","));
    expect(lines[1]).toBe("Intercessors,Bolter squad,3.21,0.125,2.5");
    expect(lines[2]).toBe("Intercessors,Lascannon team,6,0.5,");
    expect(csv.endsWith("\r\n")).toBe(true);
  });
});

describe("turn plan CSV", () => {
  const names = {
    attackers: [
      { id: "a1", name: "Devastators", points: 130 },
      { id: "a2", name: "Assault squad" },
    ],
    targets: [{ id: "t1", name: "Rhino", points: 75 }],
    options: [
      { id: "none", label: "No stratagem", cp: 0 },
      { id: "plus1-wound", label: "+1 to wound", cp: 1 },
    ],
  };
  const plan = {
    assignments: [
      { attackerId: "a2", targetId: "t1", expectedDamage: 2, expectedSlain: 0, pKillAfter: 0.6, order: 1 },
      { attackerId: "a1", targetId: "t1", optionId: "plus1-wound", expectedDamage: 7.5, expectedSlain: 0.75, pKillAfter: 0.25, order: 0 },
    ],
    targets: [{ targetId: "t1", expectedDamage: 9.5, expectedSlain: 0.9, pKill: 0.6, expectedPointsSlain: 67.5, expectedWasted: 1.5, slainPMF: [0.4, 0.6] }],
    totalExpectedPoints: 67.5,
    totalExpectedSlain: 0.9,
    totalExpectedDamage: 9.5,
    totalExpectedWasted: 1.5,
    cpSpent: 1,
    cpBudget: 3,
    objective: "points" as const,
    score: 67.5,
    evaluations: 12,
    slainPMF: [0.4, 0.6],
    warnings: [],
  };

  it("writes the assignments in firing order, then each target, then the totals", () => {
    const blocks = turnPlanToCsv(plan, names).split("\r\n\r\n");
    expect(blocks).toHaveLength(3);

    const assignments = blocks[0]!.split("\r\n");
    expect(assignments[0]).toBe(TURN_PLAN_CSV_HEADER.join(","));
    // Order 0 fires first even though it is second in the array.
    expect(assignments[1]).toBe("1,Devastators,130,Rhino,75,+1 to wound,1,7.5,0.75,0.25");
    expect(assignments[2]).toBe("2,Assault squad,,Rhino,75,,,2,0,0.6");

    const targets = blocks[1]!.split("\r\n");
    expect(targets[0]).toBe(TURN_TARGET_CSV_HEADER.join(","));
    expect(targets[1]).toBe("Rhino,75,9.5,0.9,0.6,67.5,1.5");

    const totals = blocks[2]!.split("\r\n");
    expect(totals[0]).toBe(TURN_TOTAL_CSV_HEADER.join(","));
    expect(totals[1]).toBe("points,67.5,1,3,67.5,0.9,9.5,1.5");
  });

  it("falls back to the id when a name is not in the view", () => {
    const csv = turnPlanToCsv(plan, { ...names, attackers: [] });
    expect(csv).toContain("1,a1,,Rhino,75,");
  });
});
