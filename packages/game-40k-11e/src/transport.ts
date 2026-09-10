/**
 * Transport-capacity prose parser. Datasheets carry the capacity as free text
 * ("This model has a transport capacity of 12 INFANTRY models. Each TERMINATOR model takes up
 * the space of 2 models. It cannot transport JUMP PACK models."); this turns it into numbers and
 * keyword phrases the army constraints can check against a unit's keywords.
 */
export interface TransportCapacity {
  /** Model slots available. */
  capacity: number;
  /**
   * Alternative keyword phrases a unit must satisfy to embark, kept as raw uppercase phrases
   * (e.g. ["ADEPTUS ASTARTES INFANTRY"]). Empty when the prose names no keyword ("22 models").
   */
  keywords: string[];
  /** Keyword phrases the transport refuses ("It cannot transport JUMP PACK or WRAITH models"). */
  excluded: string[];
  /** Models matching `keyword` occupy `takes` slots each. */
  sizes: Array<{ keyword: string; takes: number }>;
  /** The source prose. */
  text: string;
}

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
};
const NUMBER = `(\\d+|${Object.keys(NUMBER_WORDS).join("|")})`;

function toNumber(raw: string): number | undefined {
  const s = raw.trim().toLowerCase();
  if (/^\d+$/.test(s)) return Number(s);
  return NUMBER_WORDS[s];
}

/** Strips the trailing "model"/"models" nouns and splits "A, B or C" into ["A", "B", "C"], uppercased. */
function splitPhrases(raw: string): string[] {
  return raw
    .replace(/\bmodels?\b/gi, " ")
    .split(/\s*,\s*|\s+or\s+|\s+and\s+/i)
    .map((s) => s.replace(/^\s*(?:the|a|an|any)\s+/i, "").trim().toUpperCase())
    .filter(Boolean);
}

/**
 * Words of a keyword phrase that matter for matching: tokens with no lowercase letters
 * ("ADEPTUS ASTARTES INFANTRY or MOUNTED" → ADEPTUS, ASTARTES, INFANTRY, MOUNTED). Falls back to
 * every token when the source did not uppercase its keywords.
 */
function wordsOf(phrase: string): string[] {
  const tokens = phrase.split(/[\s,]+/).filter(Boolean);
  const upper = tokens.filter((t) => !/[a-z]/.test(t) && /[A-Z0-9]/.test(t));
  const chosen = upper.length ? upper : tokens.filter((t) => !/^(?:or|and|the|a|an|any)$/i.test(t));
  return chosen.map((t) => t.toUpperCase());
}

export function parseTransportCapacity(text: string | undefined): TransportCapacity | undefined {
  if (!text) return undefined;
  const src = text.replace(/\s+/g, " ").trim();
  const cap = new RegExp(`transport capacity of ${NUMBER}\\s+(.*?)\\s*\\bmodels?\\b`, "i").exec(src);
  if (!cap) return undefined;
  const capacity = toNumber(cap[1]!);
  if (capacity === undefined) return undefined;
  const keywords = splitPhrases(cap[2] ?? "").filter((p) => wordsOf(p).length);

  const excluded: string[] = [];
  for (const m of src.matchAll(/cannot (?:transport|carry) ([^.;]*)/gi)) {
    for (const seg of m[1]!.matchAll(/(.+?)\s*\bmodels?\b/g)) excluded.push(...splitPhrases(seg[1]!));
  }

  const sizes: Array<{ keyword: string; takes: number }> = [];
  const sizeRe = new RegExp(`(?:each|every) (.+?) models? takes? (?:up )?the space of ${NUMBER} models?`, "gi");
  for (const m of src.matchAll(sizeRe)) {
    const takes = toNumber(m[2]!);
    if (takes === undefined || takes < 1) continue;
    for (const keyword of splitPhrases(m[1]!)) sizes.push({ keyword, takes });
  }

  return { capacity, keywords, excluded, sizes, text };
}

/** Set of whole keywords and their individual words, uppercased ("ADEPTUS ASTARTES" → itself, ADEPTUS, ASTARTES). */
function keywordWords(dsKeywords: string[]): Set<string> {
  const out = new Set<string>();
  for (const k of dsKeywords) {
    const u = k.trim().toUpperCase();
    if (!u) continue;
    out.add(u);
    for (const w of u.split(/\s+/)) out.add(w);
  }
  return out;
}

/** True when the unit carries `phrase` as a whole keyword or every word of the phrase appears among its keywords. */
export function hasKeywordPhrase(dsKeywords: string[], phrase: string): boolean {
  const have = keywordWords(dsKeywords);
  const p = phrase.trim().toUpperCase();
  if (!p) return false;
  if (have.has(p)) return true;
  const words = wordsOf(p);
  return words.length > 0 && words.every((w) => have.has(w));
}

/**
 * Whether a unit with these datasheet keywords (pass faction keywords too) satisfies the transport's
 * keyword phrase. True when the phrase is empty or when, for some alternative, every uppercase word
 * of the phrase appears in the unit's keywords (case-insensitive).
 */
export function unitFitsKeywords(dsKeywords: string[], cap: TransportCapacity): boolean {
  if (!cap.keywords.length) return true;
  return cap.keywords.some((phrase) => hasKeywordPhrase(dsKeywords, phrase));
}
