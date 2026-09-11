const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
  deg: "°",
  // Bullets and multiplication signs carry meaning in a list export: a wargear line is recognised by
  // its bullet, and "2&times; Twin hail gun" is a count. Left encoded they become part of the text.
  bull: "•",
  middot: "·",
  times: "×",
  minus: "−",
  plusmn: "±",
  // Spacing and typographic entities that sources use for layout; a lone `&thinsp;` left encoded
  // splits a weapon name in two.
  ensp: " ",
  emsp: " ",
  thinsp: " ",
  shy: "",
  prime: "′",
  Prime: "″",
  rarr: "→",
  larr: "←",
  frac12: "½",
  frac14: "¼",
  frac34: "¾",
  copy: "©",
  reg: "®",
  trade: "™",
};

/** Is this a code point `String.fromCodePoint` will accept and a reader can display? */
const validCodePoint = (code: number): boolean => Number.isFinite(code) && code >= 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff);

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (m, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      // Out of range would throw, and a lone surrogate would corrupt the string: leave either as written.
      return validCodePoint(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[body] ?? ENTITIES[body.toLowerCase()] ?? m;
  });
}

/**
 * Convert Wahapedia-style HTML into plain text. Line breaks (`<br>`, `</p>`, `</li>`, `</div>`) are
 * kept as newlines, list items become "- " bullets, all other tags (including keyword spans) are removed.
 */
export function stripHtml(html: string | undefined | null): string {
  if (!html) return "";
  let t = html.replace(/\r\n?/g, "\n");
  t = t.replace(/<\s*br\s*\/?\s*>/gi, "\n");
  t = t.replace(/<\s*\/\s*(p|div|tr|h[1-6]|ul|ol|table)\s*>/gi, "\n");
  t = t.replace(/<\s*(p|div|tr|h[1-6]|table|ul|ol)\b[^>]*>/gi, "\n");
  t = t.replace(/<\s*li\b[^>]*>/gi, "\n- ");
  t = t.replace(/<\s*\/\s*li\s*>/gi, "");
  t = t.replace(/<\s*\/\s*t[dh]\s*>/gi, "\t");
  t = t.replace(/<[^>]+>/g, "");
  t = decodeEntities(t);
  t = t.replace(/\u00a0/g, " ");
  // tidy whitespace: trim each line, drop leading/trailing blank lines, collapse 3+ newlines
  t = t
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return t;
}
