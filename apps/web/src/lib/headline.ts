import type { SimResult } from "@grimstat/schema";

/**
 * The five numbers the Calculator's hero reads out. Pinning keeps one of these so the tiles can show
 * how far the current result has moved from it.
 */
export interface Headline {
  expectedDamage: number;
  pKill: number;
  median: number;
  p95: number;
  /** Expected damage per 100 attacker points; absent when the attacker has no points value. */
  per100: number | undefined;
}

export function per100Of(result: SimResult): number | undefined {
  const perPoint = result.damagePerPoint ?? (result.attackerPoints ? result.expectedDamage / result.attackerPoints : undefined);
  return perPoint === undefined ? undefined : perPoint * 100;
}

export function headlineOf(result: SimResult): Headline {
  return { expectedDamage: result.expectedDamage, pKill: result.pKill, median: result.damagePercentiles.p50, p95: result.damagePercentiles.p95, per100: per100Of(result) };
}

/** "+1.20", "-0.40", "0.00": a difference with its sign always written. */
export function signed(v: number, f: (x: number) => string): string {
  return `${v > 0 ? "+" : ""}${f(v)}`;
}
