import type { WeaponKeyword } from "@grimstat/schema";

/**
 * Parse a weapon's keyword column ("Rapid Fire 1, Lethal Hits, Anti-vehicle 4+") into structured keywords.
 * - name: upper-case, value-free ("SUSTAINED HITS", "ANTI", "RAPID FIRE", "MELTA", "BLAST", "CLEAVE", ...)
 * - value: number for "4+" / "1"; string for dice ("D3", "D6+1")
 * - keyword: the target keyword for ANTI-X and for conditional forms ("LETHAL HITS: non-MONSTER/VEHICLE")
 * - raw: the original token
 */
export function parseWeaponKeywords(text: string | undefined | null): WeaponKeyword[] {
  if (!text) return [];
  const out: WeaponKeyword[] = [];
  for (const rawToken of splitKeywords(text)) {
    const token = rawToken.replace(/^\[|\]$/g, "").trim();
    if (!token || token === "-") continue;
    out.push(parseOne(token, rawToken.trim()));
  }
  return out;
}

function splitKeywords(text: string): string[] {
  return text
    .replace(/\u00a0/g, " ")
    .split(/,|;|\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

const DICE_RE = /^(\d*)[dD](3|6)(\s*[+-]\s*\d+)?$/;

function parseValue(v: string): number | string {
  const s = v.trim();
  const m = /^(\d+)\+?$/.exec(s);
  if (m) return Number(m[1]);
  if (DICE_RE.test(s)) return s.toUpperCase().replace(/\s+/g, "");
  return s.toUpperCase();
}

function normaliseName(name: string): string {
  return name
    .replace(/\s+/g, " ")
    .replace(/\s*-\s*/g, "-")
    .trim()
    .toUpperCase();
}

function parseOne(token: string, raw: string): WeaponKeyword {
  // conditional suffix: "LETHAL HITS: non-MONSTER/VEHICLE", "DEVASTATING WOUNDS: INFANTRY"
  let condition: string | undefined;
  let body = token;
  const colon = token.indexOf(":");
  if (colon > 0) {
    condition = token.slice(colon + 1).trim().toUpperCase();
    body = token.slice(0, colon).trim();
  }

  // ANTI-X N+  (also "Anti vehicle 4+", "ANTI-MONSTER/VEHICLE 4+")
  const anti = /^anti[\s-]+(.+?)\s+(\d\+?)$/i.exec(body);
  if (anti) {
    const kw: WeaponKeyword = { name: "ANTI", keyword: (anti[1] as string).toUpperCase(), value: parseValue(anti[2] as string), raw };
    return kw;
  }
  const antiNoValue = /^anti[\s-]+([a-z/ ]+)$/i.exec(body);
  if (antiNoValue) {
    return { name: "ANTI", keyword: (antiNoValue[1] as string).trim().toUpperCase(), raw };
  }

  // trailing value: number, N+, dice, or inches
  const withValue = /^(.+?)\s+((?:\d+\+?)|(?:\d*[dD](?:3|6)(?:\s*[+-]\s*\d+)?)|(?:\d+"))$/.exec(body);
  if (withValue) {
    const name = normaliseName(withValue[1] as string);
    let valueText = withValue[2] as string;
    if (valueText.endsWith('"')) valueText = valueText.slice(0, -1);
    const kw: WeaponKeyword = { name, value: parseValue(valueText), raw };
    if (condition) kw.keyword = condition;
    return kw;
  }

  const kw: WeaponKeyword = { name: normaliseName(body), raw };
  if (condition) kw.keyword = condition;
  return kw;
}
