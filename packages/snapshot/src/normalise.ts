const WS = /\s/;

/**
 * The trailing `(Legends)` / `[Legends]` marker, taken off the end of a name.
 *
 * Written out rather than read with a pattern because the pattern tries the opening bracket against every
 * place a run of spaces in front of it could end, which costs twenty-six milliseconds on a name padded to
 * four thousand characters. The list importer calls `normaliseName` two to three times for every line it
 * reads. A scan works because the marker closes on the end of the name, so reading it backwards from
 * there finds the one bracket it can open at.
 */
function stripLegends(text: string): string {
  const backWs = (i: number): number => {
    while (i > 0 && WS.test(text[i - 1]!)) i--;
    return i;
  };
  const close = backWs(text.length);
  if (close === 0 || (text[close - 1] !== ")" && text[close - 1] !== "]")) return text;
  const word = backWs(close - 1);
  const start = ["legends", "legend"].find((w) => word >= w.length && text.slice(word - w.length, word).toLowerCase() === w);
  if (start === undefined) return text;
  const open = backWs(word - start.length);
  if (open === 0 || (text[open - 1] !== "(" && text[open - 1] !== "[")) return text;
  return text.slice(0, backWs(open - 1));
}

/**
 * Name normalisation used to join entities across sources: lower-case, ASCII-folded, punctuation and
 * apostrophes removed, whitespace collapsed, trailing "(Legends)" / "[Legends]" markers stripped.
 *
 *   normaliseName("C'tan Shard of the Void Dragon") === "ctan shard of the void dragon"
 *   normaliseName("Anrakyr The Traveller (Legends)") === "anrakyr the traveller"
 */
export function normaliseName(s: string): string {
  return stripLegends(
    s
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase(),
  )
    .replace(/[‘’ʼ'`´]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * Upstream faction names that mean the same thing. Keys and values are normalised faction keys
 * (see `factionKey`). Kept in sync with `FACTION_ALIASES` in @grimstat/adapters.
 */
export const FACTION_KEY_ALIASES: Record<string, string> = {
  "agents-of-the-imperium": "imperial-agents",
  craftworlds: "aeldari",
  "titanicus-traitoris": "chaos-titan-legions",
  "adeptus-titanicus": "titan-legions",
  titans: "titan-legions",
  "adeptus-astartes": "space-marines",
};

/** Canonical faction key from either a faction id ("faction:space-marines") or a display name ("Space Marines"). */
export function factionKey(idOrName: string | undefined | null): string {
  if (!idOrName) return "";
  const raw = idOrName.startsWith("faction:") ? idOrName.slice("faction:".length) : normaliseName(idOrName).replace(/\s+/g, "-");
  return FACTION_KEY_ALIASES[raw] ?? raw;
}

/** Turn a slug back into a comparable name key: "wolf-guard-battle-leader" -> "wolf guard battle leader". */
export function slugToNameKey(slug: string): string {
  return normaliseName(slug.replace(/-/g, " "));
}
