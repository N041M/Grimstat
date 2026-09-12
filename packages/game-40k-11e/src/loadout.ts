/**
 * Is this a loadout the unit could actually have?
 *
 * A datasheet's wargear options arrive as prose — one line per rule, written for a person: "1 Battle
 * Sister's boltgun can be replaced with one of the following: …", "Any number of models can each
 * have their hallowed mace replaced with 1 anointed halberd", "For every 5 models in the unit, up to
 * 2 can each …". There is no machine-readable option tree in a snapshot: the one the BattleScribe
 * importer builds is dropped before the snapshot is written, and the other two sources never had
 * one. So this reads the prose, the way `patterns.ts` reads ability text and `transport.ts` reads
 * transport capacity.
 *
 * The contract is the one the rest of this plugin keeps: say what was understood, and say plainly
 * what was not. A line the parser cannot read is reported rather than assumed permissive, and the
 * one check that depends on having read *every* line — "nothing grants this weapon" — is withheld
 * unless every line was read. A tool that invents a rules violation is worse than one that admits
 * it did not know, because the player cannot tell the two apart without the rulebook open.
 *
 * Nothing here decides what is legal in the rulebook's sense. It decides whether the numbers on
 * screen contradict the datasheet's own printed options, which is the question a player is actually
 * asking when they have just typed a weapon count in.
 */

import type { Datasheet, ScenarioUnit } from "@grimstat/schema";
import { compositionBounds } from "./constraints";
import { baseWeaponName, parseLoadout } from "./resolve";

/** Any number of models may take it: "Any number of models can each have their…". */
export const UNLIMITED = Number.POSITIVE_INFINITY;

/**
 * One wargear option line, read.
 *
 * `limit` is in weapons rather than models, because that is what the unit records: a line allowing
 * two models to swap for "2 inferno pistols" each permits four inferno pistols.
 */
export interface WargearOption {
  /** The line as printed, so a problem can quote the rule it breaks. */
  readonly text: string;
  /** Weapon base names this line grants, lower-cased; only names the datasheet actually carries. */
  readonly grants: readonly string[];
  /** The most of each granted weapon a unit of `models` models may hold. */
  limit(models: number): number;
}

export interface WargearReading {
  readonly options: readonly WargearOption[];
  /** Lines the parser could not read. Whatever they allow goes unchecked. */
  readonly unread: readonly string[];
  /** The datasheet prints "None": there are no options, so the loadout is the default one. */
  readonly fixed: boolean;
  /** Every line was read (or there were none), so "nothing grants this" can be trusted. */
  readonly complete: boolean;
}

const NUMBER_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, both: 2 };

function toNumber(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const s = raw.trim().toLowerCase();
  if (/^\d+$/.test(s)) return Number(s);
  return NUMBER_WORDS[s];
}

const NUM = `(\\d+|${Object.keys(NUMBER_WORDS).join("|")})`;

/** Curly and straight apostrophes both appear in the sources; normalise so one pattern matches. */
const tidy = (s: string): string => s.replace(/[‘’ʼ]/g, "'").replace(/\s+/g, " ").trim();

/** One spelling of a weapon name for comparing: the sources mix apostrophes and casing. */
const key = (name: string): string => tidy(name).toLowerCase();

