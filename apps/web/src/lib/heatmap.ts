import type { MatrixCell, MatrixResult } from "@grimstat/game-40k-11e";

/** Pure helpers behind the Matrix heatmap. No DOM. */

export type MatrixMetric = "damage" | "slain" | "pKill" | "damagePer100" | "pointsPer100";
export const MATRIX_METRICS: MatrixMetric[] = ["damage", "slain", "pKill", "damagePer100", "pointsPer100"];

/** Value of one metric for a cell; undefined when the metric needs points the units do not have. */
export function metricValue(cell: MatrixCell, metric: MatrixMetric): number | undefined {
  switch (metric) {
    case "damage":
      return cell.result.expectedDamage;
    case "slain":
      return cell.result.expectedSlain;
    case "pKill":
      return cell.result.pKill;
    case "damagePer100":
      return cell.damagePer100;
    case "pointsPer100":
      return cell.pointsTradePer100;
  }
}

/** Probabilities are averaged in the totals; everything else is summed. */
export function metricIsAverage(metric: MatrixMetric): boolean {
  return metric === "pKill";
}

export interface HeatColour {
  /** Position in the scale, 0..1 (NaN-safe; 0 when undefined). */
  t: number;
  /** Ink opacity of the cell, `ALPHA_BASE + ALPHA_SPAN × t`. */
  alpha: number;
  /** CSS background: the ink token at `alpha`, so it is `rgba(23,24,27,α)` light and `rgba(237,236,232,α)` dark. */
  background: string;
  /** CSS text colour, or undefined to inherit (dark cells flip to the inverse ink). */
  color: string | undefined;
}

/** Cell opacity at the bottom of the scale, and how much it grows across it. */
export const ALPHA_BASE = 0.04;
export const ALPHA_SPAN = 0.7;
/** Scale position past which the label flips to the inverse ink so it stays legible on a dark cell. */
export const FLIP_AT = 0.55;

/** Position of `value` on the linear scale between `min` and `max`, clamped to 0..1. */
export function heatT(value: number, min: number, max: number): number {
  if (!Number.isFinite(min) || !Number.isFinite(max) || max - min <= 1e-12) return value > 0 ? 0.5 : 0;
  return Math.max(0, Math.min(1, (value - min) / (max - min)));
}

/**
 * Colour of a cell for `value` on a linear scale between `min` and `max`.
 *
 * The ramp is a single ink at a growing opacity rather than a hue sweep: the numbers stay readable
 * at every step, which naive heatmap palettes do not manage, and it needs no second colour token.
 */
export function heatColour(value: number | undefined, min: number, max: number): HeatColour {
  if (value === undefined || !Number.isFinite(value)) return { t: 0, alpha: 0, background: "transparent", color: undefined };
  const t = heatT(value, min, max);
  const alpha = ALPHA_BASE + ALPHA_SPAN * t;
  return {
    t,
    alpha,
    background: `color-mix(in srgb, var(--ink) ${(alpha * 100).toFixed(1)}%, transparent)`,
    color: t > FLIP_AT ? "var(--btn-fg)" : "var(--ink-2)",
  };
}

/** Eight swatches sampling the same ramp, for the legend strip under the matrix. */
export function heatRamp(min: number, max: number, steps = 8): HeatColour[] {
  return Array.from({ length: steps }, (_, i) => heatColour(min + (i / Math.max(1, steps - 1)) * (max - min), min, max));
}

export interface HeatmapModel {
  /** values[a][d] for the chosen metric. */
  values: Array<Array<number | undefined>>;
  /** Per-attacker aggregate across defenders. */
  rowTotals: Array<number | undefined>;
  /** Per-defender aggregate across attackers. */
  colTotals: Array<number | undefined>;
  min: number;
  max: number;
}

function aggregate(xs: Array<number | undefined>, average: boolean): number | undefined {
  const present = xs.filter((x): x is number => x !== undefined && Number.isFinite(x));
  if (!present.length) return undefined;
  const sum = present.reduce((s, x) => s + x, 0);
  return average ? sum / present.length : sum;
}

/** Metric values plus totals and the colour-scale range for a matrix. */
export function heatmapModel(matrix: MatrixResult, metric: MatrixMetric): HeatmapModel {
  const values = matrix.cells.map((row) => row.map((c) => metricValue(c, metric)));
  const average = metricIsAverage(metric);
  const rowTotals = values.map((row) => aggregate(row, average));
  const colTotals = matrix.defenders.map((_, d) => aggregate(values.map((row) => row[d]), average));
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const row of values) for (const v of row) if (v !== undefined && Number.isFinite(v)) (min = Math.min(min, v)), (max = Math.max(max, v));
  if (!Number.isFinite(min)) (min = 0), (max = 0);
  return { values, rowTotals, colTotals, min, max };
}
