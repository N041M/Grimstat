/**
 * Probability mass functions over non-negative integers: pmf[k] = P(X = k).
 * Zero-dependency, allocation-light helpers. All functions are pure.
 */
export type PMF = number[];

export const EPS = 1e-15;

export function delta(k: number): PMF {
  const p = new Array<number>(k + 1).fill(0);
  p[k] = 1;
  return p;
}

export function trim(p: PMF): PMF {
  let end = p.length;
  while (end > 1 && (p[end - 1] ?? 0) < EPS) end--;
  return end === p.length ? p : p.slice(0, end);
}

export function normalize(p: PMF): PMF {
  let s = 0;
  for (const v of p) s += v;
  if (s === 0) return delta(0);
  return p.map((v) => v / s);
}

export function convolve(a: PMF, b: PMF): PMF {
  if (a.length === 1) return b.map((v) => v * (a[0] ?? 0));
  if (b.length === 1) return a.map((v) => v * (b[0] ?? 0));
  const out = new Array<number>(a.length + b.length - 1).fill(0);
  for (let i = 0; i < a.length; i++) {
    const ai = a[i] ?? 0;
    if (ai < EPS) continue;
    for (let j = 0; j < b.length; j++) {
      out[i + j] = (out[i + j] ?? 0) + ai * (b[j] ?? 0);
    }
  }
  return trim(out);
}

/** p^{*n} (n-fold self-convolution) by exponentiation by squaring. */
export function convolvePow(p: PMF, n: number): PMF {
  if (n <= 0) return delta(0);
  let result: PMF = delta(0);
  let base = p;
  let e = n;
  while (e > 0) {
    if (e & 1) result = convolve(result, base);
    e >>= 1;
    if (e > 0) base = convolve(base, base);
  }
  return result;
}

/** Compound distribution: Σ_n count[n] · per^{*n}. */
export function compound(count: PMF, per: PMF): PMF {
  const parts: PMF[] = [];
  let pow: PMF = delta(0);
  let out: PMF = [];
  for (let n = 0; n < count.length; n++) {
    const w = count[n] ?? 0;
    if (w > EPS) out = addScaled(out, pow, w);
    if (n + 1 < count.length) pow = convolve(pow, per);
    parts.length = 0;
  }
  return trim(out.length ? out : delta(0));
}

export function addScaled(acc: PMF, p: PMF, w: number): PMF {
  const out = acc.length >= p.length ? acc.slice() : acc.concat(new Array<number>(p.length - acc.length).fill(0));
  for (let i = 0; i < p.length; i++) out[i] = (out[i] ?? 0) + w * (p[i] ?? 0);
  return out;
}

export function mixture(parts: Array<{ w: number; pmf: PMF }>): PMF {
  let out: PMF = [];
  let total = 0;
  for (const { w, pmf } of parts) {
    if (w <= 0) continue;
    out = addScaled(out, pmf, w);
    total += w;
  }
  if (!out.length) return delta(0);
  return total > 0 && Math.abs(total - 1) > 1e-9 ? out.map((v) => v / total) : out;
}

export function binomial(n: number, p: number): PMF {
  if (n <= 0) return delta(0);
  const out = new Array<number>(n + 1).fill(0);
  // iterative binomial coefficients to avoid overflow
  let coef = 1;
  for (let k = 0; k <= n; k++) {
    out[k] = coef * Math.pow(p, k) * Math.pow(1 - p, n - k);
    coef = (coef * (n - k)) / (k + 1);
  }
  return out;
}

/** Each unit of the value is independently kept with probability `keep` (e.g. Feel No Pain thinning). */
export function thin(p: PMF, keep: number): PMF {
  if (keep >= 1) return p;
  if (keep <= 0) return delta(0);
  let out: PMF = [];
  for (let d = 0; d < p.length; d++) {
    const w = p[d] ?? 0;
    if (w < EPS) continue;
    out = addScaled(out, binomial(d, keep), w);
  }
  return trim(out.length ? out : delta(0));
}

/** Apply an integer-valued function to the support (e.g. damage reduction). */
export function mapPMF(p: PMF, f: (k: number) => number): PMF {
  const out: PMF = [];
  for (let k = 0; k < p.length; k++) {
    const w = p[k] ?? 0;
    if (w < EPS) continue;
    const v = Math.max(0, Math.round(f(k)));
    out[v] = (out[v] ?? 0) + w;
  }
  for (let i = 0; i < out.length; i++) out[i] = out[i] ?? 0;
  return trim(out.length ? out : delta(0));
}

export function mean(p: PMF): number {
  let m = 0;
  for (let k = 0; k < p.length; k++) m += k * (p[k] ?? 0);
  return m;
}

export function variance(p: PMF): number {
  const m = mean(p);
  let v = 0;
  for (let k = 0; k < p.length; k++) v += (k - m) * (k - m) * (p[k] ?? 0);
  return v;
}

export function cdf(p: PMF): number[] {
  const out: number[] = [];
  let acc = 0;
  for (const v of p) {
    acc += v;
    out.push(Math.min(1, acc));
  }
  return out;
}

/** P(X >= k) for k = 0..len-1 */
export function survival(p: PMF): number[] {
  const out = new Array<number>(p.length).fill(0);
  let acc = 0;
  for (let k = p.length - 1; k >= 0; k--) {
    acc += p[k] ?? 0;
    out[k] = Math.min(1, acc);
  }
  return out;
}

/** Smallest k with P(X <= k) >= q. */
export function percentile(p: PMF, q: number): number {
  let acc = 0;
  for (let k = 0; k < p.length; k++) {
    acc += p[k] ?? 0;
    if (acc >= q - 1e-12) return k;
  }
  return p.length - 1;
}

export function percentiles(p: PMF) {
  return { p5: percentile(p, 0.05), p25: percentile(p, 0.25), p50: percentile(p, 0.5), p75: percentile(p, 0.75), p95: percentile(p, 0.95) };
}

export function pmfFromHistogram(counts: number[], total: number): PMF {
  return trim(counts.map((c) => c / total));
}
