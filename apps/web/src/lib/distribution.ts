/**
 * Pure helpers behind the Calculator's discrete damage chart.
 *
 * The outcome is integer-valued, so the chart draws one bar per damage value rather than a smoothed
 * curve. Bars inside the interquartile range are drawn in `--ink`, the tails in `--dim`; the split is
 * computed here so it can be tested without a DOM.
 */

export interface DamageBar {
  /** The integer damage value this bar stands for. */
  value: number;
  /** P(damage = value). */
  p: number;
  /** Height as a fraction of the tallest bar, 0–1. */
  height: number;
  /** Inside the interquartile range (p25 ≤ value ≤ p75) — drawn in `--ink`. */
  inIqr: boolean;
}

export interface BarOptions {
  /** Trim the tail once the remaining mass per value falls below this. */
  epsilon?: number;
  /** Never draw more than this many bars (they would be sub-pixel wide). */
  maxBars?: number;
  /** Always draw at least this many, so a spiky distribution still reads as a chart. */
  minBars?: number;
}

const DEFAULTS: Required<BarOptions> = { epsilon: 0.0005, maxBars: 61, minBars: 12 };

/** Highest damage value worth drawing: the last one above `epsilon`, clamped to the min/max bar counts. */
export function barCount(pmf: readonly number[], opts: BarOptions = {}): number {
  const { epsilon, maxBars, minBars } = { ...DEFAULTS, ...opts };
  let last = 0;
  for (let i = 0; i < pmf.length; i++) if ((pmf[i] ?? 0) >= epsilon) last = i;
  const wanted = Math.max(last + 1, Math.min(minBars, pmf.length));
  return Math.max(1, Math.min(wanted, maxBars, Math.max(pmf.length, 1)));
}

/**
 * One bar per integer damage value, heights normalised to the tallest bar and each classified
 * against the interquartile range.
 */
export function damageBars(pmf: readonly number[], iqr: { p25: number; p75: number }, opts: BarOptions = {}): DamageBar[] {
  const n = barCount(pmf, opts);
  const slice = Array.from({ length: n }, (_, i) => pmf[i] ?? 0);
  const peak = slice.reduce((m, p) => Math.max(m, p), 0);
  return slice.map((p, value) => ({
    value,
    p,
    height: peak > 0 ? p / peak : 0,
    inIqr: value >= iqr.p25 && value <= iqr.p75,
  }));
}

/**
 * The same bars read cumulatively: P(damage >= value). This is the question a player actually asks
 * ("will this kill it?"), which the density view cannot answer by eye.
 */
export function cumulativeBars(pmf: readonly number[], iqr: { p25: number; p75: number }, opts: BarOptions = {}): DamageBar[] {
  const n = barCount(pmf, opts);
  const slice = Array.from({ length: n }, (_, i) => pmf[i] ?? 0);
  const total = pmf.reduce((s2, p) => s2 + p, 0);
  let seen = 0;
  return slice.map((p, value) => {
    const atLeast = Math.max(0, Math.min(1, total - seen));
    seen += p;
    return { value, p: atLeast, height: atLeast, inIqr: value >= iqr.p25 && value <= iqr.p75 };
  });
}

/** How close to the peak an outcome must be to count as "modal" (drawn in `--ink`, not `--dim`). */
export const MODAL_SHARE = 0.8;

export interface SlainRow {
  /** Number of models slain. */
  n: number;
  p: number;
  /** Bar width as a fraction of the trough. */
  width: number;
  /** One of the modal outcomes — the bulk of the distribution. */
  modal: boolean;
}

/**
 * Models-slain rows: bar widths relative to the most likely outcome, with the outcomes at (or near)
 * the mode marked so they can be drawn in `--ink` and the rest in `--dim`.
 */
export function slainRows(pmf: readonly number[], share = MODAL_SHARE): SlainRow[] {
  const peak = pmf.reduce((m, p) => Math.max(m, p ?? 0), 0);
  return pmf.map((raw, n) => {
    const p = raw ?? 0;
    return { n, p, width: peak > 0 ? p / peak : 0, modal: peak > 0 && p >= share * peak };
  });
}

/** Axis labels every `every` values (0, 5, 10, …); other positions render an empty cell. */
export function axisTick(value: number, every = 5): string {
  return value % every === 0 ? String(value) : "";
}
