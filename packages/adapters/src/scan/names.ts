/**
 * Every name in a snapshot, in one index that tolerates misspelling.
 *
 * This is what makes reading a list from a picture possible without knowing how the picture was laid
 * out. A name is recognised wherever it appears, so the order the words arrive in does not have to be
 * the order they were written in.
 *
 * Separate from `nameIndexOf`, which covers datasheets and factions for the exact and token-set
 * lookups the text importers need. This one covers weapons, models, detachments, enhancements and
 * force dispositions as well, and it matches by edit distance.
 */

import type { Snapshot } from "@grimstat/schema";
import { normaliseName } from "@grimstat/snapshot";

export type AnchorKind = "datasheet" | "detachment" | "enhancement" | "weapon" | "model" | "disposition" | "faction";

export interface NameEntry {
  readonly kind: AnchorKind;
  /** One spelling of the name, for showing back to the reader. */
  readonly name: string;
  /** The normalised form everything is matched against. */
  readonly key: string;
  /**
   * What the name refers to. A datasheet, detachment or enhancement id for those kinds, and the ids
   * of the datasheets carrying the weapon or the model profile for those two. A weapon name is
   * shared by dozens of datasheets, so one entry holds them all and the ownership stage reads the
   * list, rather than the index being made mostly of duplicates.
   */
  readonly ids: readonly string[];
}

export interface ScanIndex {
  readonly entries: readonly NameEntry[];
  /** Entry indices by three-character run of their key. */
  readonly byTrigram: ReadonlyMap<string, readonly number[]>;
  readonly byKey: ReadonlyMap<string, readonly number[]>;
}

export interface NameMatch {
  readonly entry: NameEntry;
  /** One for an exact match, falling towards zero as the edit distance approaches the length. */
  readonly score: number;
}

/** Below this the two names are different names rather than one misread. */
export const MIN_SCORE = 0.74;

/** A key shorter than this matches too much to be worth anchoring on. */
const MIN_KEY = 3;

const trigramsOf = (key: string): string[] => {
  const padded = ` ${key} `;
  if (padded.length < 3) return [padded];
  const out: string[] = [];
  for (let i = 0; i + 3 <= padded.length; i++) out.push(padded.slice(i, i + 3));
  return out;
};

const INDEXES = new WeakMap<Snapshot, ScanIndex>();

/** The index for a snapshot, built once and kept on it, the way `nameIndexOf` is. */
export function scanIndexOf(snapshot: Snapshot): ScanIndex {
  const cached = INDEXES.get(snapshot);
  if (cached) return cached;

  // Collected by kind and key first, so one weapon name carried by forty datasheets is one entry.
  const collected = new Map<string, { kind: AnchorKind; name: string; key: string; ids: string[] }>();
  const add = (kind: AnchorKind, name: string, id?: string) => {
    const key = normaliseName(name);
    if (key.length < MIN_KEY) return;
    const at = `${kind}:${key}`;
    const seen = collected.get(at);
    if (!seen) {
      collected.set(at, { kind, name, key, ids: id ? [id] : [] });
      return;
    }
    if (id && !seen.ids.includes(id)) seen.ids.push(id);
  };

  for (const ds of snapshot.data.datasheets) {
    add("datasheet", ds.name, ds.id);
    for (const w of ds.weapons) add("weapon", w.name, ds.id);
    for (const m of ds.models) add("model", m.name, ds.id);
  }
  for (const det of snapshot.data.detachments) {
    add("detachment", det.name, det.id);
    for (const d of det.forceDispositions) add("disposition", d, det.id);
  }
  for (const enh of snapshot.data.enhancements) add("enhancement", enh.name, enh.id);
  /*
   * Faction names are indexed so that a title reading "Ashen Wardens" anchors as the faction rather
   * than as the Warden model profile inside it, which is one edit away from "Wardens". Nothing
   * downstream reads these: the army is decided by the units, and the title is left to agree or not.
   */
  for (const faction of snapshot.data.factions) add("faction", faction.name, faction.id);

  const entries: NameEntry[] = [...collected.values()].map((e) => ({ kind: e.kind, name: e.name, key: e.key, ids: e.ids }));
  const byTrigram = new Map<string, number[]>();
  const byKey = new Map<string, number[]>();
  for (let i = 0; i < entries.length; i++) {
    const { key } = entries[i]!;
    byKey.set(key, [...(byKey.get(key) ?? []), i]);
    for (const t of new Set(trigramsOf(key))) byTrigram.set(t, [...(byTrigram.get(t) ?? []), i]);
  }

  const index: ScanIndex = { entries, byTrigram, byKey };
  INDEXES.set(snapshot, index);
  return index;
}

