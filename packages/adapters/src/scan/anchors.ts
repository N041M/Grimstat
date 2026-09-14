/**
 * The names a token stream holds, and where each one sits in it.
 *
 * Every run of words up to six long is offered to the index, which gives back the names it could be.
 * The runs overlap, and a word belongs to one name, so the reading kept is the one that explains the
 * most of the stream. Nothing here looks at lines, columns or order, which is what lets a picture
 * whose words came back interleaved read the same as one that did not.
 *
 * Words that are part of no name are left where they are. A byline, an event name and a score line
 * anchor to nothing and simply do not appear in the result.
 */

import { normaliseName } from "@grimstat/snapshot";
import type { NameEntry, ScanIndex, AnchorKind } from "./names";
import { MIN_SCORE, matchName } from "./names";
import type { Token } from "./tokens";
import { phraseOf } from "./tokens";

export interface Span {
  /** Token index of the first word, inclusive. */
  readonly from: number;
  /** Token index one past the last word. */
  readonly to: number;
  readonly entry: NameEntry;
  readonly score: number;
  /** The words as they were read, for showing the reader what was matched. */
  readonly text: string;
  /** The names this run could have been instead, best first, for the question the user may be asked. */
  readonly alternatives: readonly NameEntry[];
}

export interface AnchorOptions {
  /** Longest run of words offered to the index. Names longer than this are rare. */
  readonly maxWords?: number;
  readonly minScore?: number;
  readonly kinds?: readonly AnchorKind[];
  /**
   * Datasheets in this faction score a little higher, which is how the second pass uses what the
   * first pass learned. See `army.ts`.
   */
  readonly preferIds?: ReadonlySet<string>;
}

const MAX_WORDS = 6;
/** How much a name is worth being in the faction the units voted for. */
const PREFERRED = 1.04;

/**
 * What a span is worth to the reading.
 *
 * The length term is the matched name's own length rather than the number of words the span covers.
 * Counting words rewards a span for swallowing whatever sits beside a name, and a recogniser reads
 * the bullet in front of a unit as a letter: "o Warden Captain" over three words beat
 * "Warden Captain" over two, for a name it had read perfectly. Measuring how much name was explained
 * cannot be gamed that way, and it still prefers "Warden Squad" to the "Warden" inside it.
 *
 * Cubing the score stops a weak match over a long name beating a strong one over a short name. A run
 * matched at 0.75 is usually two real names read badly rather than one long one.
 */
const weigh = (span: Span, prefer: ReadonlySet<string> | undefined): number => {
  const preferred = prefer && span.entry.ids.some((id) => prefer.has(id)) ? PREFERRED : 1;
  return Math.pow(span.score, 3) * span.entry.key.length * preferred;
};

/**
 * Whether a token carries any of a name.
 *
 * A bullet glyph, a dash or a stray mark normalises to nothing. A span must not begin or end on one:
 * a recogniser reads the bullet in front of a unit as "o" or "e" or a copyright sign, and a span
 * that swallows it matches a little worse than the name alone, which is enough to make the importer
 * ask about a unit it read perfectly well.
 */
const carriesName = (token: Token | undefined): boolean => !!token && normaliseName(token.text).length > 0;

/** Every name every run of words could be, before the overlaps are resolved. */
function candidates(tokens: readonly Token[], index: ScanIndex, options: AnchorOptions): Span[] {
  const maxWords = options.maxWords ?? MAX_WORDS;
  const minScore = options.minScore ?? MIN_SCORE;
  const out: Span[] = [];
  for (let from = 0; from < tokens.length; from++) {
    if (!carriesName(tokens[from])) continue;
    for (let n = 1; n <= maxWords && from + n <= tokens.length; n++) {
      const to = from + n;
      if (!carriesName(tokens[to - 1])) continue;
      const text = phraseOf(tokens, from, to);
      const matches = matchName(index, text, { minScore, ...(options.kinds ? { kinds: options.kinds } : {}) });
      if (!matches.length) continue;
      const best = matches[0]!;
      out.push({ from, to, entry: best.entry, score: best.score, text, alternatives: matches.slice(1).map((m) => m.entry) });
    }
  }
  return out;
}

/**
 * The spans that explain the most of the stream, with no two of them sharing a word.
 *
 * A pass along the token axis, taking at each word the better of skipping it and ending a span on
 * it. The spans are intervals on one axis and the best reading of a prefix never changes once it is
 * settled, so this is the whole answer rather than a good guess at it.
 */
export function resolve(spans: readonly Span[], length: number, prefer?: ReadonlySet<string>): Span[] {
  const endingAt: Span[][] = Array.from({ length: length + 1 }, () => []);
  for (const s of spans) endingAt[s.to]!.push(s);

  const best = new Array<number>(length + 1).fill(0);
  const taken = new Array<Span | undefined>(length + 1).fill(undefined);
  for (let at = 1; at <= length; at++) {
    best[at] = best[at - 1]!;
    for (const s of endingAt[at]!) {
      const score = best[s.from]! + weigh(s, prefer);
      if (score > best[at]!) {
        best[at] = score;
        taken[at] = s;
      }
    }
  }

  const out: Span[] = [];
  for (let at = length; at > 0; ) {
    const s = taken[at];
    if (!s) {
      at--;
      continue;
    }
    out.push(s);
    at = s.from;
  }
  return out.reverse();
}

/** The names in a token stream, in the order they were read. */
export function anchor(tokens: readonly Token[], index: ScanIndex, options: AnchorOptions = {}): Span[] {
  return resolve(candidates(tokens, index, options), tokens.length, options.preferIds);
}
