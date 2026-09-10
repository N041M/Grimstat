import { describe, expect, it } from "vitest";
import type { MatrixCell, MatrixResult } from "@grimstat/game-40k-11e";
import type { SimResult } from "@grimstat/schema";
import { ALPHA_BASE, ALPHA_SPAN, FLIP_AT, heatColour, heatRamp, heatT, heatmapModel, metricIsAverage, metricValue } from "./heatmap";
import { MATRIX_CSV_HEADER, csvEscape, csvLine, matrixToCsv } from "./matrixCsv";

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
    const mid = heatColour(5, 0, 10);
    const hi = heatColour(10, 0, 10);
    expect(lo.t).toBe(0);
    expect(mid.t).toBeCloseTo(0.5);
    expect(hi.t).toBe(1);
    expect(lo.alpha).toBeCloseTo(ALPHA_BASE);
    expect(mid.alpha).toBeCloseTo(ALPHA_BASE + ALPHA_SPAN / 2);
    expect(hi.alpha).toBeCloseTo(ALPHA_BASE + ALPHA_SPAN);
    // Painted as the ink token at that opacity, so it is rgba(23,24,27,α) light and rgba(237,236,232,α) dark.
    expect(lo.background).toBe("color-mix(in srgb, var(--ink) 4.0%, transparent)");
    expect(hi.background).toBe("color-mix(in srgb, var(--ink) 74.0%, transparent)");
    expect(heatT(2.5, 0, 10)).toBeCloseTo(0.25);
  });

  it("flips the label to the inverse ink past the halfway-ish point only", () => {
    expect(heatColour(5, 0, 10).color).toBe("var(--ink-2)");
    expect(heatColour(FLIP_AT * 10, 0, 10).color).toBe("var(--ink-2)");
    expect(heatColour(FLIP_AT * 10 + 0.01, 0, 10).color).toBe("var(--btn-fg)");
    expect(heatColour(10, 0, 10).color).toBe("var(--btn-fg)");
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
    expect(swatches).toHaveLength(8);
    expect(swatches[0]!.alpha).toBeCloseTo(ALPHA_BASE);
    expect(swatches[7]!.alpha).toBeCloseTo(ALPHA_BASE + ALPHA_SPAN);
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
