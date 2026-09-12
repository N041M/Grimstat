/**
 * Saying who is attached to a unit.
 *
 * A Leader or Support character is folded into its host: one unit, one target, one allocation.
 * That is right for the rules and wrong for the screen, because the fact that a captain is standing
 * in that squad changes how the player thinks about it, and after the fold the only trace of him was
 * a suffix on the unit's name — in the calculator, literally "(+1)".
 *
 * `ScenarioUnit.attached` carries the fact instead, and these turn it into words. Anywhere with room
 * renders the attachment as its own line; anywhere that has one line to work with uses `unitLabel`.
 */

import type { AttachedCharacter } from "@grimstat/schema";
import { t } from "../i18n";

/**
 * Any unit-shaped thing that may name attached characters.
 *
 * `attached` is optional here rather than required as it is on `ScenarioUnit`, because a scenario
 * saved or shared before the field existed comes back without it. Every one of these reads through
 * `attachedOf`, so a unit that predates the feature simply has nobody attached.
 */
export interface MaybeAttached {
  readonly attached?: readonly AttachedCharacter[] | undefined;
}

/** Whether anything is attached. */
export const hasAttached = (unit: MaybeAttached): boolean => attachedOf(unit).length > 0;

export const attachedOf = (unit: MaybeAttached): readonly AttachedCharacter[] => unit.attached ?? [];

/**
 * "Led by Warden Captain", "Supported by Warden Banner", or both at once.
 *
 * A unit may take one of each, so the two roles are named separately rather than run together in a
 * list — "led by" and "supported by" are different jobs and the player treats them differently.
 */
export function attachmentLine(unit: MaybeAttached): string | undefined {
  const all = attachedOf(unit);
  if (!all.length) return undefined;
  const leaders = all.filter((a) => a.role === "leader").map((a) => a.name);
  const supports = all.filter((a) => a.role === "support").map((a) => a.name);
  const led = leaders.length ? t("attach.ledBy", { name: leaders.join(", ") }) : undefined;
  const supported = supports.length ? t("attach.supportedBy", { name: supports.join(", ") }) : undefined;
  if (led && supported) return t("attach.both", { led, supported });
  return led ?? supported;
}

/**
 * "Warden Squad + Warden Captain": the unit and whoever is with it, on one line.
 *
 * For a select, a chart axis, a log entry — anywhere a single string is all there is. The role is
 * dropped here on purpose: at this length the names are what identify the unit, and "+" says the
 * rest.
 */
export function unitLabel(unit: MaybeAttached & { readonly name: string }): string {
  const all = attachedOf(unit);
  return all.length ? t("attach.label", { unit: unit.name, names: all.map((a) => a.name).join(" + ") }) : unit.name;
}
