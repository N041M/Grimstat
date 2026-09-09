/** Small, fast, seedable PRNG (mulberry32). Deterministic Monte Carlo runs for tests. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Precomputed inverse-CDF sampler for a PMF. */
export function makeSampler(pmf: number[], rand: () => number): () => number {
  const cum: number[] = [];
  let acc = 0;
  for (const v of pmf) {
    acc += v;
    cum.push(acc);
  }
  const last = cum.length - 1;
  return () => {
    const u = rand() * acc;
    // linear scan is fine for small supports; binary search for large
    if (cum.length <= 16) {
      for (let i = 0; i < cum.length; i++) if (u < (cum[i] ?? 0)) return i;
      return last;
    }
    let lo = 0;
    let hi = last;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (u < (cum[mid] ?? 0)) hi = mid;
      else lo = mid + 1;
    }
    return lo;
  };
}
