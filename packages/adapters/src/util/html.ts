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
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[body.toLowerCase()] ?? m;
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
  t = t.replace(/ /g, " ");
  // tidy whitespace: trim each line, drop leading/trailing blank lines, collapse 3+ newlines
  t = t
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return t;
}
