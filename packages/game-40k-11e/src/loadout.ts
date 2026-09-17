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

/**
 * One option line as a whole, which is what the mount count needs.
 *
 * `options` above is one entry per weapon a line grants, which answers "how many of this weapon may
 * I have". It cannot answer "what does taking it cost me", because a line is a trade: it takes
 * printed weapons away and puts others in their place, sometimes several at a time ("this model's
 * twin battle cannon can be replaced with 1 oppressor cannon and 1 coaxial autocannon"), and
 * sometimes as a choice between them.
 */
export interface WargearLine {
  readonly text: string;
  /** How many times the line may be applied to a unit of this many models. */
  applications(models: number): number;
  /** What one application may put on the model: one of these sets, whose weapons come together. */
  readonly grants: ReadonlyArray<ReadonlyMap<string, number>>;
  /** What one application takes off it, by weapon base name. Empty when the line only adds. */
  readonly replaces: ReadonlyMap<string, number>;
}

export interface WargearReading {
  readonly options: readonly WargearOption[];
  /** The same lines read whole, one entry each. */
  readonly lines: readonly WargearLine[];
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

/**
 * What a line offers, as the sets of weapons one application may put on the model.
 *
 * One set means the weapons come together; several mean a choice of one of them. Both shapes are
 * written both ways round. "1 oppressor cannon and 1 coaxial autocannon" is two guns for one mount,
 * where the same line written with "or" would be a choice, and a bullet of "one of the following"
 * can itself be a pair: "- 1 despoiler battle cannon and 1 diabolus heavy stubber".
 *
 * Each item is left whole here. Splitting on "and" is the reader's last resort, because 73 weapons
 * in the game data have an "and" in their name.
 */
function grantGroups(line: string): string[][] {
  const bullets = line
    .split(/\n+/)
    .map((l) => l.trim())
    .filter((l) => /^[-•*]\s+/.test(l))
    .map((l) => l.replace(/^[-•*]\s+/, ""));
  if (bullets.length) return bullets.map((b) => [b]);
  const tail = /\b(?:replaced with|equipped with|replace their|select)\b\s*:?\s*(.+)$/i.exec(tidy(line));
  if (!tail) return [];
  const text = (tail[1] ?? "").replace(/\bone of the following\b\s*:?/i, "");
  const items = text
    .split(/\s*,\s*|\s+and\s+|\s+or\s+/i)
    .map((x) => x.trim())
    .filter(Boolean);
  if (!items.length) return [];
  const choice = /\bone of the following\b/i.test(tail[1] ?? "") || /\s+or\s+/i.test(text);
  return choice ? items.map((i) => [i]) : [items];
}

/**
 * The weapons one group names, with how many of each, or nothing when any part of it is unreadable.
 *
 * A group is tried whole first, so a weapon whose own name joins two things with "and" is matched as
 * itself. Only when the whole names no single weapon is it cut up, and then every piece has to name
 * one: half a rule read is worse than none.
 */
function grantSet(items: readonly string[], bases: readonly string[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const item of items) {
    const whole = splitCount(item);
    const one = matchWeapon(whole.name, bases);
    if (one) {
      out.set(one, (out.get(one) ?? 0) + whole.copies);
      continue;
    }
    const parts = item.split(/\s+and\s+|\s*,\s*/i).map((x) => x.trim()).filter(Boolean);
    if (parts.length < 2) return new Map();
    for (const part of parts) {
      const { copies, name } = splitCount(part);
      const base = matchWeapon(name, bases);
      if (!base) return new Map();
      out.set(base, (out.get(base) ?? 0) + copies);
    }
  }
  return out;
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
  const head = replacedHead(line);
  if (head === undefined) return [];
  const lower = head.toLowerCase();
  const hit = bases.filter((b) => lower.includes(b));
  return hit.filter((b) => !hit.some((other) => other !== b && other.includes(b)));
}

/** The part of a line that names what it takes away, before "replaced with" or between "replace" and "with". */
function replacedHead(line: string): string | undefined {
  const s = tidy(line);
  return /^([\s\S]*?)\breplaced with\b/i.exec(s)?.[1] ?? /\breplaces?\s+(?:their|its|the)\s+([\s\S]*?)\s+with\b/i.exec(s)?.[1];
}

/**
 * How many of each weapon one application of the line takes away.
 *
 * The number is written in front of the name it belongs to — "this model's 2 Hades autocannons can
 * be replaced with 2 ectoplasma cannons" gives up two guns for two — and is one where the line
 * names the weapon without counting it.
 */
function replacedCounts(line: string, bases: readonly string[]): Map<string, number> {
  const head = replacedHead(line) ?? "";
  const out = new Map<string, number>();
  for (const base of replacedWeapons(line, bases)) {
    const at = head.toLowerCase().indexOf(base);
    const before = at < 0 ? "" : head.slice(0, at);
    const n = toNumber(new RegExp(`${NUM}\\s+[^,;]*$`, "i").exec(before)?.[1]);
    out.set(base, n && n > 0 ? n : 1);
  }
  return out;
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
  const lines: WargearLine[] = [];
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
    const sets = grantGroups(line).map((group) => grantSet(group, bases)).filter((set) => set.size > 0);

    if (!limit || !sets.length) {
      unread.push(line);
      continue;
    }

    const replaces = replacedWeapons(line, bases);
    // The per-weapon view takes the most of a weapon any one set of this line offers.
    const most = new Map<string, number>();
    for (const set of sets) for (const [base, copies] of set) most.set(base, Math.max(most.get(base) ?? 0, copies));
    for (const [base, copies] of most) options.push({ text: line, grants: [base], replaces, limit: (models) => limit(models) * copies });
    lines.push({ text: line, applications: limit, grants: sets, replaces: replacedCounts(line, bases) });
  }

