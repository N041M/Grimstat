import { describe, expect, it } from "vitest";
import type { MatrixCell, MatrixResult } from "@grimstat/game-40k-11e";
import type { SimResult } from "@grimstat/schema";
import { heatColour, heatmapModel, metricIsAverage, metricValue } from "./heatmap";
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
  it("maps min → faint and max → strong, monotonically", () => {
    const lo = heatColour(0, 0, 10);
    const mid = heatColour(5, 0, 10);
    const hi = heatColour(10, 0, 10);
    expect(lo.t).toBe(0);
    expect(mid.t).toBeCloseTo(0.5);
    expect(hi.t).toBe(1);
    expect(lo.background).toContain("6%");
    expect(hi.background).toContain("86%");
    expect(lo.color).toBeUndefined();
    expect(hi.color).toBe("var(--accent-contrast)");
    const pct = (c: ReturnType<typeof heatColour>) => Number(/(\d+)%/.exec(c.background)?.[1]);
    expect(pct(lo)).toBeLessThan(pct(mid));
    expect(pct(mid)).toBeLessThan(pct(hi));
  });

  it("clamps out-of-range values and tolerates a degenerate range", () => {
    expect(heatColour(-5, 0, 10).t).toBe(0);
    expect(heatColour(50, 0, 10).t).toBe(1);
    expect(heatColour(3, 3, 3).t).toBe(0.5);
    expect(heatColour(0, 0, 0).t).toBe(0);
  });

  it("renders missing values transparently", () => {
    expect(heatColour(undefined, 0, 1)).toEqual({ t: 0, background: "transparent", color: undefined });
    expect(heatColour(Number.NaN, 0, 1).background).toBe("transparent");
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
