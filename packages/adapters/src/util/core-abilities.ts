import { parseDice, parseTargetNumber } from "./values";

/**
 * Core (Tier-1) unit abilities as named upstream. Adapters normalise these into `Ability.coreKeyword`
 * (upper-case, value-free) + `Ability.coreValue` so the game-system plugin can implement them natively.
 * Names only — no rules text.
 */
export const CORE_ABILITY_KEYWORDS = [
  "FEEL NO PAIN",
  "DEEP STRIKE",
  "STEALTH",
  "LONE OPERATIVE",
  "SCOUTS",
  "INFILTRATORS",
  "FIGHTS FIRST",
  "DEADLY DEMISE",
  "LEADER",
  "SUPPORT",
  "FIRING DECK",
  "HOVER",
  "DAMAGED",
  "SUPER-HEAVY WALKER",
  "INVULNERABLE SAVE",
] as const;
export type CoreAbilityKeyword = (typeof CORE_ABILITY_KEYWORDS)[number];

export interface ParsedCoreAbility {
  keyword: CoreAbilityKeyword;
  value?: number | string;
  /** Trailing qualifier such as "*" (e.g. psychic-only Feel No Pain) or "(Szarekh model only)". */
  qualifier?: string;
}

/** Parse a value token as the plugin expects it: "5+" -> 5, "6\"" -> 6, "D3" -> "D3", "2" -> 2, else raw string. */
export function parseCoreValue(v: string | undefined | null): number | string | undefined {
  if (v === undefined || v === null) return undefined;
  const s = v.trim();
  if (!s) return undefined;
  const tn = parseTargetNumber(s);
  if (tn !== null) return tn;
  const inches = /^(\d+)\s*["”″]$/.exec(s);
  if (inches) return Number(inches[1]);
  const dice = parseDice(s);
  if (dice !== null) return dice;
  return s;
}

/**
 * "Feel No Pain 5+" -> { keyword: "FEEL NO PAIN", value: 5 }; "Scouts 6\"" -> { SCOUTS, 6 };
 * "Deadly Demise D3" -> { DEADLY DEMISE, "D3" }; "Deep Strike" -> { DEEP STRIKE }; "Damaged: 1-4 wounds remaining" -> { DAMAGED, "1-4" }.
 * Returns null for anything that is not a core ability name.
 */
export function parseCoreAbility(name: string): ParsedCoreAbility | null {
  const cleaned = name.replace(/\s+/g, " ").trim();
  if (!cleaned) return null;
  const upper = cleaned.toUpperCase();
  for (const kw of CORE_ABILITY_KEYWORDS) {
    if (upper === kw) return { keyword: kw };
    if (!upper.startsWith(kw)) continue;
    const after = upper[kw.length];
    if (after !== undefined && after !== " " && after !== ":") continue;
    let rest = cleaned.slice(kw.length).trim();
    if (rest.startsWith(":")) rest = rest.slice(1).trim();
    if (!rest) return { keyword: kw };
    // "1-4 wounds remaining" / "5+" / "6\"" / "D3 (X model only)" / "5+*"
    let qualifier: string | undefined;
    const paren = /\s*(\([^)]*\))\s*$/.exec(rest);
    if (paren) {
      qualifier = paren[1];
      rest = rest.slice(0, paren.index).trim();
    }
    if (rest.endsWith("*")) {
      qualifier = qualifier ? `*${qualifier}` : "*";
      rest = rest.slice(0, -1).trim();
    }
    if (kw === "DAMAGED") {
      const m = /^(\d+\s*[-–]\s*\d+)/.exec(rest);
      const out: ParsedCoreAbility = { keyword: kw, value: m ? (m[1] as string).replace(/\s+/g, "") : rest };
      if (qualifier) out.qualifier = qualifier;
      return out;
    }
    const value = parseCoreValue(rest);
    const out: ParsedCoreAbility = { keyword: kw };
    if (value !== undefined) out.value = value;
    if (qualifier) out.qualifier = qualifier;
    return out;
  }
  return null;
}
