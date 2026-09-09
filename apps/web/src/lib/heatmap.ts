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
  /** CSS background (theme-aware via color-mix on the accent token). */
  background: string;
  /** CSS text colour, or undefined to inherit (dark cells switch to the accent's contrast colour). */
  color: string | undefined;
}

const MIN_PCT = 6;
const MAX_PCT = 86;

/** Colour of a cell for `value` on a linear scale between `min` and `max`. */
export function heatColour(value: number | undefined, min: number, max: number): HeatColour {
  if (value === undefined || !Number.isFinite(value)) return { t: 0, background: "transparent", color: undefined };
  let t: number;
  if (!Number.isFinite(min) || !Number.isFinite(max) || max - min <= 1e-12) t = value > 0 ? 0.5 : 0;
  else t = Math.max(0, Math.min(1, (value - min) / (max - min)));
  const pct = Math.round(MIN_PCT + (MAX_PCT - MIN_PCT) * t);
  return { t, background: `color-mix(in srgb, var(--accent) ${pct}%, transparent)`, color: pct > 50 ? "var(--accent-contrast)" : undefined };
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
