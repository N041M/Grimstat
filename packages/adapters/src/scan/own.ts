/**
 * Which unit a loose piece of evidence belongs to.
 *
 * A weapon, a model profile or an enhancement is written near the unit it belongs to, and a picture
 * that was recognised across two columns loses that nearness. The snapshot does not lose it. A
 * datasheet lists its own weapons, so a weapon that only one unit in the list can carry belongs to
 * that unit wherever it was read. Most evidence in a real list has exactly one possible owner.
 *
 * Where more than one unit could own it, position decides, and where there are no boxes the nearest
 * name in the stream does. Both are preferences, and neither is needed for the common case.
 */

import type { Snapshot } from "@grimstat/schema";
import type { Span } from "./anchors";
import type { Token } from "./tokens";

/** Why a piece of evidence ended up where it did, for the reader and for the tests. */
export type Reason = "only-owner" | "position" | "stream" | "none";

export interface Placement {
  /** Index into the units that were offered, or nothing when none of them could own it. */
  readonly unit: number | undefined;
  readonly reason: Reason;
  /** The units that could have owned it, when more than one could. */
  readonly candidates: readonly number[];
}

/** A unit the list holds, as the anchor stage found it. */
export interface UnitAnchor {
  readonly span: Span;
  readonly datasheetId: string;
}

/** Units that could carry this evidence, by the rules of what owns what. */
function possible(snapshot: Snapshot, units: readonly UnitAnchor[], evidence: Span): number[] {
  const { kind, ids } = evidence.entry;
  if (kind === "weapon" || kind === "model") {
    return units.flatMap((u, i) => (ids.includes(u.datasheetId) ? [i] : []));
  }
  if (kind === "enhancement") {
    // An enhancement goes on a character, and only one of this list's detachments offers it. The
    // detachment is checked by the fit; here it is enough that the unit can carry one at all.
    const sheets = new Map(snapshot.data.datasheets.map((d) => [d.id, d] as const));
    return units.flatMap((u, i) => {
      const ds = sheets.get(u.datasheetId);
      return ds?.isCharacter && !ds.isEpicHero ? [i] : [];
    });
  }
  return [];
}

/** How far apart two boxes are, with anything above the evidence pushed away. */
function distance(unit: Span, evidence: Span, tokens: readonly Token[]): number {
  const a = tokens[unit.from]?.box;
  const b = tokens[evidence.from]?.box;
  if (!a || !b) return Infinity;
  const below = b.y >= a.y;
  const dx = Math.abs(b.x - a.x);
  const dy = Math.abs(b.y - a.y);
  return dx + dy * (below ? 1 : 4);
}

/**
 * The unit a piece of evidence belongs to.
 *
 * One possible owner settles it whatever the layout did, which is the case this design turns on.
 * Several owners fall back to where it sits, and then to where it was read.
 */
export function placeEvidence(snapshot: Snapshot, units: readonly UnitAnchor[], evidence: Span, tokens: readonly Token[]): Placement {
  const candidates = possible(snapshot, units, evidence);
  if (!candidates.length) return { unit: undefined, reason: "none", candidates: [] };
  if (candidates.length === 1) return { unit: candidates[0]!, reason: "only-owner", candidates };

  const positioned = tokens[evidence.from]?.box !== undefined && candidates.every((i) => tokens[units[i]!.span.from]?.box !== undefined);
  if (positioned) {
    let best = candidates[0]!;
    let least = Infinity;
    for (const i of candidates) {
      const d = distance(units[i]!.span, evidence, tokens);
      if (d < least) {
        least = d;
        best = i;
      }
    }
    return { unit: best, reason: "position", candidates };
  }

  // Nearest name in the stream, preferring one the evidence was written after.
  let best = candidates[0]!;
  let least = Infinity;
  for (const i of candidates) {
    const span = units[i]!.span;
    const gap = evidence.from >= span.to ? evidence.from - span.to : (span.from - evidence.to) * 4;
    if (gap < least) {
      least = gap;
      best = i;
    }
  }
  return { unit: best, reason: "stream", candidates };
}
