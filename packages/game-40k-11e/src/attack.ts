import { type ModifierSet, type RerollPolicy } from "@grimstat/effects";
import { type HitGate, type WoundGate, type PMF, dicePMF, mapPMF, thin, delta } from "@grimstat/engine";
import { CH, POLICY } from "./channels";

const SIX = [1, 2, 3, 4, 5, 6] as const;

/** Wound-roll target number from Strength vs Toughness. */
export function woundTarget(S: number, T: number): number {
  if (S >= 2 * T) return 2;
  if (S > T) return 3;
  if (S === T) return 4;
  if (S * 2 <= T) return 6;
  return 5;
}

export interface HitOpts {
  /** BS/WS target after stat modifiers (e.g. cover). null → cannot hit unless autoHit. */
  target: number | null;
  rollMod: number; // already capped
  critThreshold: number; // unmodified roll ≥ this is a critical hit
  snap: boolean;
  reroll: RerollPolicy | null;
}

/** Outcome of a single unmodified hit-roll result under the gate: 0 miss, 1 hit, 2 critical hit. */
export function classifyHit(r: number, o: HitOpts): 0 | 1 | 2 {
  if (o.snap) return r !== 6 ? 0 : r >= o.critThreshold ? 2 : 1;
  if (r === 1) return 0;
  if (r >= o.critThreshold) return 2;
  if (r === 6) return 1;
  if (o.target === null) return 0;
  return r + o.rollMod >= o.target ? 1 : 0;
}

export function hitGate(o: HitOpts): HitGate {
  type Out = 0 | 1 | 2; // miss, hit, crit
  const outcome = (r: number): Out => {
    if (o.snap) {
      if (r !== 6) return 0;
      return r >= o.critThreshold ? 2 : 1;
    }
    if (r === 1) return 0;
    if (r >= o.critThreshold) return 2;
    if (r === 6) return 1;
    if (o.target === null) return 0;
    return r + o.rollMod >= o.target ? 1 : 0;
  };
  const base = [0, 0, 0];
  for (const r of SIX) base[outcome(r)]! += 1 / 6;
  if (!o.reroll || o.snap) return { pMiss: base[0]!, pHit: base[1]!, pCrit: base[2]! };
  const final = [0, 0, 0];
  for (const r of SIX) {
    const out = outcome(r);
    const rerolled = o.reroll === "ones" ? r === 1 : o.reroll === "failed" ? out === 0 : out !== 2;
    if (rerolled) for (let k = 0; k < 3; k++) final[k]! += (1 / 6) * base[k]!;
    else final[out]! += 1 / 6;
  }
  return { pMiss: final[0]!, pHit: final[1]!, pCrit: final[2]! };
}

export interface WoundOpts {
  target: number;
  rollMod: number;
  critThreshold: number;
  reroll: RerollPolicy | null;
}

export function classifyWound(r: number, o: WoundOpts): 0 | 1 | 2 {
  if (r === 1) return 0;
  if (r >= o.critThreshold) return 2;
  if (r === 6) return 1;
  return r + o.rollMod >= o.target ? 1 : 0;
}

export function woundGate(o: WoundOpts): WoundGate {
  type Out = 0 | 1 | 2;
  const outcome = (r: number): Out => {
    if (r === 1) return 0;
    if (r >= o.critThreshold) return 2;
    if (r === 6) return 1;
    return r + o.rollMod >= o.target ? 1 : 0;
  };
  const base = [0, 0, 0];
  for (const r of SIX) base[outcome(r)]! += 1 / 6;
  if (!o.reroll) return { pFail: base[0]!, pWound: base[1]!, pCrit: base[2]! };
  const final = [0, 0, 0];
  for (const r of SIX) {
    const out = outcome(r);
    const rerolled = o.reroll === "ones" ? r === 1 : o.reroll === "failed" ? out === 0 : out !== 2;
    if (rerolled) for (let k = 0; k < 3; k++) final[k]! += (1 / 6) * base[k]!;
    else final[out]! += 1 / 6;
  }
  return { pFail: final[0]!, pWound: final[1]!, pCrit: final[2]! };
}

export interface SaveOpts {
  armourTarget: number; // Sv + AP magnitude (may exceed 6 → no armour save)
  invulnTarget: number | null;
  rollMod: number; // capped save-roll modifier
  reroll: RerollPolicy | null;
  /** Unmodified 6 always saves (11e). Default true. */
  sixAlwaysSaves?: boolean;
}

/** Probability that a save FAILS. */
export function pUnsaved(o: SaveOpts): number {
  const success = (r: number): boolean => {
    if (r === 1) return false;
    if (r === 6 && (o.sixAlwaysSaves ?? true)) return true;
    if (r + o.rollMod >= o.armourTarget) return true;
    if (o.invulnTarget !== null && r >= o.invulnTarget) return true;
    return false;
  };
  let pBase = 0;
  for (const r of SIX) if (success(r)) pBase += 1 / 6;
  if (!o.reroll) return 1 - pBase;
  let p = 0;
  for (const r of SIX) {
    const ok = success(r);
    const rerolled = o.reroll === "ones" ? r === 1 : !ok;
    p += rerolled ? pBase / 6 : ok ? 1 / 6 : 0;
  }
  return 1 - p;
}

/** Damage PMF after modifiers on the damage channel, then Feel No Pain thinning. */
export function damagePMF(D: string | number, mods: ModifierSet, fnp: number | null): PMF {
  const base = dicePMF(D);
  const modded = mods.has(CH.damage) ? mapPMF(base, (k) => (k === 0 ? 0 : mods.num(CH.damage, k, POLICY[CH.damage]))) : base;
  if (fnp && fnp >= 2 && fnp <= 6) return thin(modded, (fnp - 1) / 6);
  return modded;
}

export function attacksPMF(A: string | number, bonus: number): PMF {
  const base = dicePMF(A);
  if (!bonus) return base;
  return mapPMF(base, (k) => Math.max(0, k + bonus));
}

export function sustainedPMF(v: number | string | boolean | null): PMF | null {
  if (v === null || v === false) return null;
  if (typeof v === "number") return v > 0 ? delta(v) : null;
  if (typeof v === "string") return dicePMF(v);
  return delta(1);
}
