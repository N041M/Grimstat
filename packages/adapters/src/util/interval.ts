/** Inclusive 1-based copy range; `max` undefined = open-ended. */
export interface CopyRange {
  min: number;
  max?: number;
}

/** Parse MFM interval notation: "[1,2]" -> {min:1,max:2}, "[3,)" -> {min:3}. Returns null when unparseable. */
export function parseInterval(text: string): CopyRange | null {
  const m = /^\s*[[(]\s*(\d+)\s*,\s*(\d+)?\s*([\])])\s*$/.exec(text);
  if (!m) return null;
  let min = Number(m[1]);
  if (text.trim().startsWith("(")) min += 1;
  const maxRaw = m[2];
  if (maxRaw === undefined) return { min };
  let max = Number(maxRaw);
  if (m[3] === ")") max -= 1;
  if (max < min) return null;
  return { min, max };
}

export function formatInterval(r: CopyRange): string {
  return r.max === undefined ? `[${r.min},)` : `[${r.min},${r.max}]`;
}

const ORDINAL_WORDS: Record<string, number> = {
  first: 1,
  second: 2,
  third: 3,
  fourth: 4,
  fifth: 5,
  sixth: 6,
};

function ordinal(s: string): number | null {
  const m = /^(\d+)(?:st|nd|rd|th)?$/i.exec(s.trim());
  if (m) return Number(m[1]);
  return ORDINAL_WORDS[s.trim().toLowerCase()] ?? null;
}

/**
 * Parse an MFM-style tier heading into a copy range:
 *  "Your Unit Costs" -> [1,)     "Your 1st Unit Costs" -> [1,1]     "Your 2nd + Unit Costs" -> [2,)
 *  "Your 1st To 2nd Units Cost" -> [1,2]     "YOUR 3RD + UNIT COSTS" -> [3,)
 */
export function parseCopyRangeLabel(label: string): CopyRange | null {
  const t = label.trim().toLowerCase().replace(/\s+/g, " ");
  if (!t) return null;
  let m = /(\d+(?:st|nd|rd|th)?|first|second|third|fourth|fifth|sixth)\s+to\s+(\d+(?:st|nd|rd|th)?|first|second|third|fourth|fifth|sixth)\s+units?\s+cost/.exec(t);
  if (m) {
    const a = ordinal(m[1] as string);
    const b = ordinal(m[2] as string);
    if (a !== null && b !== null && b >= a) return { min: a, max: b };
    return null;
  }
  m = /(\d+(?:st|nd|rd|th)?|first|second|third|fourth|fifth|sixth)\s*\+\s*units?\s+cost/.exec(t);
  if (m) {
    const a = ordinal(m[1] as string);
    return a === null ? null : { min: a };
  }
  m = /(\d+(?:st|nd|rd|th)?|first|second|third|fourth|fifth|sixth)\s+units?\s+cost/.exec(t);
  if (m) {
    const a = ordinal(m[1] as string);
    return a === null ? null : { min: a, max: a };
  }
  if (/^(your\s+)?units?\s+costs?$/.test(t) || /^unit costs?$/.test(t)) return { min: 1 };
  return null;
}
