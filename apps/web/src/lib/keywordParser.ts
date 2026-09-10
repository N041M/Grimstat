import type { WeaponKeyword } from "@grimstat/schema";

/**
 * Tolerant parser for weapon-keyword text, e.g.
 *   "Sustained Hits D3, Lethal Hits, Anti-vehicle 4+, Blast, Rapid Fire 1, Melta 2"
 * -> [{name:"SUSTAINED HITS",value:"D3"},{name:"LETHAL HITS"},{name:"ANTI",keyword:"VEHICLE",value:4},
 *     {name:"BLAST"},{name:"RAPID FIRE",value:1},{name:"MELTA",value:2}]
 * Every entry keeps `raw` so unknown keywords survive round trips and can be shown as-is.
 */
export function parseKeywordText(text: string): WeaponKeyword[] {
  const out: WeaponKeyword[] = [];
  for (const piece of splitKeywords(text)) {
    const kw = parseOne(piece);
    if (kw) out.push(kw);
  }
  return out;
}

/** Inverse of parseKeywordText: text the user can edit. Prefers `raw`, else rebuilds from the fields. */
export function keywordsToText(keywords: WeaponKeyword[]): string {
  return keywords.map(keywordToText).join(", ");
}

export function keywordToText(k: WeaponKeyword): string {
  if (k.raw) return k.raw;
  const name = titleCase(k.name);
  if (k.name.toUpperCase() === "ANTI" && k.keyword) return `Anti-${k.keyword.toLowerCase()} ${k.value ?? ""}+`.trim();
  return k.value === undefined ? name : `${name} ${k.value}`;
}

function splitKeywords(text: string): string[] {
  return text
    .replace(/[[\]]/g, "")
    .split(/[,;\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function parseOne(raw: string): WeaponKeyword | undefined {
  const trimmed = raw.trim().replace(/\s+/g, " ");
  if (!trimmed) return undefined;

  // ANTI-<KEYWORD> N+ (also "Anti Vehicle 4+", "anti-infantry 3")
  const anti = /^anti[\s-]+([a-z][a-z' -]*?)\s*(\d)\s*\+?$/i.exec(trimmed);
  if (anti && anti[1] && anti[2]) {
    return { name: "ANTI", keyword: anti[1].trim().toUpperCase(), value: Number(anti[2]), raw: trimmed };
  }

  // <NAME> <VALUE> where value is a number, dice expression, or "N+"
  const withValue = /^([a-z][a-z' -]*?)\s+((?:\d*d[36](?:\s*[+-]\s*\d+)?)|\d+\+?)$/i.exec(trimmed);
  if (withValue && withValue[1] && withValue[2]) {
    const name = normaliseName(withValue[1]);
    const v = withValue[2].replace(/\s+/g, "").toUpperCase();
    const value: number | string = /^\d+$/.test(v) ? Number(v) : /^\d+\+$/.test(v) ? Number(v.slice(0, -1)) : v;
    return { name, value, raw: trimmed };
  }

  return { name: normaliseName(trimmed), raw: trimmed };
}

/** Canonical upper-case names; keeps hyphens where the plugin uses them (TWIN-LINKED). */
function normaliseName(s: string): string {
  const up = s.trim().toUpperCase().replace(/\s+/g, " ");
  const aliases: Record<string, string> = {
    "TWIN LINKED": "TWIN-LINKED",
    TWINLINKED: "TWIN-LINKED",
    "SUSTAINED HIT": "SUSTAINED HITS",
    "LETHAL HIT": "LETHAL HITS",
    "DEVASTATING WOUND": "DEVASTATING WOUNDS",
    "DEV WOUNDS": "DEVASTATING WOUNDS",
    "IGNORE COVER": "IGNORES COVER",
    "RAPIDFIRE": "RAPID FIRE",
    "INDIRECT": "INDIRECT FIRE",
    "CLOSE QUARTERS": "CLOSE-QUARTERS",
    "ONE-SHOT": "ONE SHOT",
  };
  return aliases[up] ?? up;
}

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .split(" ")
    .map((w) => (w ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join(" ");
}
