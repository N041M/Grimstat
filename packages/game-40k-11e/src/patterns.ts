import type { Ability, CoverageTier, EffectRecord, ScenarioModel } from "@grimstat/schema";
import { CH } from "./channels";

/**
 * Tier-1 core abilities (unit-level) and the Tier-2 text-pattern library.
 * Everything here is best-effort curation of *effects*; the raw text is always kept alongside.
 * No Games Workshop text lives here — only generic rule phrasings.
 */

export interface AbilityOption {
  label: string;
  effects: EffectRecord[];
  fnp?: number;
}

export interface AbilityEffects {
  tier: CoverageTier;
  effects: EffectRecord[];
  /** Unit-wide Feel No Pain target if the ability grants one. */
  fnp?: number;
  /**
   * Whether the ability's own effects apply without the player asking for them. An ability the
   * datasheet limits to once per battle, turn or phase is written here with `false`: the effects are
   * modelled, and the player switches them on for the round they are spent in.
   */
  defaultOn?: boolean;
  /** Alternatives the player picks between. None of them applies until one is switched on. */
  options?: AbilityOption[];
  notes?: string[];
}

const KW = /\b(VEHICLE|MONSTER|INFANTRY|CHARACTER|PSYKER|FLY|MOUNTED|BEAST|SWARM|WALKER|TITANIC|AIRCRAFT|DAEMON|IMPERIUM|CHAOS|AELDARI|TYRANIDS|ORKS|NECRONS|TAU EMPIRE|LEAGUES OF VOTANN|GENESTEALER CULTS|ADEPTUS ASTARTES|ASTRA MILITARUM)\b/;

