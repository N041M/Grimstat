import type { Ability, CoverageTier, EffectRecord, ScenarioModel } from "@grimstat/schema";
import { CH } from "./channels";

/**
 * Tier-1 core abilities (unit-level) and the Tier-2 text-pattern library.
 * Everything here is best-effort curation of *effects*; the raw text is always kept alongside.
 * No Games Workshop text lives here — only generic rule phrasings.
 */

export interface AbilityEffects {
  tier: CoverageTier;
  effects: EffectRecord[];
  /** Unit-wide Feel No Pain target if the ability grants one. */
  fnp?: number;
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

function rec(stage: EffectRecord["when"]["stage"], side: "attacker" | "defender", op: EffectRecord["op"], target: string, value: number | string | boolean, source: string, cond?: Record<string, unknown>): EffectRecord {
  const r: EffectRecord = { when: { stage, side }, op, target, value, source };
  if (cond && Object.keys(cond).length) r.if = cond as EffectRecord["if"];
  return r;
}

/** Map a Tier-1 core keyword (from `Ability.coreKeyword`) to effects. */
export function coreAbilityEffects(ability: Ability): AbilityEffects | null {
  const k = (ability.coreKeyword ?? "").toUpperCase();
  const v = typeof ability.coreValue === "number" ? ability.coreValue : Number(ability.coreValue);
  switch (k) {
    case "FEEL NO PAIN":
      return { tier: "tier1", effects: [rec("fnp", "defender", "set", CH.fnp, Number.isFinite(v) ? v : 6, ability.name)], fnp: Number.isFinite(v) ? v : 6 };
    case "STEALTH":
      return { tier: "tier1", effects: [rec("hit", "defender", "flag", CH.stealth, true, ability.name)] };
    case "INVULNERABLE SAVE":
      return { tier: "tier1", effects: [rec("save", "defender", "cap", CH.invuln, Number.isFinite(v) ? v : 6, ability.name)] };
    case "DEEP STRIKE":
    case "SCOUTS":
    case "INFILTRATORS":
    case "LONE OPERATIVE":
    case "FIGHTS FIRST":
    case "DEADLY DEMISE":
    case "LEADER":
    case "FIRING DECK":
    case "HOVER":
      return { tier: "tier1", effects: [], notes: ["no effect on the attack sequence"] };
    default:
      return null;
  }
}

interface Pattern {
  re: RegExp;
  build: (m: RegExpExecArray, text: string, name: string) => EffectRecord[] | { effects: EffectRecord[]; fnp?: number };
}

const PATTERNS: Pattern[] = [
  { re: /feel no pain (\d)\+/i, build: (m, _t, n) => ({ effects: [rec("fnp", "defender", "set", CH.fnp, Number(m[1]), n)], fnp: Number(m[1]) }) },
  { re: /(\d)\+ invulnerable save/i, build: (m, _t, n) => [rec("save", "defender", "cap", CH.invuln, Number(m[1]), n)] },
  { re: /re-?roll (?:a )?hit rolls? of 1/i, build: (_m, t, n) => [rec("hit", "attacker", "reroll", CH.rerollHit, "ones", n, { ...kindCond(t), ...targetCond(t), ...extraConds(t) })] },
  { re: /re-?roll (?:a )?wound rolls? of 1/i, build: (_m, t, n) => [rec("wound", "attacker", "reroll", CH.rerollWound, "ones", n, { ...kindCond(t), ...targetCond(t), ...extraConds(t) })] },
  { re: /re-?roll (?:a |the )?hit rolls?(?! of 1)/i, build: (_m, t, n) => [rec("hit", "attacker", "reroll", CH.rerollHit, "failed", n, { ...kindCond(t), ...targetCond(t), ...extraConds(t) })] },
  { re: /re-?roll (?:a |the )?wound rolls?(?! of 1)/i, build: (_m, t, n) => [rec("wound", "attacker", "reroll", CH.rerollWound, "failed", n, { ...kindCond(t), ...targetCond(t), ...extraConds(t) })] },
  { re: /add 1 to (?:the )?hit rolls?|\+1 to hit/i, build: (_m, t, n) => [rec("hit", "attacker", "add", CH.hitRoll, 1, n, { ...kindCond(t), ...targetCond(t), ...extraConds(t) })] },
  { re: /add 1 to (?:the )?wound rolls?|\+1 to wound/i, build: (_m, t, n) => [rec("wound", "attacker", "add", CH.woundRoll, 1, n, { ...kindCond(t), ...targetCond(t), ...extraConds(t) })] },
  { re: /subtract 1 from (?:the )?hit rolls?|-1 to hit/i, build: (_m, t, n) => [rec("hit", "defender", "add", CH.hitRoll, -1, n, { ...kindCond(t) })] },
  { re: /subtract 1 from (?:the )?wound rolls?|-1 to wound/i, build: (_m, t, n) => [rec("wound", "defender", "add", CH.woundRoll, -1, n, { ...kindCond(t) })] },
  { re: /improve (?:the )?armou?r penetration .*? by 1|\+1 (?:to )?(?:ap|armou?r penetration)/i, build: (_m, t, n) => [rec("save", "attacker", "add", CH.ap, 1, n, { ...kindCond(t), ...targetCond(t), ...extraConds(t) })] },
  { re: /worsen (?:the )?armou?r penetration .*? by 1|-1 (?:to )?(?:ap|armou?r penetration)/i, build: (_m, t, n) => [rec("save", "defender", "add", CH.ap, -1, n, { ...kindCond(t) })] },
  { re: /(?:reduce|subtract 1 from) (?:the )?damage .*?by 1|-1 damage/i, build: (_m, t, n) => [rec("damage", "defender", "add", CH.damage, -1, n, { ...kindCond(t) })] },
  { re: /halve(?:d)? (?:the )?damage|damage .*? is halved/i, build: (_m, t, n) => [rec("damage", "defender", "mul", CH.damage, 0.5, n, { ...kindCond(t) })] },
  { re: /add 1 to (?:the )?(?:damage|d) characteristic|\+1 damage/i, build: (_m, t, n) => [rec("damage", "attacker", "add", CH.damage, 1, n, { ...kindCond(t), ...targetCond(t), ...extraConds(t) })] },
  { re: /add 1 to (?:the )?(?:strength|s) characteristic|\+1 strength/i, build: (_m, t, n) => [rec("wound", "attacker", "add", CH.strength, 1, n, { ...kindCond(t), ...extraConds(t) })] },
  { re: /add 1 to (?:the )?(?:attacks|a) characteristic|\+1 attack/i, build: (_m, t, n) => [rec("attacks", "attacker", "add", CH.attacks, 1, n, { ...kindCond(t), ...extraConds(t) })] },
  { re: /\[?lethal hits\]? ability/i, build: (_m, t, n) => [rec("hit", "attacker", "flag", CH.lethal, true, n, { ...kindCond(t), ...targetCond(t), ...extraConds(t) })] },
  { re: /\[?sustained hits (\d|D3)\]? ability/i, build: (m, t, n) => [rec("hit", "attacker", "set", CH.sustained, /^\d$/.test(m[1] ?? "") ? Number(m[1]) : (m[1] ?? "1"), n, { ...kindCond(t), ...targetCond(t), ...extraConds(t) })] },
  { re: /\[?devastating wounds\]? ability/i, build: (_m, t, n) => [rec("wound", "attacker", "flag", CH.devastating, true, n, { ...kindCond(t), ...targetCond(t), ...extraConds(t) })] },
  { re: /\[?ignores cover\]? ability/i, build: (_m, t, n) => [rec("hit", "attacker", "flag", CH.ignoresCover, true, n, { ...kindCond(t) })] },
  { re: /critical hits? on (?:an? )?(?:unmodified )?(?:hit roll of )?(\d)\+/i, build: (m, t, n) => [rec("hit", "attacker", "cap", CH.critHit, Number(m[1]), n, { ...kindCond(t), ...targetCond(t), ...extraConds(t) })] },
  { re: /critical wounds? on (?:an? )?(?:unmodified )?(?:wound roll of )?(\d)\+/i, build: (m, t, n) => [rec("wound", "attacker", "cap", CH.critWound, Number(m[1]), n, { ...kindCond(t), ...targetCond(t), ...extraConds(t) })] },
  { re: /benefit of cover|\bstealth\b/i, build: (_m, _t, n) => [rec("hit", "defender", "flag", CH.stealth, true, n)] },
  { re: /cannot be modified|ignore (?:any|all) (?:hit roll )?modifiers/i, build: (_m, _t, n) => [rec("hit", "defender", "flag", CH.noCritHits, false, n)] },
];

/** Tier-2: derive effect records from ability text with the pattern library. */
export function patternEffects(ability: Ability): AbilityEffects | null {
  const text = ability.text ?? "";
  if (!text) return null;
  const effects: EffectRecord[] = [];
  let fnp: number | undefined;
  for (const p of PATTERNS) {
    const m = p.re.exec(text);
    if (!m) continue;
    const r = p.build(m, text, ability.name);
    const arr = Array.isArray(r) ? r : r.effects;
    if (!Array.isArray(r) && r.fnp) fnp = r.fnp;
    effects.push(...arr);
  }
  if (!effects.length) return null;
  const out: AbilityEffects = { tier: "tier2", effects };
  if (fnp !== undefined) out.fnp = fnp;
  return out;
}

/** Full tiering: explicit effects > core keyword > text patterns > tier3. */
export function abilityEffects(ability: Ability): AbilityEffects {
  if (ability.effects && ability.effects.length) return { tier: "tier2", effects: ability.effects.map((e) => ({ ...e, source: e.source ?? ability.name })) };
  const core = coreAbilityEffects(ability);
  if (core) return core;
  const pat = patternEffects(ability);
  if (pat) return pat;
  return { tier: "tier3", effects: [] };
}

export function applyFnpToModels(models: ScenarioModel[], fnp: number | undefined): ScenarioModel[] {
  if (!fnp) return models;
  return models.map((m) => (m.fnp ? m : { ...m, fnp }));
}
