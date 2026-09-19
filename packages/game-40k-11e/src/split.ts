import type { Datasheet, Roster, RosterUnit, Snapshot } from "@grimstat/schema";
import { halvesOf, isHalf } from "@grimstat/resolver";

/**
 * Rules that split one unit into two at Declare Battle Formations.
 *
 * They are written in prose on the datasheet that grants them. A transport carries it in its
 * capacity text: "you can select one SISTERS OF BATTLE SQUAD from your army. If you do, that unit
 * is split into two units, each containing as equal a number of models as possible. One of these
 * units must start the battle embarked within this TRANSPORT". A character carries it in an
 * ability: "you can split a friendly GREY HUNTERS unit into two units". Each such rule splits one
 * unit, so an army with two Immolators can split two squads.
 */
export interface SplitRule {
  /** The datasheet that carries the rule. */
  datasheetId: string;
  /** Unit names or keyword phrases the rule names, uppercased ("BATTLE SISTERS SQUAD"). */
  units: string[];
  /** One half must start the battle embarked in the unit that carries the rule. */
  embark: boolean;
}

const ONE_OF = /select one (.+?) (?:unit )?(?:from your army|that has not)/i;
const FRIENDLY = /split a friendly (.+?) unit into two units/i;

/** Splits "A, B or C" into phrases with the trailing "unit" noun dropped, uppercased. */
function phrases(raw: string): string[] {
  return raw
    .replace(/\bunits?\b/gi, " ")
    .split(/\s*,\s*|\s+or\s+/i)
    .map((s) => s.replace(/^\s*(?:the|a|an|any)\s+/i, "").trim().toUpperCase())
    .filter(Boolean);
}

/** The split rule in a piece of prose, if it holds one. */
export function parseSplitRule(text: string | undefined): Omit<SplitRule, "datasheetId"> | undefined {
  if (!text) return undefined;
  const src = text.replace(/\s+/g, " ");
  if (!/split(?:s|ted)? (?:a friendly .+? unit )?into two units/i.test(src)) return undefined;
  const named = ONE_OF.exec(src)?.[1] ?? FRIENDLY.exec(src)?.[1];
  if (!named) return undefined;
  const units = phrases(named);
  if (!units.length) return undefined;
  return { units, embark: /must start the battle embarked/i.test(src) };
}

const RULES = new WeakMap<Snapshot, Map<string, SplitRule>>();

/** Every split rule in the snapshot, by the datasheet that carries it. */
export function splitRulesOf(snapshot: Snapshot): ReadonlyMap<string, SplitRule> {
  const cached = RULES.get(snapshot);
  if (cached) return cached;
  const abilities = new Map(snapshot.data.abilities.map((a) => [a.id, a.text] as const));
  const out = new Map<string, SplitRule>();
  for (const ds of snapshot.data.datasheets) {
    const texts = [ds.transportCapacity, ...ds.abilityIds.map((id) => abilities.get(id))];
    for (const text of texts) {
      const rule = parseSplitRule(text);
      if (!rule) continue;
      out.set(ds.id, { datasheetId: ds.id, ...rule });
      break;
    }
  }
  RULES.set(snapshot, out);
  return out;
}

const words = (s: string): string[] => s.toUpperCase().split(/[^A-Z0-9'’]+/).filter(Boolean);

/** Whether a rule that names `phrase` names this datasheet: by its name, or by every word of the phrase among its keywords. */
export function ruleNamesSheet(phrase: string, ds: Datasheet): boolean {
  if (ds.name.toUpperCase() === phrase) return true;
  const have = new Set([...ds.keywords, ...ds.factionKeywords].flatMap(words));
  const want = words(phrase);
  return want.length > 0 && want.every((w) => have.has(w));
}

/** Units in the army whose datasheet carries a rule that splits this unit's datasheet. */
export function splittersOf(roster: Pick<Roster, "units">, snapshot: Snapshot, unit: RosterUnit): RosterUnit[] {
  const rules = splitRulesOf(snapshot);
  const ds = snapshot.data.datasheets.find((d) => d.id === unit.datasheetId);
  if (!ds || !rules.size) return [];
  return roster.units.filter((u) => {
    if (u.id === unit.id || isHalf(u)) return false;
    const rule = rules.get(u.datasheetId);
    return !!rule && rule.units.some((p) => ruleNamesSheet(p, ds));
  });
}

/** Whether the army holds a rule that can split this unit, and the unit is not yet split. */
export function canSplitUnit(roster: Pick<Roster, "units">, snapshot: Snapshot, unit: RosterUnit): boolean {
  if (isHalf(unit) || halvesOf(roster, unit).length) return false;
  if (unit.models.reduce((s, g) => s + g.count, 0) < 2) return false;
  return splittersOf(roster, snapshot, unit).length > 0;
}
