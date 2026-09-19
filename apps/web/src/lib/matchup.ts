/**
 * How an attack fares against the unit, in three steps, read off one result.
 *
 * The share is the part of the defender's wounds the attack removes on average, so a horde and a
 * single big model are judged on the same scale. The kill chance is read beside it because a unit
 * that is wiped out one time in two is a good target even when its average is dragged down by the
 * other half.
 */
export type Matchup = "good" | "fair" | "poor";

/** Kill chance at or above this is a good match-up on its own. */
export const GOOD_KILL = 0.5;
/** Kill chance at or above this is at least a fair match-up. */
export const FAIR_KILL = 0.2;
/** Share of the defender's wounds removed on average that makes a good match-up. */
export const GOOD_SHARE = 0.5;
/** Share of the defender's wounds removed on average that makes a fair match-up. */
export const FAIR_SHARE = 0.25;

const EPS = 1e-9;

export function matchupOf(r: { pKill: number; expectedDamage: number; defenderWounds?: number | undefined }): Matchup {
  const share = r.defenderWounds !== undefined && r.defenderWounds > 0 ? r.expectedDamage / r.defenderWounds : 0;
  if (r.pKill >= GOOD_KILL - EPS || share >= GOOD_SHARE - EPS) return "good";
  if (r.pKill >= FAIR_KILL - EPS || share >= FAIR_SHARE - EPS) return "fair";
  return "poor";
}
