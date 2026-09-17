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

import type { Datasheet, RosterModelGroup, ScenarioUnit } from "@grimstat/schema";
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
  /** Weapon base names this line takes away to pay for the grant, lower-cased. Empty when the line only adds. */
  readonly replaces: readonly string[];
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
 *
 * The article is only stripped when it is a whole word. Without that, the leading letter of a weapon
 * whose name starts with "a" was eaten — "Astartes chainsword" came out as "startes chainsword" and
 * matched nothing on the datasheet, which is how a line that grants the weapon ended up reported as
 * a line that does not.
 */
function splitCount(candidate: string): { copies: number; name: string } {
  const m = new RegExp(`^(?:(?:an?|the|additional|${NUM})\\b)?\\s*(?:additional\\s+)?(.*)$`, "i").exec(tidy(candidate).replace(/[.;]+$/, ""));
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
 * The weapons an option line takes away to pay for what it grants.
 *
 * A line writes the swap one of two ways. "Any number of models can each have their hallowed mace
 * replaced with 1 anointed halberd" puts the weapon it takes in front of "replaced with"; "Any
 * number of models can each replace their hallowed mace with 1 anointed halberd" puts it between
 * "replace" and "with". A line that only adds — "this model can be equipped with 1 plasma pistol" —
 * takes nothing away and names nothing here.
 *
 * A name that is only part of a longer one the same head also names is dropped, so a line about a
 * twin hail gun does not read as a line about a hail gun as well.
 */
function replacedWeapons(line: string, bases: readonly string[]): string[] {
  const s = tidy(line);
  const head = /^([\s\S]*?)\breplaced with\b/i.exec(s)?.[1] ?? /\breplaces?\s+(?:their|its|the)\s+([\s\S]*?)\s+with\b/i.exec(s)?.[1];
  if (head === undefined) return [];
  const lower = head.toLowerCase();
  const hit = bases.filter((b) => lower.includes(b));
  return hit.filter((b) => !hit.some((other) => other !== b && other.includes(b)));
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

  // "This model can be equipped with up to 2 seeker missiles": the same allowance as "up to 2 X",
  // written after the subject rather than at the head of the line. Read before the subject rules
  // below, which would otherwise take the model for the allowance and hand it 1.
  const inline = new RegExp(`\\bup to ${NUM}\\b`, "i").exec(s);
  if (inline) {
    const n = toNumber(inline[1]);
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
      return base ? `${base}\u0000${copies}` : undefined;
    }).filter((x): x is string => !!x))];

    if (!limit || !grants.length) {
      unread.push(line);
      continue;
    }

    const replaces = replacedWeapons(line, bases);
    for (const packed of grants) {
      const [base, copiesText] = packed.split("\u0000");
      const copies = Number(copiesText) || 1;
      options.push({ text: line, grants: [base!], replaces, limit: (models) => limit(models) * copies });
    }
  }

  // A sheet whose options are all "None" is fixed; one with options as well is not.
  if (options.length) fixed = false;
  return { options, unread, fixed, complete: unread.length === 0 };
}

/** A printed item name with its decorations off: the allowance, the count, a bracketed aside, a footnote mark. */
function itemName(candidate: string): string {
  return tidy(splitCount(tidy(candidate).replace(/^up to\s+/i, "")).name.replace(/\([^)]*\)/g, " "))
    .replace(/[*\u2020]+$/, "")
    .replace(/[.;,]+$/, "")
    .trim();
}

/** The most words a printed wargear name runs to; past that the candidate is a sentence about the options. */
const NAME_WORDS = 6;

/**
 * What separates one named thing from the next inside a candidate. A bullet often carries a whole
 * swap — "1 daemonic icon can be equipped with 1 instrument of chaos" names two — so the words that
 * join the halves of a sentence count as separators here, not only the commas.
 */
const ITEM_SPLIT = /\s*,\s*|\s+and\s+|\s+or\s+|\s+with\s+|\bcan\b/i;

/** The words a fragment of the sentence opens with; a name never does. */
const NOT_A_NAME = /^(?:be|have|has|take|takes|select|replace|replaces|replaced|equip|equipped|this|that|its|their|the|model|unit|any|all|each|one|up)\b/i;

/**
 * The wargear a datasheet's options name that is none of its weapons: a vexilla, a storm shield, a
 * gun drone, an icon. Nothing any of them does reaches the attack sequence, so the app carries one
 * on a model and computes nothing from it. A list that names one is naming something the datasheet
 * grants, though, and someone building the unit in the app should be able to pick it from the sheet
 * rather than type it in.
 *
 * Only a line whose allowance is understood is read. The lines that are not are footnotes and
 * conditions rather than grants, and their prose would arrive here as item names. A candidate the
 * datasheet knows whole is left alone before it is split, so a weapon with an "and" in its name is
 * not cut into two items that are not weapons at all.
 */
