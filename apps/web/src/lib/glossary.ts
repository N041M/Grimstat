import type { Ability, GlossaryEntry, Snapshot, WeaponKeyword } from "@grimstat/schema";
import { glossaryKey } from "@grimstat/effects";

/**
 * The rules text behind the keywords a datasheet prints.
 *
 * A snapshot carries a glossary only when an imported source supplied one. Nothing here invents a rule
 * the data does not have, so a keyword with no entry is shown as plain text.
 */

const indexes = new WeakMap<Snapshot, Map<string, GlossaryEntry>>();

function index(snapshot: Snapshot): Map<string, GlossaryEntry> {
  let map = indexes.get(snapshot);
  if (!map) {
    map = new Map((snapshot.data.glossary ?? []).map((e) => [e.key, e] as const));
    indexes.set(snapshot, map);
  }
  return map;
}

/** The entry for a keyword name as the parsers write it ("SUSTAINED HITS", "ANTI", "DEEP STRIKE"). */
export function ruleFor(snapshot: Snapshot | undefined, key: string | undefined): GlossaryEntry | undefined {
  if (!snapshot || !key) return undefined;
  return index(snapshot).get(key.toUpperCase());
}

/** The entry for a weapon keyword off a profile. */
export function ruleForKeyword(snapshot: Snapshot | undefined, kw: WeaponKeyword): GlossaryEntry | undefined {
  return ruleFor(snapshot, kw.name);
}

/**
 * The entry for a keyword spelled the way a screen prints it, value and all: "Sustained Hits 1",
 * "ANTI-VEHICLE", "Feel No Pain 5+". Use this where the name on screen is a label rather than a
 * parsed keyword.
 */
export function ruleForPrinted(snapshot: Snapshot | undefined, name: string | undefined): GlossaryEntry | undefined {
  if (!snapshot || !name) return undefined;
  return ruleFor(snapshot, name) ?? ruleFor(snapshot, glossaryKey(name));
}

/**
 * What an ability says. Its own text where it has one; otherwise, for a core ability, the game
 * system's entry for the keyword it names.
 */
export function abilityText(snapshot: Snapshot | undefined, ability: Ability): string {
  const own = ability.text.trim();
  if (own) return own;
  return ruleFor(snapshot, ability.coreKeyword)?.text ?? "";
}

/**
 * Rules text repeats its own title on the first line ("DEEP STRIKE\n\nSome units make their way…").
 * The card already has a heading, so that line comes off rather than being read twice. The title is
 * printed without the value the datasheet names ("FEEL NO PAIN" under "Feel No Pain 5+"), so a first
 * line the name begins with counts as the title too.
 */
export function withoutTitleLine(text: string, name: string): string {
  const lines = text.split("\n");
  const first = lines[0]?.trim() ?? "";
  if (!first || (lines[1] ?? "").trim() !== "") return text.trim();
  const flat = (s: string): string => s.toUpperCase().replace(/[^A-Z0-9]+/g, "");
  return flat(name).startsWith(flat(first)) ? lines.slice(1).join("\n").trim() : text.trim();
}
