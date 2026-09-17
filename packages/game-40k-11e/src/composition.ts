import { compositionBranches } from "@grimstat/resolver";
import type { CompositionLineLike } from "@grimstat/resolver";
export { profileBounds } from "@grimstat/resolver";
export type { ProfileBounds } from "@grimstat/resolver";

/**
 * How many models a datasheet's unit is made of, read from its printed composition.
 *
 * Its own module because both the army rules and the loadout reader ask it, and the two would
 * otherwise have to import each other.
 */
/** Bounds of one way of building the unit: per-line mins/maxs are summed ("1 Sergeant" + "4-9 Troopers" → 5..10). */
function branchBounds(lines: readonly CompositionLineLike[]): { min?: number; max?: number } {
  let min: number | undefined;
  let max: number | undefined;
  let maxKnown = true;
  for (const c of lines) {
    if (typeof c.min === "number") min = (min ?? 0) + c.min;
    if (typeof c.max === "number") max = (max ?? 0) + c.max;
    else if (typeof c.min === "number") max = (max ?? 0) + c.min; // a fixed line ("1 Sergeant") contributes its min to the max
    else maxKnown = false;
  }
  const out: { min?: number; max?: number } = {};
  if (min !== undefined) out.min = min;
  if (max !== undefined && maxKnown && lines.some((c) => typeof c.max === "number")) out.max = max;
  return out;
}

/**
 * Model-count bounds of a datasheet. A sheet that writes "OR" between its lines offers alternatives
 * rather than parts of one unit, so the unit is as small as the smallest alternative and as large
 * as the largest. A ceiling needs every alternative to have one.
 */
export function compositionBounds(ds: { composition: Array<CompositionLineLike> }): { min?: number; max?: number } {
  const branches = compositionBranches(ds.composition).map(branchBounds);
  const mins = branches.map((b) => b.min).filter((m): m is number => m !== undefined);
  const maxs = branches.map((b) => b.max);
  const out: { min?: number; max?: number } = {};
  if (mins.length === branches.length && mins.length > 0) out.min = Math.min(...mins);
  if (maxs.every((m): m is number => m !== undefined) && maxs.length > 0) out.max = Math.max(...maxs);
  return out;
}