export function wargearItems(ds: Datasheet): string[] {
  const bases = [...new Set(ds.weapons.map((w) => key(baseWeaponName(w.name))).filter(Boolean))];
  const out = new Map<string, string>();
  for (const line of ds.wargearOptions) {
    if (!allowance(line)) continue;
    for (const candidate of grantCandidates(line)) {
      const whole = itemName(candidate);
      if (!whole || matchWeapon(whole, bases)) continue;
      for (const part of whole.split(ITEM_SPLIT)) {
        const item = itemName(part ?? "");
        if (!item || NOT_A_NAME.test(item) || item.split(" ").length > NAME_WORDS) continue;
        if (matchWeapon(item, bases)) continue;
        // The prose writes an item mid-sentence, so it arrives lower-cased where a weapon profile's
        // own name arrives as printed. Both end up in one list of things to pick from.
        out.set(key(item), item.charAt(0).toUpperCase() + item.slice(1));
      }
    }
  }
  return [...out.values()];
}

/**
 * Weapons the datasheet hands a roster unit's models that the list left out.
 *
 * Several list dialects write only part of a unit's loadout. The GW app's attached-unit blocks print
 * "9x Warden / 9x Flux carbine" and say nothing about the shock maul every Warden also carries; a
 * tournament pack often prints only the weapons a unit swapped for. Read as a complete selection,
 * such a list strips the unit down to what it happened to mention, and a squad whose melee weapons
 * were all defaults ends up unable to fight.
 *
 * So a default the list does not name is handed back, unless the list names a weapon that could have
 * displaced it. That means an option line taking that default away and granting a weapon the group
 * holds more of than the default loadout already gives it. The surplus copy is what shows a swap was
 * made. A sergeant listed with a power weapon and no chainsword has swapped the chainsword away,
 * because nothing else puts a power weapon in their hand. An Ashen Crusher listed with one vortex
 * cannon has not given up its twin hail gun for a second one, because the cannon it is holding is
 * the cannon the datasheet already gave it.
 *
 * A line the option parser could not read grants nothing here, so a swap written in prose it cannot
 * follow reads as an omission and the default comes back. That is the safer way round. A restored
 * weapon is one the datasheet itself prints, and it sits on the unit where the player can take it
 * off again. A weapon dropped in silence only shows up as a unit that does no damage.
 *
 * The counts are in weapons, ready to add to a selection tallied the same way: the models that carry
 * the weapon, times the number the datasheet prints for each of them.
 */
export function omittedDefaults(ds: Datasheet, groups: readonly RosterModelGroup[]): Map<string, number> {
  const out = new Map<string, number>();
  const parsed = parseLoadout(ds);
  if (!parsed.all.length && !Object.keys(parsed.byProfile).length) return out;
  const reading = readWargearOptions(ds);
  for (const g of groups) {
    const profile = ds.models.find((m) => m.id === g.modelProfileId)?.name.toLowerCase();
    const defaults = [...new Set([...parsed.all, ...(profile ? parsed.byProfile[profile] ?? [] : [])])];
    const held = new Map<string, number>();
    for (const item of g.wargear) {
      const k = key(baseWeaponName(item));
      held.set(k, (held.get(k) ?? 0) + 1);
    }
    const byDefault = new Set(defaults.map(key));
    // What counts as a surplus copy is what the datasheet prints: a Ravager listed with three dark
    // lances is holding the three it came with, not one it swapped for.
    const printed = (base: string): number => parsed.copies[base] ?? 1;
    const displaced = (base: string): boolean =>
      reading.options.some((o) => o.replaces.includes(base) && o.grants.some((granted) => (held.get(granted) ?? 0) > (byDefault.has(granted) ? printed(granted) : 0)));
    for (const d of defaults) {
      const k = key(d);
      if (held.has(k) || displaced(k)) continue;
      out.set(d, (out.get(d) ?? 0) + g.count * printed(k));
    }
  }
  return out;
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

/**
 * The most of one weapon the options allow, and the lines that allow it.
 *
 * Lines add up. A walker whose left mount and whose right mount may each be swapped for a rocket
 * launcher is offered two of them, one line at a time, and reading only the larger of the two lines
 * called the second one illegal. Each line is counted once at its own allowance: the reader files an
 * option per weapon a line grants, so a line offering a choice of three weapons arrives here three
 * times, and its allowance is the allowance of that one line however the choice went.
 */
function allowanceFor(granting: readonly WargearOption[], models: number): { allowed: number; lines: string[] } {
  const perLine = new Map<string, number>();
  for (const o of granting) perLine.set(o.text, Math.max(perLine.get(o.text) ?? 0, o.limit(models)));
  let allowed = 0;
  for (const n of perLine.values()) allowed += n;
  return { allowed, lines: [...perLine.keys()] };
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

    // A line the parser could not read may be another grant of this weapon, and what it allows is
    // unknown. The contract elsewhere in this file is to say so rather than to assume, so a count an
    // unread line naming the weapon might allow is not called illegal.
    if (reading.unread.some((line) => key(line).includes(base))) continue;

    const granting = reading.options.filter((o) => o.grants.includes(base));
    if (granting.length) {
      const { allowed, lines } = allowanceFor(granting, models);
      if (count > allowed) {
        // A single line's allowance is the rule that was broken and worth quoting. Where several
        // lines add up to it, no one of them is.
        const rule = lines.length === 1 ? lines[0] : undefined;
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