/** The bullet items of "one of the following:", or the whole tail when the grant is inline. */
function grantCandidates(line: string): string[] {
  const bullets = line
    .split(/\n+/)
    .map((l) => l.trim())
    .filter((l) => /^[-•*]\s+/.test(l))
    .map((l) => l.replace(/^[-•*]\s+/, ""));
  if (bullets.length) return bullets;
  const tail = /\b(?:replaced with|equipped with|replace their|select)\b\s*:?\s*(.+)$/i.exec(tidy(line));
  if (!tail) return [];
  return (tail[1] ?? "")
    .replace(/\bone of the following\b\s*:?/i, "")
    .split(/\s*,\s*|\s+and\s+|\s+or\s+/i)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * How many copies a single candidate hands one model ("2 inferno pistols" → 2), and the name left
 * once the count and its article are gone.
 */
function splitCount(candidate: string): { copies: number; name: string } {
  const m = new RegExp(`^(?:an?|the|additional|${NUM})?\\s*(?:additional\\s+)?(.*)$`, "i").exec(tidy(candidate).replace(/[.;]+$/, ""));
  const copies = toNumber(m?.[1]) ?? 1;
  return { copies, name: (m?.[2] ?? candidate).trim().toLowerCase() };
}

/**
 * The datasheet weapon a candidate names, or nothing.
 *
 * Exact match first. Otherwise the candidate has to contain exactly one weapon name — "1 twin
 * Decimator claw and 2 hellflamers" is split before it gets here, but prose like "1 power weapon
 * (that model's boltgun cannot be replaced)" still carries a tail. An ambiguous candidate matches
 * nothing rather than guessing, since a wrong match invents a limit on the wrong weapon.
 */
function matchWeapon(name: string, bases: readonly string[]): string | undefined {
  const n = key(name).replace(/[.;]+$/, "");
  const exact = bases.find((b) => b === n);
  if (exact) return exact;
  const singular = n.replace(/s$/, "");
  const exactSingular = bases.find((b) => b === singular || b.replace(/s$/, "") === singular);
  if (exactSingular) return exactSingular;
  const contained = bases.filter((b) => n.includes(b));
  return contained.length === 1 ? contained[0] : undefined;
}

/**
 * How many models one option line may be applied to.
 *
 * Only the leading clause is read, because that is where the allowance is written. A line whose
 * opening this does not recognise — a condition on the unit's size, a rule about which model is
 * carrying what — returns nothing, and the caller files it unread.
 */
function allowance(line: string): ((models: number) => number) | undefined {
  const s = tidy(line).toLowerCase();

  // "For every 5 models in the unit, up to 2 X can each …"
  const every = new RegExp(`^for every ${NUM} (?:\\w+\\s+)*?models?\\b[^,]*,\\s*(?:up to\\s+)?(?:${NUM}\\s+)?`, "i").exec(s);
  if (every) {
    const per = toNumber(every[1]);
    const take = toNumber(every[2]) ?? 1;
    if (per && per > 0) return (models) => Math.floor(models / per) * take;
  }

  // "Any number of models …", "All of the models in this unit …", "Each model can …"
  if (/^(?:any numbers? of|all of the models|each model|every model)\b/.test(s)) return () => UNLIMITED;

  // "Each <Model>'s X can be replaced …" — every model of that profile, so no cap this can count.
  if (/^each\b/.test(s) && !/^each of this model'?s\b/.test(s)) return () => UNLIMITED;

  // "Up to 2 X …", "Up to one X …"
  const upTo = new RegExp(`^up to ${NUM}\\b`, "i").exec(s);
  if (upTo) {
    const n = toNumber(upTo[1]);
    if (n !== undefined) return () => n;
  }

  // "This model …", "The Sister Superior's boltgun …", "One Celestian Insidiant's …"
  if (/^(?:this model|the |one )/.test(s)) return () => 1;

  // "Each of this model's Hornet pulse lasers …" / "Both of this model's …" — a single model, so a
  // count the unit's own profile already fixes. One is the safe reading.
  if (/^(?:each|both) of this model'?s\b/.test(s)) return () => 1;

  // "1 Battle Sister's boltgun …", "2 Tempestus Aquilons can each …"
  const leading = new RegExp(`^${NUM}\\s`, "i").exec(s);
  if (leading) {
    const n = toNumber(leading[1]);
    if (n !== undefined) return () => n;
  }

  return undefined;
}

/** Read a datasheet's printed wargear options. */
export function readWargearOptions(ds: Datasheet): WargearReading {
  const bases = [...new Set(ds.weapons.map((w) => key(baseWeaponName(w.name))).filter(Boolean))];
  const options: WargearOption[] = [];
  const unread: string[] = [];
  let fixed = false;

  for (const raw of ds.wargearOptions) {
    const line = raw.trim();
    if (!line) continue;
    const lower = tidy(line).toLowerCase();

    // "None" is a statement that the unit has no options at all, not a line that failed to parse.
    if (/^none\b\.?$/.test(lower)) {
      fixed = true;
      continue;
    }
    // A footnote qualifies the lines above it ("* You cannot select the same option twice"). It
    // grants nothing, and the qualification it adds is one this parser does not apply, so the
    // reading stays incomplete while one is present.
    if (/^[*†]/.test(line)) {
      unread.push(line);
      continue;
    }

    const limit = allowance(line);
    const grants = [...new Set(grantCandidates(line).map((c) => {
      const { copies, name } = splitCount(c);
      const base = matchWeapon(name, bases);
      return base ? `${base} ${copies}` : undefined;
    }).filter((x): x is string => !!x))];

    if (!limit || !grants.length) {
      unread.push(line);
      continue;
    }

    for (const packed of grants) {
      const [base, copiesText] = packed.split(" ");
      const copies = Number(copiesText) || 1;
      options.push({ text: line, grants: [base!], limit: (models) => limit(models) * copies });
    }
  }

  // A sheet whose options are all "None" is fixed; one with options as well is not.
  if (options.length) fixed = false;
  return { options, unread, fixed, complete: unread.length === 0 };
}

export interface LoadoutProblem {
  readonly severity: "error" | "warn";
  readonly code: "models.min" | "models.max" | "weapon.unknown" | "weapon.overLimit" | "weapon.unsourced";
  readonly message: string;
  /** The weapon the problem is about, as the datasheet names it. */
  readonly weapon?: string;
  /** How many of it (or, for a model-count problem, how many models). Used to compare with the baseline. */
  readonly count: number;
  /** The option line that sets the limit, when one does. */
  readonly rule?: string;
}

export interface LoadoutCheck {
  readonly problems: readonly LoadoutProblem[];
  /** Option lines that could not be read; nothing they allow was checked. */
  readonly unread: readonly string[];
  /** How many option lines were read. */
  readonly read: number;
  /** The datasheet has options and every one of them was read. */
  readonly complete: boolean;
}

/** The weapons a unit is actually carrying, by base name, summed over the profiles of one weapon. */
function carried(unit: ScenarioUnit): Map<string, { count: number; name: string }> {
  const out = new Map<string, { count: number; name: string }>();
  const seenProfile = new Set<string>();
  for (const w of unit.weapons) {
    if (!w.enabled || w.count <= 0) continue;
    // A leader's or a support unit's weapons are folded into the unit under their own datasheet's
    // name ("Warden Captain: Flux pistol"). They belong to that sheet, not this one, and checking
    // them here would report every attached character as carrying a weapon it does not own.
    if (/^[^:]+:\s/.test(w.name)) continue;
    const base = key(baseWeaponName(w.name));
    // Two profiles of one weapon (standard / supercharge) are one weapon in the player's hands, so
    // only the first enabled profile of a base contributes its count.
    if (seenProfile.has(base)) continue;
    seenProfile.add(base);
    out.set(base, { count: w.count, name: baseWeaponName(w.name) });
  }
  return out;
}

/** Models the unit is made of, not counting an attached character's own model. */
function modelsOf(unit: ScenarioUnit): number {
  const own = unit.models.filter((m) => !m.isCharacter).reduce((s, m) => s + m.count, 0);
  return own || unit.models.reduce((s, m) => s + m.count, 0);
}

const plural = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? "" : "s"}`;

export interface CheckLoadoutOptions {
  /**
   * The unit as the app builds it from this datasheet, untouched.
   *
   * Where the printed loadout itself cannot be read cleanly — the default-loadout prose names a
   * weapon this parser cannot match, so the app hands every model one — the unit arrives already
   * contradicting its own options, through nobody's choice. Anything the baseline is already guilty
   * of is not reported, so what is left is what the player changed. Without this the check would
   * open by accusing the player of a loadout they did not pick, which is the fastest way to teach
   * someone to ignore it.
   */
  readonly baseline?: ScenarioUnit;
}

/**
 * Check a unit's models and weapons against the datasheet it claims to be.
 *
 * `unit` must be the one built from `ds`; a custom unit has no datasheet to be checked against and
 * is nobody's business but the player's.
 */
export function checkLoadout(ds: Datasheet, unit: ScenarioUnit, opts: CheckLoadoutOptions = {}): LoadoutCheck {
  const reading = readWargearOptions(ds);
  const problems = problemsFor(ds, unit, reading);
  const baseline = opts.baseline ? problemsFor(ds, opts.baseline, reading) : [];
  const already = new Map(baseline.map((p) => [`${p.code}\u0000${p.weapon ?? ""}`, p.count] as const));
  const kept = problems.filter((p) => {
    const was = already.get(`${p.code}\u0000${p.weapon ?? ""}`);
    // Only a count the player has pushed further than the default counts as theirs.
    return was === undefined || p.count > was;
  });
  return { problems: kept, unread: reading.unread, read: reading.options.length, complete: reading.complete && (reading.options.length > 0 || reading.fixed) };
}

function problemsFor(ds: Datasheet, unit: ScenarioUnit, reading: WargearReading): LoadoutProblem[] {
  const problems: LoadoutProblem[] = [];
  const models = modelsOf(unit);
  const { min, max } = compositionBounds(ds);
  if (min !== undefined && models < min) problems.push({ severity: "error", code: "models.min", count: models, message: `${plural(models, "model")}; the unit takes at least ${min}.` });
  if (max !== undefined && models > max) problems.push({ severity: "error", code: "models.max", count: models, message: `${plural(models, "model")}; the unit takes at most ${max}.` });

  const bases = new Set(ds.weapons.map((w) => key(baseWeaponName(w.name))));
  const defaults = parseLoadout(ds);
  const inLoadout = new Set([...defaults.all, ...Object.values(defaults.byProfile).flat()].map(key));

  for (const [base, { count, name }] of carried(unit)) {
    if (!bases.has(base)) {
      problems.push({ severity: "error", code: "weapon.unknown", weapon: name, count, message: `${name} is not on this datasheet.` });
      continue;
    }
    if (inLoadout.has(base)) continue;

    const granting = reading.options.filter((o) => o.grants.includes(base));
    if (granting.length) {
      // Several lines can grant the same weapon; the unit may take the best of them.
      const allowed = Math.max(...granting.map((o) => o.limit(models)));
      if (count > allowed) {
        const rule = granting.find((o) => o.limit(models) === allowed)?.text;
        problems.push({ severity: "error", code: "weapon.overLimit", weapon: name, count, ...(rule ? { rule } : {}), message: `${plural(count, name.toLowerCase())}; the options allow ${allowed === UNLIMITED ? "any number" : allowed}.` });
      }
      continue;
    }

    if (reading.fixed) {
      problems.push({ severity: "error", code: "weapon.unsourced", weapon: name, count, message: `${name} is not in the default loadout, and this datasheet has no wargear options.` });
    } else if (reading.complete && reading.options.length) {
      problems.push({ severity: "error", code: "weapon.unsourced", weapon: name, count, message: `${name} is not in the default loadout and no wargear option grants it.` });
    }
  }
  return problems;
}
