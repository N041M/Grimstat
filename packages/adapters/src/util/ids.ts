/**
 * Deterministic, human-readable ids. Every adapter derives ids from names with these helpers so that
 * the same entity gets the same id regardless of which source produced it; the snapshot merge then
 * re-keys anything that still differs (see @grimstat/snapshot normaliseName).
 */

/** Lower-case, ASCII-folded, punctuation-free, hyphen-separated slug. Apostrophes are removed ("C'tan" -> "ctan"). */
export function slugify(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u2018\u2019\u02bc'`\u00b4]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Canonical faction slug. A few upstream names are aliased so the three sources agree. */
export const FACTION_ALIASES: Record<string, string> = {
  "agents-of-the-imperium": "imperial-agents",
  craftworlds: "aeldari",
  "titanicus-traitoris": "chaos-titan-legions",
  "adeptus-titanicus": "titan-legions",
  titans: "titan-legions",
  "adeptus-astartes": "space-marines",
};

export function factionSlug(name: string): string {
  const s = slugify(name);
  return FACTION_ALIASES[s] ?? s;
}

export const factionId = (name: string): string => `faction:${factionSlug(name)}`;
export const datasheetId = (faction: string, name: string): string => `ds:${factionSlug(faction)}:${slugify(name)}`;
export const detachmentId = (faction: string, name: string): string => `det:${factionSlug(faction)}:${slugify(name)}`;
export const enhancementId = (faction: string, name: string): string => `enh:${factionSlug(faction)}:${slugify(name)}`;
export const stratagemId = (faction: string | undefined, detachment: string | undefined, name: string): string =>
  `strat:${faction ? factionSlug(faction) : "core"}:${detachment ? slugify(detachment) + ":" : ""}${slugify(name)}`;
export const coreAbilityId = (name: string, value?: string | number): string =>
  `ab:core:${slugify(name)}${value !== undefined && value !== "" ? ":" + slugify(String(value)) : ""}`;
export const factionAbilityId = (faction: string, name: string): string => `ab:${factionSlug(faction)}:${slugify(name)}`;
export const datasheetAbilityId = (dsId: string, name: string): string => `ab:${dsId.replace(/^ds:/, "")}:${slugify(name)}`;
export const detachmentAbilityId = (detId: string, name: string): string => `ab:${detId.replace(/^det:/, "det-")}:${slugify(name)}`;
export const modelProfileId = (dsId: string, name: string): string => `mp:${dsId.replace(/^ds:/, "")}:${slugify(name)}`;
export const weaponProfileId = (dsId: string, name: string): string => `wp:${dsId.replace(/^ds:/, "")}:${slugify(name)}`;

/** Returns `id`, or `id-2`, `id-3`... if already used; records the result in `used`. */
export function uniqueId(id: string, used: Set<string>): string {
  let candidate = id;
  let n = 2;
  while (used.has(candidate)) candidate = `${id}-${n++}`;
  used.add(candidate);
  return candidate;
}
