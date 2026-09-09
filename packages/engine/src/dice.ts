import { type PMF, convolve, delta, mixture, trim } from "./pmf";

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

export function dicePMF(expr: string | number): PMF {
  const spec = parseDice(expr);
  if (spec.count === 0 || spec.sides === 0) return delta(Math.max(0, spec.bonus));
  const single: PMF = new Array<number>(spec.sides + 1).fill(1 / spec.sides);
  single[0] = 0;
  let p: PMF = delta(0);
  for (let i = 0; i < spec.count; i++) p = convolve(p, single);
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

export function diceMean(expr: string | number): number {
  const spec = parseDice(expr);
  return spec.count * ((spec.sides + 1) / 2) + spec.bonus;
}

export function formatDice(spec: DiceSpec): string {
  if (spec.count === 0) return String(spec.bonus);
  const base = `${spec.count > 1 ? spec.count : ""}D${spec.sides}`;
  return spec.bonus ? `${base}${spec.bonus > 0 ? "+" : ""}${spec.bonus}` : base;
}

export { mixture };
