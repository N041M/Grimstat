import type { PMF } from "./pmf";

/**
 * The engine is game-agnostic: it consumes *probabilities and distributions*, never stats.
 * A game-system plugin turns BS/S/AP/keywords/modifiers into these numbers.
 */

/** Per-die hit outcome probabilities (sum to 1). Crits are hits. */
export interface HitGate {
  pMiss: number;
  pHit: number; // non-critical hit
  pCrit: number;
}

/** Per-hit wound outcome probabilities (sum to 1). Crits are wounds. */
export interface WoundGate {
  pFail: number;
  pWound: number; // non-critical wound
  pCrit: number;
}

/** A homogeneous group of defending models (same W, saves, damage reduction, FNP). */
export interface TargetGroup {
  id: string;
  name: string;
  models: number;
  wounds: number;
  isCharacter: boolean;
  /** Points value of one model in this group, for "points slain" metrics. */
  pointsPerModel?: number;
}

/** Weapon-vs-group numbers (aligned with EngineInput.groups by index). */
export interface GroupParams {
  /** P(save fails) for a non-mortal wound allocated to this group. */
  pUnsaved: number;
  /** Damage per unsaved wound, after the group's damage modifiers and Feel No Pain thinning. */
  damage: PMF;
  /** Damage per mortal-wound event (e.g. Devastating Wounds), after modifiers and FNP thinning. */
  mortalDamage: PMF;
}

export interface WeaponParams {
  name: string;
  /** Number of identical weapons firing. */
  count: number;
  /** Attacks per weapon (already includes Blast / Rapid Fire bonuses). */
  attacks: PMF;
  hit: HitGate;
  /** Torrent-style: every attack hits, no hit roll, no critical hits. */
  autoHit: boolean;
  /** Extra hits per critical hit (Sustained Hits), as a PMF; null = none. */
  sustained: PMF | null;
  /** Critical hits automatically wound (attacker has chosen to use Lethal Hits). */
  lethal: boolean;
  wound: WoundGate;
  /** Critical wounds become mortal-damage events that skip the save (Devastating Wounds). */
  devastating: boolean;
  /** One failed hit roll among all this weapon's attacks may be re-rolled once (e.g. Command Re-roll). */
  singleRerollHit: boolean;
  /** One failed wound roll among all this weapon's hits may be re-rolled once. */
  singleRerollWound: boolean;
  groups: GroupParams[];
  /** One attack die per weapon profile is not rolled but set to this outcome (Miracle/Fate dice). */
  fixedHit?: "miss" | "hit" | "crit";
  /** One wound roll per weapon profile is set to this outcome instead of being rolled. */
  fixedWound?: "fail" | "wound" | "crit";
  /** Attacks may be allocated to character groups first (Precision). */
  precision: boolean;
  /** Expected mortal wounds suffered by the attacker per weapon fired (Hazardous). */
  selfMortalsPerWeapon: number;
}

export type AllocationOrder = "protect-character" | "in-order";

export interface EngineInput {
  weapons: WeaponParams[];
  groups: TargetGroup[];
  allocation: AllocationOrder;
  backend: "auto" | "exact" | "mc";
  mcIterations: number;
  seed?: number;
  /** Exact backend falls back to MC above this many DP states. */
  maxExactStates?: number;
}

export interface WeaponTrace {
  name: string;
  count: number;
  expectedAttacks: number;
  expectedHits: number;
  expectedWounds: number;
  expectedUnsaved: number;
  expectedDamage: number;
}

export interface EngineOutput {
  backend: "exact" | "mc";
  iterations?: number;
  ciHalfWidth?: number;
  /** Effective damage (wounds removed from the defending unit). */
  damagePMF: PMF;
  slainPMF: PMF;
  expectedDamage: number;
  expectedSlain: number;
  pKill: number;
  pAtLeastSlain: number[];
  expectedWasted: number;
  expectedSelfMortals: number;
  /** Expected points value of slain models (if groups carry pointsPerModel). */
  expectedPointsSlain: number;
  weapons: WeaponTrace[];
  warnings: string[];
}
