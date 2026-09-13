/**
 * Reading a boxed set against the snapshot that is loaded, so its contents can go on the shelf.
 *
 * A box lists what it holds in the publisher's words, which are the words on the datasheets but not
 * always the words in a given snapshot: an older snapshot may not carry a unit yet, a newer one may
 * have renamed it, and a box for one game system says nothing to a snapshot of another. So every
 * line is matched by name at the moment it is read, and a line that matches nothing is reported
 * rather than dropped. A player adding a box should be told that one of its six units is not in
 * their data, not quietly given five.
 *
 * The roster importer finds the candidates, since it already turns the names in a written army list
 * into datasheets. Its last resort is containment, which is right for a list somebody typed — a line
 * reading "Wardens of the Ashen Crusher" means the Ashen Crusher — and wrong here: a box line
 * reading "Captain" took the only sheet containing the word, which in one snapshot was a Warden
 * Captain, and put ten models on a datasheet nobody bought. So a candidate is kept only when it is
 * the same name: equal once normalised, or the same words in a different order. The names in this
 * list are ours to write, so they can be written in full, and a line that matches nothing says so.
 */

import type { Datasheet, Snapshot } from "@grimstat/schema";
import { RosterImportContext } from "@grimstat/adapters";
import { normaliseName } from "@grimstat/snapshot";
import type { BoxLine, BoxSet } from "../data/boxes";

/** The words of a name that carry it, in a fixed order: case, punctuation and joiners are noise. */
const words = (s: string): string =>
  [...new Set(normaliseName(s).split(" ").filter((w) => w && w !== "of" && w !== "the"))].sort().join(" ");

/** Two names for the same datasheet: the same spelling, or the same words in another order. */
export function sameUnitName(a: string, b: string): boolean {
  return normaliseName(a) === normaliseName(b) || (words(a) !== "" && words(a) === words(b));
}

export interface ResolvedLine {
  readonly line: BoxLine;
  /** The datasheet the line names, when the snapshot has it. */
  readonly ds?: Datasheet;
  /** Models the line adds: its own count, or the datasheet's unit size where it counts units. */
  readonly models: number;
  /** The datasheets the line's kit could have been built as instead, that this snapshot knows. */
  readonly alternatives: readonly Datasheet[];
}

export interface ResolvedBox {
  readonly box: BoxSet;
  readonly lines: readonly ResolvedLine[];
  /** Lines whose unit this snapshot does not have, by the name the box gives them. */
  readonly unknown: readonly string[];
  /** Faction ids the box touches, in the order its lines first reach them. */
  readonly factionIds: readonly string[];
  readonly models: number;
}

/**
 * How many models one unit of a datasheet is.
 *
 * The composition minimums, which is how the rest of the app reads a unit's default size. A sheet
 * that states none is a single model, which is what every character sheet is.
 */
export function unitSize(ds: Datasheet): number {
  const mins = ds.composition.map((c) => c.min).filter((m): m is number => typeof m === "number" && m > 0);
  if (mins.length) return mins.reduce((s, m) => s + m, 0);
  return Math.max(1, ds.models.length > 1 ? ds.models.length : 1);
}

/** The datasheet a box line names, or nothing when this snapshot has no sheet by that name. */
function named(ctx: RosterImportContext, name: string): Datasheet | undefined {
  const hit = ctx.matchDatasheet(name);
  return hit && sameUnitName(hit.name, name) ? hit : undefined;
}

/** Read a box against a snapshot: which datasheets its lines name, and how many models each brings. */
export function resolveBox(box: BoxSet, snapshot: Snapshot): ResolvedBox {
  const ctx = new RosterImportContext(snapshot);
  const lines: ResolvedLine[] = [];
  const unknown: string[] = [];
  const factionIds: string[] = [];
  let models = 0;
  for (const line of box.lines) {
    const ds = named(ctx, line.name);
    const alternatives = (line.or ?? []).map((n) => named(ctx, n)).filter((d): d is Datasheet => !!d);
    const n = ds ? (line.models ?? (line.units ?? 1) * unitSize(ds)) : (line.models ?? 0);
    if (!ds) unknown.push(line.name);
    else if (!factionIds.includes(ds.factionId)) factionIds.push(ds.factionId);
    lines.push({ line, ...(ds ? { ds } : {}), models: n, alternatives });
    if (ds) models += n;
  }
  return { box, lines, unknown, factionIds, models };
}

/**
 * The lines of a read box that belong to the factions the player has ticked.
 *
 * A box holding two armies is the reason this exists: somebody who bought one to split with a
 * friend owns half of it, and adding the other half would put models on their shelf that are on
 * somebody else's. Lines whose unit is not in the snapshot are left out, since there is nothing to
 * count them against.
 */
export function linesForFactions(read: ResolvedBox, factionIds: readonly string[]): readonly ResolvedLine[] {
  return read.lines.filter((l) => l.ds && factionIds.includes(l.ds.factionId) && l.models > 0);
}

/** Boxes a snapshot can actually place: at least one line of the box names a datasheet it has. */
export function boxesFor(boxes: readonly BoxSet[], snapshot: Snapshot): readonly ResolvedBox[] {
  return boxes.map((b) => resolveBox(b, snapshot)).filter((r) => r.lines.some((l) => l.ds));
}
