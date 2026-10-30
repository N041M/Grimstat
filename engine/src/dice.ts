import { type PMF, convolve, delta, mean, mixture, trim } from "./pmf";

export interface DiceSpec {
  count: number; // number of dice (0 = flat)
  sides: 3 | 6 | 0;
  bonus: number;
}

const RE = /^\s*(\d+)?\s*([dD])?\s*(3|6)?\s*(?:([+-])\s*(\d+))?\s*$/;

/** Parse "3", "D6", "2D6", "D3+1", "2D6+2", " d3 " */
export function parseDice(expr: string | number): DiceSpec {
  if (typeof expr === "number") return { count: 0, sides: 0, bonus: Math.max(0, Math.round(expr)) };
  const m = RE.exec(expr);
  if (!m) throw new Error(`Invalid dice expression: "${expr}"`);
  const [, n, d, s, sign, b] = m;
  const bonus = b ? (sign === "-" ? -1 : 1) * Number(b) : 0;
  if (!d) {
    // plain number like "3" — captured in `n`
    if (n === undefined) throw new Error(`Invalid dice expression: "${expr}"`);
    return { count: 0, sides: 0, bonus: Number(n) + bonus };
  }
  const sides = (s ? Number(s) : 6) as 3 | 6;
  return { count: n ? Number(n) : 1, sides, bonus };
}

/**
 * How a roll of a dice expression is re-rolled.
 *
 * "ones" re-rolls each die that shows a 1, once. "any" lets the player re-roll the whole roll once
 * after seeing it, and it is read as the choice that gets the most from the roll. The dice are
 * rolled again when they come to less than their average and kept otherwise. A fresh roll is
 * expected to come to the average, so this gives the highest expected result. A result equal to the
 * average is kept. Either re-roll is made on the dice alone, before any number is added to them. A
 * flat value has nothing to re-roll.
 */
export type DiceReroll = "ones" | "any";

export function dicePMF(expr: string | number, reroll: DiceReroll | null = null): PMF {
  const spec = parseDice(expr);
  if (spec.count === 0 || spec.sides === 0) return delta(Math.max(0, spec.bonus));
  const face = 1 / spec.sides;
  // A die re-rolled on a 1 shows a 1 only when the fresh roll is a 1 as well, so each face takes a
  // share of the 1's chance.
  const single: PMF = new Array<number>(spec.sides + 1).fill(reroll === "ones" ? face + face * face : face);
  single[0] = 0;
  if (reroll === "ones") single[1] = face * face;
  let p: PMF = delta(0);
  for (let i = 0; i < spec.count; i++) p = convolve(p, single);
  if (reroll === "any") p = belowAverageRerolled(p, (spec.count * (spec.sides + 1)) / 2);
  if (spec.bonus !== 0) {
    const shifted: PMF = [];
    for (let k = 0; k < p.length; k++) {
      const v = Math.max(0, k + spec.bonus);
      shifted[v] = (shifted[v] ?? 0) + (p[k] ?? 0);
    }
    for (let i = 0; i < shifted.length; i++) shifted[i] = shifted[i] ?? 0;
    p = trim(shifted);
  }
  return p;
}

/** A roll's distribution once each result below `average` has been rolled again, once. */
function belowAverageRerolled(p: PMF, average: number): PMF {
  let low = 0;
  for (let k = 0; k < p.length && k < average; k++) low += p[k] ?? 0;
  return p.map((pk, k) => (k < average ? 0 : pk) + low * pk);
}

/**
 * Mean of the same distribution `dicePMF` builds, floor included.
 *
 * A negative bonus is capped at zero roll by roll rather than on the total, which lifts the mean of
 * "D6-2" from the 1.5 a plain sum gives to 1.667. The two closed forms cover every expression that
 * can never reach the floor: a flat number, and any roll whose lowest result already clears it. That
 * is all but a handful of weapon profiles, and the handful falls through to the distribution itself.
 */
export function diceMean(expr: string | number): number {
  const spec = parseDice(expr);
  if (spec.count === 0 || spec.sides === 0) return Math.max(0, spec.bonus);
  if (spec.count + spec.bonus >= 0) return spec.count * ((spec.sides + 1) / 2) + spec.bonus;
  return mean(dicePMF(expr));
}

export function formatDice(spec: DiceSpec): string {
  if (spec.count === 0) return String(spec.bonus);
  const base = `${spec.count > 1 ? spec.count : ""}D${spec.sides}`;
  return spec.bonus ? `${base}${spec.bonus > 0 ? "+" : ""}${spec.bonus}` : base;
}

export { mixture };
