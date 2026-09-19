import type { Roster, RosterModelGroup, RosterUnit } from "@grimstat/schema";

/**
 * A unit split in two for deployment.
 *
 * Some rules let one unit be split into two units at Declare Battle Formations: an Immolator's
 * capacity text names the Sisters of Battle Squad, a Raider's names Kabalite Warriors. The roster
 * keeps the first half as the unit itself and the second half as a roster unit of its own that
 * points back with `halfOf`. On the table they are two units, each with its own transport and its
 * own place in Reserves. In the list they are one purchase: the composition, the price tier and the
 * duplicate limit all read the two together, and the second half costs nothing.
 */

export const isHalf = (unit: RosterUnit): boolean => unit.halfOf !== undefined;

/** The unit a second half belongs to, or the unit itself when it is not a second half. */
export function headOf(roster: Pick<Roster, "units">, unit: RosterUnit): RosterUnit {
  if (!unit.halfOf) return unit;
  return roster.units.find((u) => u.id === unit.halfOf && u.id !== unit.id) ?? unit;
}

/** The second halves of a unit, in roster order. Empty for a unit that is not split. */
export function halvesOf(roster: Pick<Roster, "units">, unit: RosterUnit): RosterUnit[] {
  return roster.units.filter((u) => u.halfOf === unit.id && u.id !== unit.id);
}

/** Whether the unit is either half of a split unit. */
export const isSplit = (roster: Pick<Roster, "units">, unit: RosterUnit): boolean => isHalf(unit) || halvesOf(roster, unit).length > 0;

/** Groups that hold the same models with the same wargear, added together. */
export function mergeModelGroups(groups: readonly RosterModelGroup[]): RosterModelGroup[] {
  const out: RosterModelGroup[] = [];
  for (const g of groups) {
    const same = out.find((o) => o.modelProfileId === g.modelProfileId && o.wargear.length === g.wargear.length && o.wargear.every((w, i) => w === g.wargear[i]));
    if (same) same.count += g.count;
    else out.push({ ...g, wargear: [...g.wargear] });
  }
  return out;
}

/**
 * The models of the whole unit: the head's own and its halves', as one list of groups. This is
 * what the composition, the price tier and the wargear options are checked against.
 */
export function wholeModelsOf(roster: Pick<Roster, "units">, unit: RosterUnit): RosterModelGroup[] {
  const head = headOf(roster, unit);
  return mergeModelGroups([...head.models, ...halvesOf(roster, head).flatMap((h) => h.models)]);
}
