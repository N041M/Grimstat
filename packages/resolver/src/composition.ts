/**
 * Reading a datasheet's unit composition, which says how many models a unit has and which models
 * they are. The sources give it as prose. Everything that wants a number out of it reads it here,
 * so the importers, the army builder and the loadout check agree on a unit's size.
 */

/** A composition line as the schema stores it. `description` is optional so callers can pass bare bounds. */
export interface CompositionLineLike {
  description?: string;
  min?: number | undefined;
  max?: number | undefined;
}

/** One "N Name" or "N-M Name" part of a composition line. */
export interface CompositionPart {
  min: number;
  max: number;
  /** The models the part names, without the count. */
  name: string;
}

/**
 * The segments of a line that names models with counts. "1 Runtherd and 10 Gretchin" is two segments,
 * "1 Sword Brother, 5 Initiates and 4 Neophytes" is three. Text in brackets breaks one model into its
 * pieces rather than naming more models, so it goes before the split.
 *
 * Unit composition lines and the points table's rows are written in the same shape, and both are read
 * through here.
 */
export function compositionSegments(text: string): string[] {
  return text.replace(/\([^)]*\)/g, " ").split(/,|\sand\s|\sor\s|\r?\n/i);
}

/** The count and the name a segment opens with, or undefined when it opens with no count. */
export function compositionPart(segment: string): CompositionPart | undefined {
  const m = /^\s*(\d+)(?:\s*[-–]\s*(\d+))?\s+(\S[^\r\n]*)/.exec(segment);
  if (!m) return undefined;
  const name = m[3]!
    .split(/\s+[-–—]\s+/)[0]!
    .replace(/\s*\bmodels?\s*$/i, "")
    .replace(/[.:;\s]+$/, "")
    .trim();
  return { min: Number(m[1]), max: m[2] !== undefined ? Number(m[2]) : Number(m[1]), name };
}

/**
 * Every part of one composition line. Most lines name a single kind of model ("4-9 Wardens"), but a
 * line can name several at once ("1 Runtherd and 10 Gretchin"), and a unit written that way is as big
 * as its parts added together. A segment that opens with no count states no models and is dropped,
 * because a composition line is prose and carries asides a points row would not.
 */
export function compositionParts(description: string): CompositionPart[] {
  const out: CompositionPart[] = [];
  for (const segment of compositionSegments(description)) {
    const part = compositionPart(segment);
    if (part) out.push(part);
  }
  return out;
}

/** The model count one composition line states, or `{}` when it states none ("OR", a note about the unit). */
export function compositionLineBounds(description: string): { min?: number; max?: number } {
  const parts = compositionParts(description);
  if (parts.length === 0) return {};
  return { min: parts.reduce((s, p) => s + p.min, 0), max: parts.reduce((s, p) => s + p.max, 0) };
}

/** A line that opens an alternative rather than naming models. */
function marker(line: CompositionLineLike): "or" | "each-following" | undefined {
  if (typeof line.min === "number" || typeof line.max === "number") return undefined;
  const text = (line.description ?? "").trim();
  if (/^or\b/i.test(text)) return "or";
  if (/^one of the following\b/i.test(text)) return "each-following";
  return undefined;
}

/**
 * A composition split into the alternative ways the datasheet allows the unit to be built. Most
 * sheets give one way and come back as a single branch. A sheet that writes "OR" between two lines,
 * or heads them with "One of the following:", comes back as one branch per alternative. The caller
 * totals each branch on its own, because the unit is built as one alternative or the other.
 *
 * A line that states no count and opens no alternative is a note about the unit, such as "This unit
 * can contain a maximum of 10 models." It stays in the branch it was written in, where it goes on
 * telling the caller that the branch is not fully counted.
 */
export function compositionBranches<T extends CompositionLineLike>(lines: readonly T[]): T[][] {
  const branches: T[][] = [[]];
  let eachFollowing = false;
  for (const line of lines) {
    const kind = marker(line);
    if (kind === "or") {
      branches.push([]);
      eachFollowing = false;
      continue;
    }
    if (kind === "each-following") {
      eachFollowing = true;
      continue;
    }
    const counted = typeof line.min === "number" || typeof line.max === "number";
    if (eachFollowing && counted && branches[branches.length - 1]!.length > 0) branches.push([]);
    branches[branches.length - 1]!.push(line);
  }
  const kept = branches.filter((b) => b.length > 0);
  return kept.length ? kept : [[]];
}