  // A sheet whose options are all "None" is fixed; one with options as well is not.
  if (options.length) fixed = false;
  return { options, lines, unread, fixed, complete: unread.length === 0 };
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
    for (const candidate of grantGroups(line).flat()) {
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
  if (!parsed.all.length && !Object.keys(parsed.byProfile).length && !Object.keys(parsed.carriers).length) return out;
  const reading = readWargearOptions(ds);
  // What the unit holds in total, in weapons, for the kinds counted per unit rather than per model.
  const heldByUnit = new Map<string, number>();
  const displacedModels = new Map<string, number>();
  // What counts as a surplus copy is what the datasheet prints: a Ravager listed with three dark
  // lances is holding the three it came with, not one it swapped for.
  const printed = (base: string): number => parsed.copies[base] ?? 1;
  for (const g of groups) {
    const profile = ds.models.find((m) => m.id === g.modelProfileId)?.name.toLowerCase();
    const defaults = [...new Set([...parsed.all, ...(profile ? parsed.byProfile[profile] ?? [] : [])])];
    const held = new Map<string, number>();
    for (const item of g.wargear) {
      const k = key(baseWeaponName(item));
      held.set(k, (held.get(k) ?? 0) + 1);
      heldByUnit.set(k, (heldByUnit.get(k) ?? 0) + g.count);
    }
    const byDefault = new Set(defaults.map(key));
    const displaced = (base: string): boolean =>
      reading.options.some((o) => o.replaces.includes(base) && o.grants.some((granted) => (held.get(granted) ?? 0) > (byDefault.has(granted) ? printed(granted) : 0)));
    for (const base of Object.keys(parsed.carriers)) if (displaced(base)) displacedModels.set(base, (displacedModels.get(base) ?? 0) + g.count);
    for (const d of defaults) {
      const k = key(d);
      if (held.has(k) || displaced(k)) continue;
      out.set(d, (out.get(d) ?? 0) + g.count * printed(k));
    }
  }

  /*
   * A weapon the prose gives to a kind of model the datasheet has no profile for — "1 Gun Servitor
   * is equipped with: heavy arc rifle" — belongs to that many models of the unit however the list
   * writes its groups, so what is missing is counted once against the unit rather than group by
   * group. Models that swapped the weapon away are taken off the total the same way.
   */
  for (const [base, carriers] of Object.entries(parsed.carriers)) {
    const want = carriers * printed(base) - (displacedModels.get(base) ?? 0);
    const missing = want - (heldByUnit.get(base) ?? 0);
    if (missing > 0) out.set(base, (out.get(base) ?? 0) + missing);
  }
  return out;
}

export interface LoadoutProblem {
  readonly severity: "error" | "warn";
  readonly code: "models.min" | "models.max" | "weapon.unknown" | "weapon.overLimit" | "weapon.unsourced" | "weapon.noSlot";
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

/** "a, b and c", for naming the weapons a problem is about. */
function list(names: readonly string[]): string {
  if (names.length < 2) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** One way of applying a line: the line itself, and the single weapon chosen where it offers a choice. */
interface Variant {
  line: WargearLine;
  /** What one application puts on the model. A choice narrows the line's grants to the one taken. */
  grants: ReadonlyMap<string, number>;
  /** How many applications are worth trying: more than the extras need only costs more. */
  most: number;
}

/** Every way of applying these lines, with the applications each is worth trying. */
function variantsFor(lines: readonly WargearLine[], extras: ReadonlyMap<string, number>, models: number): Variant[] {
  const out: Variant[] = [];
  for (const line of lines) {
    for (const grants of line.grants) {
      let most = 0;
      for (const [w, perApplication] of grants) {
        const want = extras.get(w);
        if (want) most = Math.max(most, Math.ceil(want / perApplication));
      }
      if (most > 0) out.push({ line, grants, most: Math.min(most, line.applications(models)) });
    }
  }
  return out;
}

/** The most combinations worth walking; past this the answer is withheld rather than guessed at. */
const SEARCH_CAP = 20000;

/**
 * Whether some number of applications of these lines explains the extras without spending printed
 * weapons the model is still carrying.
 *
 * Small enough to walk: a datasheet offers a handful of lines and a mount is swapped once or twice,
 * so the combinations are counted first and the whole question dropped if there are too many.
 */
function swapsFit(variants: Variant[], extras: ReadonlyMap<string, number>, spare: ReadonlyMap<string, number>, models: number): boolean | undefined {
  let combinations = 1;
  for (const v of variants) combinations *= v.most + 1;
  if (combinations > SEARCH_CAP) return undefined;

  const counts = new Array<number>(variants.length).fill(0);
  for (let i = 0; i < combinations; i++) {
    let n = i;
    for (let v = 0; v < variants.length; v++) {
      counts[v] = n % (variants[v]!.most + 1);
      n = Math.floor(n / (variants[v]!.most + 1));
    }
    if (fits(variants, counts, extras, spare, models)) return true;
  }
  return false;
}

/** One assignment of applications: does it cover the extras, keep each line within its allowance and pay for itself? */
function fits(variants: Variant[], counts: readonly number[], extras: ReadonlyMap<string, number>, spare: ReadonlyMap<string, number>, models: number): boolean {
  const got = new Map<string, number>();
  const spent = new Map<string, number>();
  const perLine = new Map<string, number>();
  variants.forEach((v, i) => {
    const a = counts[i] ?? 0;
    if (!a) return;
    perLine.set(v.line.text, (perLine.get(v.line.text) ?? 0) + a);
    for (const [w, n] of v.grants) got.set(w, (got.get(w) ?? 0) + n * a);
    for (const [w, n] of v.line.replaces) spent.set(w, (spent.get(w) ?? 0) + n * a);
  });
  for (const [line, a] of perLine) if (a > (variants.find((v) => v.line.text === line)?.line.applications(models) ?? 0)) return false;
  for (const [w, want] of extras) if ((got.get(w) ?? 0) < want) return false;
  for (const [w, used] of spent) if (used > (spare.get(w) ?? 0)) return false;
  return true;
}

/**
 * Weapons taken from the options that the model has not paid for.
 *
 * A swap is a trade: the model gives up a printed weapon and takes another in its place. Each weapon
 * can sit inside its own option's allowance and the loadout still be one the datasheet never offers,
 * because the mounts run out. A Deff Dread may swap its Big Shoota for a Kustom Mega-blasta and its
 * Skorcha for a Rokkit Launcha, but not do both and keep the Big Shoota as well.
 *
 * The question is put as a search rather than a sum, because a line is not one weapon for one: it
 * can hand over two guns for one mount, take two away at once, or offer a choice of what to put
 * there. So this asks whether any number of applications of the lines explains what the model is
 * holding while spending only the printed weapons it has actually given up. If one does, nothing is
 * reported.
 *
 * Held back where a verdict would be a guess: a unit of several models, whose lines are written per
 * model and whose mounts are not the unit's to count; a datasheet with a line the parser could not
 * read, which may be the one that adds a mount; a weapon granted by a line that only adds, which
 * costs no mount at all; and a search too large to walk.
 */
function slotProblem(ds: Datasheet, unit: ScenarioUnit, reading: WargearReading): LoadoutProblem | undefined {
  const models = modelsOf(unit);
  if (models !== 1 || !reading.complete || !reading.lines.length) return undefined;

  const parsed = parseLoadout(ds);
  const printed = new Set([...parsed.all, ...Object.values(parsed.byProfile).flat(), ...Object.keys(parsed.carriers)].map(key));
  const held = carried(unit);
  const extras = new Map<string, number>();
  const swapped: string[] = [];
  for (const [base, { count, name }] of held) {
    if (printed.has(base)) continue;
    const granting = reading.lines.filter((l) => l.grants.some((set) => set.has(base)));
    if (!granting.length || granting.some((l) => l.replaces.size === 0)) continue;
    extras.set(base, count);
    swapped.push(name);
  }
  if (!extras.size) return undefined;

  // What each printed weapon has left to give: what the datasheet prints, less what is still held.
  const spare = new Map<string, number>();
  for (const base of printed) spare.set(base, Math.max(0, (parsed.copies[base] ?? 1) - (held.get(base)?.count ?? 0)));

  const variants = variantsFor(reading.lines, extras, models);
  if (!variants.length) return undefined;
  if (swapsFit(variants, extras, spare, models) !== false) return undefined;

  const kept = [...printed].filter((base) => held.has(base) && reading.lines.some((l) => l.replaces.has(base) && l.grants.some((set) => [...set.keys()].some((g) => extras.has(g))))).map((base) => held.get(base)!.name);
  return {
    severity: "error",
    code: "weapon.noSlot",
    count: [...extras.values()].reduce((a, b) => a + b, 0),
    message: kept.length
      ? `${list(swapped)} ${swapped.length === 1 ? "replaces a printed weapon" : "replace printed weapons"}, and this model still carries ${list(kept)}.`
      : `${list(swapped)} ${swapped.length === 1 ? "replaces more printed weapons" : "replace more printed weapons"} than this model has given up.`,
  };
}

function problemsFor(ds: Datasheet, unit: ScenarioUnit, reading: WargearReading): LoadoutProblem[] {
  const problems: LoadoutProblem[] = [];
  const models = modelsOf(unit);
  const { min, max } = compositionBounds(ds);
  if (min !== undefined && models < min) problems.push({ severity: "error", code: "models.min", count: models, message: `${plural(models, "model")}; the unit takes at least ${min}.` });
  if (max !== undefined && models > max) problems.push({ severity: "error", code: "models.max", count: models, message: `${plural(models, "model")}; the unit takes at most ${max}.` });

  const bases = new Set(ds.weapons.map((w) => key(baseWeaponName(w.name))));
  const defaults = parseLoadout(ds);
  const inLoadout = new Set([...defaults.all, ...Object.values(defaults.byProfile).flat(), ...Object.keys(defaults.carriers)].map(key));

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

    // A datasheet whose options are "None" has nothing to swap, so a weapon printed on it is part of
    // somebody's kit whether the loadout sentence names it or not — and the sentences do leave
    // things out. "The Twin Lance" names the gun drone each of its models carries without naming the
    // twin pulse blaster the drone shoots with, which is printed as a weapon of the sheet.
    if (reading.complete && reading.options.length) {
      problems.push({ severity: "error", code: "weapon.unsourced", weapon: name, count, message: `${name} is not in the default loadout and no wargear option grants it.` });
    }
  }

  // A weapon already reported as over its own limit is why the mounts ran out, and naming it twice
  // says nothing new.
  if (!problems.some((p) => p.code === "weapon.overLimit")) {
    const noSlot = slotProblem(ds, unit, reading);
    if (noSlot) problems.push(noSlot);
  }
  return problems;
}
