/**
 * Name normalisation used to join entities across sources: lower-case, ASCII-folded, punctuation and
 * apostrophes removed, whitespace collapsed, trailing "(Legends)" / "[Legends]" markers stripped.
 *
 *   normaliseName("C'tan Shard of the Void Dragon") === "ctan shard of the void dragon"
 *   normaliseName("Anrakyr The Traveller (Legends)") === "anrakyr the traveller"
 */
export function normaliseName(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s*[([]\s*legends?\s*[)\]]\s*$/i, "")
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