function targetCond(text: string): Partial<EffectRecord["if"]> | undefined {
  const m = /(?:against|targeting|target(?:s)?)\s+(?:an?\s+|any\s+|enemy\s+)?([A-Z][A-Z' -]{2,}?)\s+(?:unit|model)/.exec(text);
  if (m && m[1]) {
    const kw = m[1].trim().toUpperCase();
    if (KW.test(kw) || /^[A-Z' -]+$/.test(kw)) return { targetKeyword: kw };
  }
  return undefined;
}

function kindCond(text: string): Partial<EffectRecord["if"]> | undefined {
  const t = text.toLowerCase();
  if (/\branged\b/.test(t) && !/\bmelee\b/.test(t)) return { weaponKind: "ranged" };
  if (/\bmelee\b/.test(t) && !/\branged\b/.test(t)) return { weaponKind: "melee" };
  return undefined;
}

function extraConds(text: string): Partial<NonNullable<EffectRecord["if"]>> {
  const t = text.toLowerCase();
  const c: Partial<NonNullable<EffectRecord["if"]>> = {};
  if (/charge(?:d| move)/.test(t)) c.charged = true;
  if (/remained stationary/.test(t)) c.stationary = true;
  if (/within half range|half range/.test(t)) c.rangeBand = "half";
  return c;
}

/** Every condition the phrasing carries, for a pattern that buffs the attacker. */
function attackerConds(text: string): Record<string, unknown> {
  return { ...kindCond(text), ...targetCond(text), ...extraConds(text) };
}

function rec(stage: EffectRecord["when"]["stage"], side: "attacker" | "defender", op: EffectRecord["op"], target: string, value: number | string | boolean, source: string, cond?: Record<string, unknown>): EffectRecord {
  const r: EffectRecord = { when: { stage, side }, op, target, value, source };
  if (cond && Object.keys(cond).length) r.if = cond as EffectRecord["if"];
  return r;
}

/** "2" -> 2, "D3" -> "D3". A dice value stays a string, which is what the sustained channel reads. */
function amount(v: string | undefined, fallback = 1): number | string {
  if (!v) return fallback;
  const s = v.trim();
  return /^\d+$/.test(s) ? Number(s) : s.toUpperCase();
}

function num(v: string | undefined, fallback = 1): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** Map a Tier-1 core keyword (from `Ability.coreKeyword`) to effects. */
export function coreAbilityEffects(ability: Ability): AbilityEffects | null {
  const k = (ability.coreKeyword ?? "").toUpperCase();
  const v = typeof ability.coreValue === "number" ? ability.coreValue : Number(ability.coreValue);
  switch (k) {
    case "FEEL NO PAIN":
      return { tier: "tier1", effects: [rec("fnp", "defender", "set", CH.fnp, Number.isFinite(v) ? v : 6, ability.name)], fnp: Number.isFinite(v) ? v : 6 };
    case "STEALTH":
      // What Stealth does depends on the edition, and this function does not know which one is being
      // played. The flag records that the unit has the ability; `scenario.ts` reads the edition and
      // turns it into the benefit of cover or into a Hit-roll penalty.
      return { tier: "tier1", effects: [rec("hit", "defender", "flag", CH.stealthAbility, true, ability.name)] };
    case "INVULNERABLE SAVE":
      return { tier: "tier1", effects: [rec("save", "defender", "cap", CH.invuln, Number.isFinite(v) ? v : 6, ability.name)] };
    case "DEEP STRIKE":
    case "SCOUTS":
    case "INFILTRATORS":
    case "LONE OPERATIVE":
    case "FIGHTS FIRST":
    case "DEADLY DEMISE":
    case "LEADER":
    case "SUPPORT":
    case "FIRING DECK":
    case "HOVER":
    case "SUPER-HEAVY WALKER":
      return { tier: "tier1", effects: [], notes: ["no effect on the attack sequence"] };
    default:
      return null;
  }
}

interface Build {
  effects?: EffectRecord[];
  fnp?: number;
  options?: AbilityOption[];
}

interface Pattern {
  re: RegExp;
  build: (m: RegExpExecArray, text: string, name: string) => EffectRecord[] | Build;
}

/**
 * Weapon keywords an ability hands to a weapon: "melee weapons equipped by models in this unit have
 * the [LANCE] ability", "that attack has the [PRECISION] and [DEVASTATING WOUNDS] abilities". The
 * record carries the keyword as it is printed and nothing more. What the keyword does is settled by
 * the registry while the attack is resolved, which is where a keyword printed on the profile is
 * settled too.
 */
const GRANTS = /\b(?:has|have|had|gains?|gain)\b[^.]{0,120}?\[[A-Z][A-Z0-9'’ +-]*\][^.]{0,200}?\babilit(?:y|ies)\b/i;
const BRACKET = /\[([A-Z][A-Z0-9'’ +-]*)\]/g;

function sentences(text: string): string[] {
  return text.split(/(?<=[.:;])\s+/).filter(Boolean);
}

function grantRecords(text: string, name: string): EffectRecord[] {
  const out: EffectRecord[] = [];
  for (const s of sentences(text)) {
    if (!GRANTS.test(s)) continue;
    // "Melee weapons equipped by enemy models have the [HAZARDOUS] ability": the defending unit is
    // what carries the rule, and the keyword lands on the weapon shooting at it.
    const side = /\benemy\b[^.]{0,40}\b(?:models?|units?)\b[^.]{0,20}\bhave\b|equipped by enemy/i.test(s) ? "defender" : "attacker";
    const cond = side === "attacker" ? attackerConds(s) : { ...kindCond(s) };
    for (const m of s.matchAll(BRACKET)) out.push(rec("hit", side, "set", CH.grantKeyword, m[1]!.trim(), name, cond));
  }
  return out;
}

/** A menu chunk printed as nothing but keywords ("[SUSTAINED HITS 1]") grants them. */
function bareGrant(text: string, name: string): EffectRecord[] {
  const stripped = text.replace(BRACKET, "").replace(/\b(?:and|or)\b|[,.;]/g, "").trim();
  if (stripped) return [];
  return [...text.matchAll(BRACKET)].map((m) => rec("hit", "attacker", "set", CH.grantKeyword, m[1]!.trim(), name));
}

/** Characteristics a datasheet improves by name, and where each one lands. */
const CHARS = "strength|attacks|damage|armou?r penetration|save|ballistic skill|weapon skill|toughness";

function improveRecords(list: string, scope: string, by: number, name: string): EffectRecord[] {
  const named = list.toLowerCase();
  const out: EffectRecord[] = [];
  const buff = { ...kindCond(scope), ...extraConds(scope) };
  if (/\bstrength\b/.test(named)) out.push(rec("wound", "attacker", "add", CH.strength, by, name, buff));
  if (/\battacks\b/.test(named)) out.push(rec("attacks", "attacker", "add", CH.attacks, by, name, buff));
  if (/\bdamage\b/.test(named)) out.push(rec("damage", "attacker", "add", CH.damage, by, name, buff));
  if (/armou?r penetration/.test(named)) out.push(rec("save", "attacker", "add", CH.ap, by, name, buff));
  // Improving a save or a skill means a lower target number, and both channels count upwards for
  // worse, so an improvement is a negative value on them.
  if (/\bsave\b/.test(named)) out.push(rec("save", "defender", "add", CH.save, -by, name));
  if (/\btoughness\b/.test(named)) out.push(rec("wound", "defender", "add", CH.toughness, by, name));
  const bs = /ballistic skill/.test(named);
  const ws = /weapon skill/.test(named);
  if (bs || ws) {
    const kind = bs && ws ? kindCond(scope) : bs ? { weaponKind: "ranged" as const } : { weaponKind: "melee" as const };
    out.push(rec("hit", "attacker", "add", CH.skill, -by, name, { ...kind, ...extraConds(scope) }));
  }
  return out;
}

const PATTERNS: Pattern[] = [
  { re: /feel no pain (\d)\+/i, build: (m, _t, n) => ({ effects: [rec("fnp", "defender", "set", CH.fnp, num(m[1], 6), n)], fnp: num(m[1], 6) }) },
  { re: /(\d)\+ invulnerable save/i, build: (m, _t, n) => [rec("save", "defender", "cap", CH.invuln, num(m[1], 6), n)] },
  { re: /re-?roll (?:a |the )?hit rolls? of 1/i, build: (_m, t, n) => [rec("hit", "attacker", "reroll", CH.rerollHit, "ones", n, attackerConds(t))] },
  { re: /re-?roll (?:a |the )?wound rolls? of 1/i, build: (_m, t, n) => [rec("wound", "attacker", "reroll", CH.rerollWound, "ones", n, attackerConds(t))] },
  // The word boundary after `rolls?` matters. Without it the optional `s` gives way under
  // backtracking, so "re-roll hit rolls of 1" matches here as well as on the line above and the
  // better of the two re-rolls wins, turning a re-roll of 1s into a re-roll of every failure.
  { re: /re-?roll (?:a |the )?hit rolls?\b(?! of 1)/i, build: (_m, t, n) => [rec("hit", "attacker", "reroll", CH.rerollHit, "failed", n, attackerConds(t))] },
  { re: /re-?roll (?:a |the )?wound rolls?\b(?! of 1)/i, build: (_m, t, n) => [rec("wound", "attacker", "reroll", CH.rerollWound, "failed", n, attackerConds(t))] },
  // One named die rather than a policy over every die: the same treatment as a Command Re-roll.
  { re: /re-?roll one hit roll/i, build: (_m, t, n) => [rec("hit", "attacker", "reroll", CH.rerollHit, "one-die", n, attackerConds(t))] },
  { re: /re-?roll one wound roll/i, build: (_m, t, n) => [rec("wound", "attacker", "reroll", CH.rerollWound, "one-die", n, attackerConds(t))] },
  { re: /add 1 to (?:the )?hit rolls?|\+1 to hit/i, build: (_m, t, n) => [rec("hit", "attacker", "add", CH.hitRoll, 1, n, attackerConds(t))] },
  { re: /add 1 to (?:the )?wound rolls?|\+1 to wound/i, build: (_m, t, n) => [rec("wound", "attacker", "add", CH.woundRoll, 1, n, attackerConds(t))] },
  { re: /subtract 1 from (?:the )?hit rolls?|-1 to hit/i, build: (_m, t, n) => [rec("hit", "defender", "add", CH.hitRoll, -1, n, { ...kindCond(t) })] },
  { re: /subtract 1 from (?:the )?wound rolls?|-1 to wound/i, build: (_m, t, n) => [rec("wound", "defender", "add", CH.woundRoll, -1, n, { ...kindCond(t) })] },
  // "Improve the Strength and Damage characteristics of that attack by 1" — one phrasing that names
  // any set of characteristics at once, so each is read from the same clause rather than needing a
  // pattern per combination.
  {
    re: new RegExp(`improve (?:the )?((?:${CHARS})(?:(?:,| and|,and) (?:${CHARS}))*) characteristics? of ([^.]{0,100}?)by (\\d)`, "i"),
    build: (m, _t, n) => improveRecords(m[1] ?? "", m[2] ?? "", num(m[3]), n),
  },
  { re: /\+1 (?:to )?(?:ap|armou?r penetration)/i, build: (_m, t, n) => [rec("save", "attacker", "add", CH.ap, 1, n, attackerConds(t))] },
  { re: /worsen (?:the )?armou?r penetration .*? by 1|-1 (?:to )?(?:ap|armou?r penetration)/i, build: (_m, t, n) => [rec("save", "defender", "add", CH.ap, -1, n, { ...kindCond(t) })] },
  // One pattern for every way a datasheet prints damage reduction, so two of them cannot both fire
  // and subtract twice.
  {
    re: /(?:subtract|reduce) (\d) from the damage characteristic|(?:reduce|subtract) (?:the )?damage[^.]{0,60}?by (\d)|(?:^|\s)-(\d) damage\b/i,
    build: (m, t, n) => [rec("damage", "defender", "add", CH.damage, -num(m[1] ?? m[2] ?? m[3]), n, { ...kindCond(t) })],
  },
  { re: /change the damage characteristic of that attack to (\d)/i, build: (m, t, n) => [rec("damage", "defender", "set", CH.damage, num(m[1], 1), n, { ...kindCond(t) })] },
  { re: /halve(?:d)? (?:the )?damage|damage .*? is halved/i, build: (_m, t, n) => [rec("damage", "defender", "mul", CH.damage, 0.5, n, { ...kindCond(t) })] },
  { re: /add (\d) to (?:the )?(?:damage|d) characteristic|\+(\d) damage/i, build: (m, t, n) => [rec("damage", "attacker", "add", CH.damage, num(m[1] ?? m[2]), n, attackerConds(t))] },
  { re: /has an? damage characteristic of (\d)/i, build: (m, t, n) => [rec("damage", "attacker", "set", CH.damage, num(m[1], 1), n, attackerConds(t))] },
  { re: /add (\d) to (?:the )?(?:strength|s) characteristic|\+(\d) strength/i, build: (m, t, n) => [rec("wound", "attacker", "add", CH.strength, num(m[1] ?? m[2]), n, { ...kindCond(t), ...extraConds(t) })] },
  { re: /add (\d|D3|D6) to (?:the )?(?:attacks|a) characteristic|\+(\d) attacks?\b/i, build: (m, t, n) => [rec("attacks", "attacker", "add", CH.attacks, amount(m[1] ?? m[2]), n, { ...kindCond(t), ...extraConds(t) })] },
  { re: /has an attacks characteristic of (\d)/i, build: (m, t, n) => [rec("attacks", "attacker", "set", CH.attacks, num(m[1], 1), n, { ...kindCond(t), ...extraConds(t) })] },
  { re: /has a toughness characteristic of (\d)/i, build: (m, _t, n) => [rec("wound", "defender", "set", CH.toughness, num(m[1], 4), n)] },
  { re: /add (\d) to (?:the )?toughness characteristic/i, build: (m, _t, n) => [rec("wound", "defender", "add", CH.toughness, num(m[1]), n)] },
  // The save channel counts upwards for worse, as the armour save's target number does.
  { re: /has an? save characteristic of (\d)\+/i, build: (m, _t, n) => [rec("save", "defender", "set", CH.save, num(m[1], 6), n)] },
  { re: /change the attacks characteristic of[^.]{0,80}?to (\d)/i, build: (m, t, n) => [rec("attacks", "attacker", "set", CH.attacks, num(m[1], 1), n, { ...kindCond(t), ...extraConds(t) })] },
  // Both ways a datasheet prints a critical threshold: "critical hits on a 5+", and the same rule
  // written the other way round as "an unmodified Hit roll of 5+ scores a Critical Hit".
  { re: /critical hits? on (?:an? )?(?:unmodified )?(?:hit roll of )?(\d)\+/i, build: (m, t, n) => [rec("hit", "attacker", "cap", CH.critHit, num(m[1], 6), n, attackerConds(t))] },
  { re: /critical wounds? on (?:an? )?(?:unmodified )?(?:wound roll of )?(\d)\+/i, build: (m, t, n) => [rec("wound", "attacker", "cap", CH.critWound, num(m[1], 6), n, attackerConds(t))] },
  { re: /unmodified (?:successful )?hit roll of (\d)\+?[^.]{0,30}?scores a critical hit/i, build: (m, t, n) => [rec("hit", "attacker", "cap", CH.critHit, num(m[1], 6), n, attackerConds(t))] },
  { re: /unmodified (?:successful )?wound roll of (\d)\+?[^.]{0,30}?scores a critical wound/i, build: (m, t, n) => [rec("wound", "attacker", "cap", CH.critWound, num(m[1], 6), n, attackerConds(t))] },
  { re: /benefit of cover/i, build: (_m, _t, n) => [rec("hit", "defender", "flag", CH.stealth, true, n)] },
  { re: /\bstealth\b/i, build: (_m, _t, n) => [rec("hit", "defender", "flag", CH.stealthAbility, true, n)] },
  // "Ignore any or all modifiers" names the channels it covers, and the two are not the same thing:
  // in this edition cover is a Ballistic Skill penalty, so an ability that only names the Hit roll
  // leaves it standing.
  {
    re: /ignore any(?: or all)? modifiers to ([^.]{0,200})|(hit rolls? cannot be modified)/i,
    build: (m, t, n) => {
      const clause = (m[1] ?? m[2] ?? "").toLowerCase();
      const out: EffectRecord[] = [];
      if (/hit roll/.test(clause)) out.push(rec("hit", "attacker", "flag", CH.ignoreHitMods, true, n, { ...kindCond(t) }));
      if (/ballistic skill|weapon skill/.test(clause)) out.push(rec("hit", "attacker", "flag", CH.ignoreSkillMods, true, n, { ...kindCond(t) }));
      return out;
    },
  },
];

/**
 * A datasheet that offers a choice — a Dark Pact, an Order, one of three protocols — is not a list
 * of rules that all apply. Read as one, the unit comes out with every option at once. These are
 * split into options instead, and the player switches on the one that was taken.
 */
const MENU = /select (?:one|two|up to \w+) of the (?:following|abilities|options|effects|orders)|select one \w+ from those listed below|you can either select one|select both abilities/i;
/** A rules section written as several TRIGGER/EFFECT blocks is a list of manoeuvres, not one rule. */
const BLOCKS = /\b(?:TRIGGER|EFFECT):/g;

export function isMenu(text: string): boolean {
  return MENU.test(text) || (text.match(BLOCKS) ?? []).length >= 2;
}

/**
 * Split a menu into its printed options. Only two shapes are read: a bulleted line that is nothing
 * but keywords ("[SUSTAINED HITS 1]"), and one that opens with a name ("Conqueror Protocol: ...").
 * A bullet written any other way is left alone, and an ability whose options all read that way stays
 * unmodelled rather than becoming a sentence of prose wearing an option's label.
 */
function menuOptions(text: string, name: string): AbilityOption[] {
  const out: AbilityOption[] = [];
  for (const chunk of text.split(/\s+[-–—•‣]\s+/).map((c) => c.trim())) {
    // "[LETHAL HITS] If this unit made a Charge move…" — the option is the keyword run it opens with.
    const brackets = /^((?:\[[A-Z][A-Z0-9'’ +-]*\][\s,]*(?:and|or)?[\s,]*)+)/.exec(chunk);
    const named = /^([^:.]{2,60}):\s*(.+)$/s.exec(chunk);
    if (!brackets && !named) continue;
    const body = brackets ? brackets[1]!.trim() : named![2]!;
    const label = brackets ? body.replace(/[[\]]/g, "").trim() : named![1]!.trim();
    const source = `${name}: ${label}`;
    const built = runPatterns(body, source);
    const effects = [...built.effects, ...bareGrant(body, source)];
    if (!effects.length) continue;
    const opt: AbilityOption = { label, effects };
    if (built.fnp !== undefined) opt.fnp = built.fnp;
    out.push(opt);
  }
  return out;
}

/**
 * Vocabulary that puts an ability inside the attack sequence. Nothing carrying any of it is read as
 * having no effect on it, whatever else the text says.
 */
const COMBAT = /\b(?:hit rolls?|wound rolls?|saving throws?|save rolls?|invulnerable|feel no pain|critical|sustained hits|lethal hits|devastating|ignores cover|damage characteristic|strength characteristic|attacks characteristic|toughness characteristic|wounds characteristic|save characteristic|armou?r penetration|ballistic skill|weapon skill|mortal wounds?|benefit of cover|precision|twin-linked|blast|melta|lance|torrent|hazardous|anti-\w|re-?rolls?|regains?|heals?|destroyed|slain|suffers?)\b/i;

/**
 * Subjects the attack sequence does not contain. An ability every one of whose sentences is about
 * one of these changes nothing the engine computes, which is a different answer from "not modelled"
 * and the one a player needs: there is nothing here to approximate with a toggle.
 */
const OUTSIDE_THE_SEQUENCE: RegExp[] = [
  /\b(?:normal|advance|advancing|fall back|charge|pile-in|consolidation)\s+moves?\b|\bmove characteristic\b|\b(?:advance|charge) rolls?\b|\bdesperate escape\b|\bmoves? (?:through|over|across|within|up to)\b|\bends? (?:that|its|their) move\b|\bengagement range\b|\bterrain features?\b/i,
  /\bset up\b|\breserves?\b|\bdeployment zone\b|\bdeep strike\b|\bdeclare battle formations\b|\bscouts?\b|\binfiltrators\b/i,
  /\b(?:dis)?embark\w*\b|\btransports?\b|\bfiring deck\b/i,
  /\bbattle-shock\w*\b|\bleadership\b|\bobjective control\b|\bobjective markers?\b/i,
  /\bcp\b|\bcommand points?\b|\bstratagems?\b/i,
  /\bmuster\w*\b|\bwarlord\b|\bdetachments?\b|\barmy faction\b|\bfaction keyword\b|\bpoints value\b|\byour army\b|\bcannot include more than\b/i,
  /designer.s note|\btokens?\b|\bsee below\b|\bas follows\b/i,
  /\beligible to (?:shoot|declare a charge|fight)\b/i,
  /\bissues? \w+ orders?\b|\border(?:s)? to (?:a |an )?\w+ units?\b/i,
  /\bonly shoot with this weapon once per battle\b/i,
];

/**
 * Fragments that carry no subject of their own: the connective that introduces a list ("When doing
 * so:"), and a printed table flattened into a line of headings and numbers. Judging them would say
 * more about the punctuation than about the rule.
 */
function carriesASubject(part: string): boolean {
  if (part.trim().split(/\s+/).length < 5) return false;
  return !/\b\d+\b\s+\b\d+\b\s+\b\d+\b/.test(part);
}

/** Does every sentence of this ability talk about something the attack sequence does not contain? */
export function outsideTheAttackSequence(text: string): boolean {
  if (COMBAT.test(text)) return false;
  const parts = sentences(text).filter(carriesASubject);
  if (!parts.length) return false;
  return parts.every((p) => OUTSIDE_THE_SEQUENCE.some((re) => re.test(p)));
}

/** An ability the datasheet spends: modelled, but off until the player says it was used. */
const ONE_SHOT = /\bonce per (?:battle|turn|phase|battle round)\b|\bthe first time\b/i;

function runPatterns(text: string, name: string): { effects: EffectRecord[]; fnp?: number; options?: AbilityOption[] } {
  const effects: EffectRecord[] = [];
  const options: AbilityOption[] = [];
  let fnp: number | undefined;
  for (const p of PATTERNS) {
    const m = p.re.exec(text);
    if (!m) continue;
    const r = p.build(m, text, name);
    const b: Build = Array.isArray(r) ? { effects: r } : r;
    if (b.effects) effects.push(...b.effects);
    if (b.options) options.push(...b.options);
    if (b.fnp !== undefined) fnp = b.fnp;
  }
  effects.push(...grantRecords(text, name));
  const out: { effects: EffectRecord[]; fnp?: number; options?: AbilityOption[] } = { effects };
  if (fnp !== undefined) out.fnp = fnp;
  if (options.length) out.options = options;
  return out;
}

/** Tier-2: derive effect records from ability text with the pattern library. */
export function patternEffects(ability: Ability): AbilityEffects | null {
  const text = (ability.text ?? "").replace(/\s+/g, " ").trim();
  if (!text) return null;
  // A menu is read as its options or not at all. Read flat it would hand the unit every option at
  // once, which is the one answer the datasheet rules out.
  if (isMenu(text)) {
    const options = menuOptions(text, ability.name);
    return options.length ? { tier: "tier2", effects: [], options, notes: ["one of several options; switch on the one taken"] } : null;
  }
  const { effects, fnp } = runPatterns(text, ability.name);
  // Counted with the core keywords that say the same thing. There is no approximation in it: the
  // ability changes nothing the engine computes, and the player has nothing to switch on for it.
  if (!effects.length) return outsideTheAttackSequence(text) ? { tier: "tier1", effects: [], notes: ["no effect on the attack sequence"] } : null;
  const out: AbilityEffects = { tier: "tier2", effects };
  if (fnp !== undefined) out.fnp = fnp;
  if (ONE_SHOT.test(text)) out.defaultOn = false;
  return out;
}

/** Full tiering: explicit effects > core keyword > text patterns > tier3. */
export function abilityEffects(ability: Ability): AbilityEffects {
  // An explicit `effects` array (even empty, from an override pack) is curated data: modelled as Tier 2.
  if (ability.effects) return { tier: "tier2", effects: ability.effects.map((e) => ({ ...e, source: e.source ?? ability.name })), ...(ability.effects.length ? {} : { notes: ["no combat effect"] }) };
  const core = coreAbilityEffects(ability);
  const pat = patternEffects(ability);
  // A core keyword standing for "no effect on the attack sequence" says nothing about the rest of
  // the ability's text, and some sheets print a rule alongside it. The text wins where it says
  // something; the keyword still answers for the sheets where it is all there is.
  if (core && !(core.effects.length === 0 && pat && (pat.effects.length > 0 || (pat.options?.length ?? 0) > 0))) return core;
  if (pat) return pat;
  return { tier: "tier3", effects: [] };
}

export function applyFnpToModels(models: ScenarioModel[], fnp: number | undefined): ScenarioModel[] {
  if (!fnp) return models;
  return models.map((m) => (m.fnp ? m : { ...m, fnp }));
}
