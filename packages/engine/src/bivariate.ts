import { EPS, type PMF, binomial } from "./pmf";

/** Bivariate PMF over (a, b): B[a][b] = P(A = a, B = b). Rows are padded to equal length. */
export type BPMF = number[][];

export function bdelta(a = 0, b = 0): BPMF {
  const out: BPMF = [];
  for (let i = 0; i <= a; i++) out.push(new Array<number>(b + 1).fill(0));
  out[a]![b] = 1;
  return out;
}

export function bcols(B: BPMF): number {
  let c = 0;
  for (const row of B) c = Math.max(c, row.length);
  return c;
}

export function bconvolve(X: BPMF, Y: BPMF): BPMF {
  const rows = X.length + Y.length - 1;
  const cols = bcols(X) + bcols(Y) - 1;
  const out: BPMF = [];
  for (let i = 0; i < rows; i++) out.push(new Array<number>(cols).fill(0));
  for (let a1 = 0; a1 < X.length; a1++) {
    const rx = X[a1]!;
    for (let b1 = 0; b1 < rx.length; b1++) {
      const w = rx[b1] ?? 0;
      if (w < EPS) continue;
      for (let a2 = 0; a2 < Y.length; a2++) {
        const ry = Y[a2]!;
        const orow = out[a1 + a2]!;
        for (let b2 = 0; b2 < ry.length; b2++) {
          const v = ry[b2] ?? 0;
          if (v < EPS) continue;
          orow[b1 + b2] = (orow[b1 + b2] ?? 0) + w * v;
        }
      }
    }
  }
  return btrim(out);
}

export function btrim(B: BPMF): BPMF {
  let rows = B.length;
  while (rows > 1 && B[rows - 1]!.every((v) => v < EPS)) rows--;
  let cols = 0;
  for (let i = 0; i < rows; i++) {
    const r = B[i]!;
    for (let j = r.length - 1; j >= 0; j--) {
      if ((r[j] ?? 0) >= EPS) {
        cols = Math.max(cols, j + 1);
        break;
      }
    }
  }
  cols = Math.max(cols, 1);
  return B.slice(0, rows).map((r) => {
    const rr = r.slice(0, cols);
    while (rr.length < cols) rr.push(0);
    return rr;
  });
}

export function baddScaled(acc: BPMF, B: BPMF, w: number): BPMF {
  const rows = Math.max(acc.length, B.length);
  const cols = Math.max(bcols(acc), bcols(B));
  const out: BPMF = [];
  for (let i = 0; i < rows; i++) {
    const row = new Array<number>(cols).fill(0);
    const ra = acc[i];
    const rb = B[i];
    for (let j = 0; j < cols; j++) row[j] = (ra?.[j] ?? 0) + w * (rb?.[j] ?? 0);
    out.push(row);
  }
  return out;
}

/** Σ_n count[n] · per^{*n} for bivariate `per`. */
export function bcompound(count: PMF, per: BPMF): BPMF {
  let pow: BPMF = bdelta();
  let out: BPMF = [[0]];
  for (let n = 0; n < count.length; n++) {
    const w = count[n] ?? 0;
    if (w > EPS) out = baddScaled(out, pow, w);
    if (n + 1 < count.length) pow = bconvolve(pow, per);
  }
  return btrim(out);
}

/**
 * Like bcompound, but exactly one "failed" item (an item whose outcome is (0,0) with probability pFail,
 * i.e. the reroll-eligible category) may be re-drawn once from the full `per` distribution.
 * Models a single re-roll (e.g. Command Re-roll) among n identical dice.
 *   total(n) = Σ_j C(n,j) pFail^j (1-pFail)^(n-j) · [ perGivenNotFail^{*(n-j)} ⊛ (j ≥ 1 ? per : δ) ]
 */
export function bcompoundOneReroll(count: PMF, per: BPMF, pFail: number, perGivenNotFail: BPMF): BPMF {
  if (pFail <= EPS) return bcompound(count, per);
  let out: BPMF = [[0]];
  const nMax = count.length - 1;
  // powers of perGivenNotFail
  const pows: BPMF[] = [bdelta()];
  for (let k = 1; k <= nMax; k++) pows.push(bconvolve(pows[k - 1]!, perGivenNotFail));
  for (let n = 0; n <= nMax; n++) {
    const w = count[n] ?? 0;
    if (w < EPS) continue;
    const bin = binomial(n, pFail);
    for (let j = 0; j <= n; j++) {
      const pj = bin[j] ?? 0;
      if (pj < EPS) continue;
      const base = pows[n - j]!;
      const part = j >= 1 ? bconvolve(base, per) : base;
      out = baddScaled(out, part, w * pj);
    }
  }
  return btrim(out);
}

export function bmarginalA(B: BPMF): PMF {
  return B.map((r) => r.reduce((s, v) => s + v, 0));
}

export function bmarginalB(B: BPMF): PMF {
  const cols = bcols(B);
  const out = new Array<number>(cols).fill(0);
  for (const r of B) for (let j = 0; j < r.length; j++) out[j] = (out[j] ?? 0) + (r[j] ?? 0);
  return out;
}

export function bmean(B: BPMF): { a: number; b: number } {
  let a = 0;
  let b = 0;
  for (let i = 0; i < B.length; i++) {
    const r = B[i]!;
    for (let j = 0; j < r.length; j++) {
      const w = r[j] ?? 0;
      a += i * w;
      b += j * w;
    }
  }
  return { a, b };
}
