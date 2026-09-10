import type { ArsenalSummary, Bucket, KeywordCount, Phase, PhaseArsenal } from "./arsenal";

/**
 * View-side helpers for Armies → Arsenal. The arithmetic itself lives in `arsenal.ts`; what is
 * here is only what the screen needs on top of it: the phase the reader has selected, the "both
 * phases at once" fold of two `PhaseArsenal` values, and the labels those numbers are drawn with.
 *
 * No DOM, no React — so the fold and the formatters can be tested directly.
 */

/** The three positions of the phase switch. `"both"` is what the summary sections open on. */
export type ArsenalPhase = Phase | "both";
export const ARSENAL_PHASES: ArsenalPhase[] = ["shooting", "melee", "both"];

/** Reject anything but a known phase when reading a remembered value back. */
export function parseArsenalPhase(raw: unknown): ArsenalPhase | undefined {
  return ARSENAL_PHASES.find((p) => p === raw);
}

/** Sum two axes bucket by bucket, keeping each bucket's own sort order. */
export function mergeBuckets(a: Bucket[], b: Bucket[]): Bucket[] {
  const map = new Map<string, Bucket>();
  for (const list of [a, b])
    for (const bucket of list) {
      const cur = map.get(bucket.key);
      if (cur) cur.attacks += bucket.attacks;
      else map.set(bucket.key, { ...bucket });
    }
  return [...map.values()].sort((x, y) => x.order - y.order || x.key.localeCompare(y.key));
}

/** Sum two conditional-keyword lists, unioning the weapons behind each one. */
export function mergeKeywords(a: KeywordCount[], b: KeywordCount[]): KeywordCount[] {
  const map = new Map<string, KeywordCount>();
  for (const list of [a, b])
    for (const k of list) {
      const cur = map.get(k.name);
      if (cur) {
        cur.attacks += k.attacks;
        for (const w of k.weapons) if (!cur.weapons.includes(w)) cur.weapons.push(w);
      } else map.set(k.name, { ...k, weapons: [...k.weapons] });
    }
  return [...map.values()].sort((x, y) => y.attacks - x.attacks || x.name.localeCompare(y.name));
}

/** Weighted mean of two phase averages, weighted by the attacks behind each. */
function blend(aVal: number, aN: number, bVal: number, bN: number): number {
  const n = aN + bN;
  return n > 0 ? (aVal * aN + bVal * bN) / n : 0;
}

/**
 * The arsenal as the selected phase sees it. `"shooting"` and `"melee"` hand back the summary's own
 * half untouched; `"both"` folds the two, averaging Strength / AP / Damage over attacks rather than
 * over the two phases, so a list with one melee attack cannot drag the mean around.
 */
export function phaseView(a: ArsenalSummary, phase: ArsenalPhase): PhaseArsenal {
  if (phase === "shooting") return a.shooting;
  if (phase === "melee") return a.melee;
  const s = a.shooting;
  const m = a.melee;
  return {
    phase: "shooting",
    attacks: s.attacks + m.attacks,
    weapons: s.weapons + m.weapons,
    byStrength: mergeBuckets(s.byStrength, m.byStrength),
    byAp: mergeBuckets(s.byAp, m.byAp),
    byDamage: mergeBuckets(s.byDamage, m.byDamage),
    conditional: mergeKeywords(s.conditional, m.conditional),
    meanStrength: blend(s.meanStrength, s.attacks, m.meanStrength, m.attacks),
    meanAp: blend(s.meanAp, s.attacks, m.meanAp, m.attacks),
    meanDamage: blend(s.meanDamage, s.attacks, m.meanDamage, m.attacks),
  };
}

/**
 * Attack counts are dice averages, so they are rarely whole: show one decimal when there is one and
 * nothing when there is not, rather than a column of trailing ".0".
 */
export function attacksLabel(n: number | undefined): string {
  if (n === undefined || !Number.isFinite(n)) return "–";
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

/** The save left after AP; `null` once AP has taken the armour save away entirely. */
export const NO_SAVE = 7;
export function saveLabel(save: number): string | null {
  return save >= NO_SAVE ? null : `${save}+`;
}

/** Share of a total, 0..1, safe on an empty army. */
export function shareOf(value: number, total: number): number {
  return total > 0 && Number.isFinite(value) ? Math.max(0, Math.min(1, value / total)) : 0;
}

/** Largest attack count on an axis, for scaling its bars. */
export function peak(values: number[]): number {
  return values.reduce((max, v) => (Number.isFinite(v) && v > max ? v : max), 0);
}