/**
 * Optimal string alignment distance, giving up once the bound is passed.
 *
 * Transpositions count as one step because they are what a writer's fingers and a recogniser's
 * confusions both produce. The bound is what keeps this affordable. The index holds thousands of
 * names and the caller asks about every run of words in the list, so most comparisons have to stop
 * in their first row.
 */
export function editDistance(a: string, b: string, bound: number): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > bound) return bound + 1;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  let prev2: number[] = [];
  let prev: number[] = Array.from({ length: b.length + 1 }, (_, j) => j);
  let row: number[] = new Array<number>(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    row[0] = i;
    let least = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(row[j - 1]! + 1, prev[j]! + 1, prev[j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2]! + 1);
      row[j] = v;
      if (v < least) least = v;
    }
    if (least > bound) return bound + 1;
    prev2 = prev;
    prev = row;
    row = new Array<number>(b.length + 1);
  }
  return prev[b.length]!;
}

/**
 * Which kind wins when two match a phrase equally well.
 *
 * A one-model datasheet and its own model profile carry the same name, so every such unit ties with
 * itself. The datasheet is what a list names, so it goes first.
 */
const RANK: Record<AnchorKind, number> = { datasheet: 0, faction: 1, detachment: 2, enhancement: 3, weapon: 4, model: 5, disposition: 6 };

/** One minus the share of the longer name that had to change. */
const scoreOf = (dist: number, a: string, b: string): number => 1 - dist / Math.max(a.length, b.length);

export interface MatchOptions {
  readonly kinds?: readonly AnchorKind[];
  readonly minScore?: number;
  readonly limit?: number;
}

/**
 * The names a phrase could be, best first.
 *
 * Candidates come from the trigram index rather than from the whole of it. Two names that share no
 * three-character run are further apart than any bound worth computing, and on a real snapshot that
 * is all but a handful of the entries.
 */
export function matchName(index: ScanIndex, phrase: string, options: MatchOptions = {}): NameMatch[] {
  const key = normaliseName(phrase);
  if (key.length < MIN_KEY) return [];
  const min = options.minScore ?? MIN_SCORE;
  const limit = options.limit ?? 5;
  const kinds = options.kinds;

  const wanted = trigramsOf(key);
  const shared = new Map<number, number>();
  for (const t of new Set(wanted)) {
    for (const i of index.byTrigram.get(t) ?? []) shared.set(i, (shared.get(i) ?? 0) + 1);
  }

  const out: NameMatch[] = [];
  for (const [i, hits] of shared) {
    const entry = index.entries[i]!;
    if (kinds && !kinds.includes(entry.kind)) continue;
    const bound = Math.floor((1 - min) * Math.max(key.length, entry.key.length));
    // A name sharing too few runs with the phrase cannot come within the bound. Each edit destroys
    // at most three runs, so a candidate needs the shorter name's runs less three per edit allowed.
    // A padded key of n characters has exactly n runs, which is what `trigramsOf` returns.
    if (hits < Math.min(wanted.length, entry.key.length) - 3 * bound) continue;
    const dist = editDistance(key, entry.key, bound);
    if (dist > bound) continue;
    const score = scoreOf(dist, key, entry.key);
    if (score < min) continue;
    out.push({ entry, score });
  }
  out.sort((a, b) => b.score - a.score || RANK[a.entry.kind] - RANK[b.entry.kind] || b.entry.key.length - a.entry.key.length);
  return out.slice(0, limit);
}
