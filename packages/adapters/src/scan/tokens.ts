/**
 * The stream every later stage reads.
 *
 * A list arrives as words, from recognition of a picture or from a paste, and nothing after this
 * point knows which. A word carries where it was read so that position can break a tie, and every
 * stage works when the position is missing.
 */

export interface Box {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface Token {
  /** The word as it was read, punctuation still attached. */
  readonly text: string;
  /** Zero to one. Typed text is one. */
  readonly confidence: number;
  /** The line it was read on, which is the ordering to fall back to when there are no boxes. */
  readonly line: number;
  readonly box?: Box;
}

/**
 * A multiplier or a detachment cost written without spaces, split apart.
 *
 * Lists write "10x Battle Sisters" and "1DP" with no space, and a recogniser closes the gaps that are
 * there: "2 x 10" comes back as "2x10" and "10x WARDEN" as "10xWARDEN". Each of those otherwise
 * costs both the count and the name. Nothing else that mixes digits and letters is touched, because
 * a word that does is a name.
 */
const GLUED = /^(\d+)\s*(x|×)\s*(\d+)$|^(\d+)\s*(x|×)([A-Za-z].*)$|^(\d+)\s*(x|×|dp)$/i;

/** The pieces a glued word splits into, or nothing when it is not one. */
function unglue(raw: string): string[] | undefined {
  const m = GLUED.exec(raw);
  if (!m) return undefined;
  if (m[1] !== undefined) return [m[1], m[2]!, m[3]!];
  if (m[4] !== undefined) return [m[4], m[5]!, m[6]!];
  return [m[7]!, m[8]!];
}

/** The words of a piece of text, numbered by the line they were on. */
export function tokenise(text: string): Token[] {
  const out: Token[] = [];
  const lines = text.split(/\r?\n/);
  for (let line = 0; line < lines.length; line++) {
    for (const raw of lines[line]!.split(/\s+/)) {
      if (!raw) continue;
      const glued = unglue(raw);
      if (glued) {
        for (const piece of glued) out.push({ text: piece, confidence: 1, line });
        continue;
      }
      out.push({ text: raw, confidence: 1, line });
    }
  }
  return out;
}

/** A recognised word, as the OCR stage hands it over. */
export interface ReadWord {
  readonly text: string;
  readonly confidence: number;
  readonly box: Box;
}

/** The middle of a box, across and down. */
const centreX = (w: ReadWord): number => w.box.x + w.box.w / 2;
const centreY = (w: ReadWord): number => w.box.y + w.box.h / 2;

/**
 * How far the lines slope, as a rise over a run.
 *
 * A photograph is never square to the page, and a line that slopes puts the word at one end lower
 * than the word at the other. Grouping by height alone then splits one line in two and hands back
 * the words in the wrong order: on a page four degrees off square, "Swarm Seer" came back as "Seer"
 * on one line and "Swarm" on the next, and no amount of tolerating misspelling recovers a name whose
 * halves have been separated.
 *
 * Measured between words that sit next to each other on a line, because that is where the slope
 * actually lives. Stacking the whole page at different angles and keeping the tidiest is the usual
 * way to find skew, and it cannot be used here: a picture with two columns that start at different
 * heights stacks most tidily at the angle joining one column to the other, which on the overlay is
 * six degrees of skew that is not there.
 *
 * The median over the pairs, so a few words that are not really neighbours cannot move it.
 */
function slopeOf(words: readonly ReadWord[]): number {
  const slopes: number[] = [];
  for (const a of words) {
    let nearest: ReadWord | undefined;
    let nearestGap = Infinity;
    for (const b of words) {
      if (b === a) continue;
      const gap = b.box.x - (a.box.x + a.box.w);
      // To the right, within about a word of space, and level enough to be on the same line.
      if (gap < 0 || gap > a.box.h * 3) continue;
      if (Math.abs(centreY(b) - centreY(a)) > a.box.h) continue;
      if (gap < nearestGap) {
        nearestGap = gap;
        nearest = b;
      }
    }
    if (!nearest) continue;
    const run = centreX(nearest) - centreX(a);
    if (run > 0) slopes.push((centreY(nearest) - centreY(a)) / run);
  }
  if (slopes.length < 4) return 0;
  slopes.sort((a, b) => a - b);
  return slopes[Math.floor(slopes.length / 2)]!;
}

/**
 * Recognised words as a stream.
 *
 * The line numbers come from the boxes rather than from the recogniser's own idea of a line, because
 * recognisers disagree about where a line ends when a picture holds two columns, and the ordering
 * here is only a fallback.
 *
 * The page is straightened first, then words whose vertical middles overlap are one line, then each
 * line is ordered by how far along it a word sits. Ordering the whole page by height without
 * straightening it puts a word two pixels higher than its neighbour in front of it, which on a line
 * of ordinary typesetting happens constantly, and on a photograph happens to whole names.
 */
export function fromWords(words: readonly ReadWord[]): Token[] {
  if (!words.length) return [];
  const heights = [...words].map((w) => w.box.h).sort((a, b) => a - b);
  const height = Math.max(1, heights[Math.floor(heights.length / 2)]!);
  const slope = slopeOf(words);
  const level = (w: ReadWord): number => centreY(w) - centreX(w) * slope;

  const byHeight = [...words].sort((a, b) => level(a) - level(b) || a.box.x - b.box.x);
  const lines: ReadWord[][] = [];
  let bottom = -Infinity;
  for (const w of byHeight) {
    if (level(w) > bottom || !lines.length) {
      lines.push([]);
      bottom = level(w) + height * 0.6;
    }
    lines[lines.length - 1]!.push(w);
  }

  const out: Token[] = [];
  for (let line = 0; line < lines.length; line++) {
    for (const w of lines[line]!.sort((a, b) => a.box.x - b.box.x)) {
      const { text, confidence, box } = w;
      const glued = unglue(text);
      if (glued) {
        for (const piece of glued) out.push({ text: piece, confidence, line, box });
        continue;
      }
      out.push({ text, confidence, line, box });
    }
  }
  return out;
}

/** The text of a run of tokens, as it was read. */
export const phraseOf = (tokens: readonly Token[], from: number, to: number): string =>
  tokens
    .slice(from, to)
    .map((t) => t.text)
    .join(" ");

/**
 * The whole number a token is, or nothing.
 *
 * Punctuation either side is ignored, so "415," and "(90)" count. A recogniser reads the bullet in
 * front of a line as a mark and often joins it to the number after it, and "*2" losing its 2 costs
 * the whole count of a unit.
 */
export function integerOf(token: Token): number | undefined {
  const m = /^[^\dA-Za-z]{0,3}(\d{1,5})[^\dA-Za-z]{0,3}$/.exec(token.text);
  return m ? Number(m[1]) : undefined;
}
