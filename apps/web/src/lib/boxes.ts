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
import { nameIndexOf } from "@grimstat/adapters";
import { normaliseName } from "@grimstat/snapshot";
import { BOXES_URL, BoxFileSchema, type BoxLine, type BoxSet } from "../data/boxes";

/**
 * The words of a name that carry it, in a fixed order.
 *
 * Case, punctuation and the joiners the sources disagree about are noise, and so is a plural: an
 * announcement writes "a Broadside Battlesuit" where the datasheet is "Broadside Battlesuits", and
 * reporting that as a unit the player does not have would be a lie about their data. Both sides lose
 * the same trailing letter, so whatever it does to a word it does to both.
 */
const words = (s: string): string =>
  [...new Set(normaliseName(s).split(" ").filter((w) => w && w !== "of" && w !== "the").map((w) => w.replace(/s$/, "")))].sort().join(" ");

/** Two names for the same datasheet: the same spelling, or the same words whatever their order. */
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
  /**
   * Nothing in this snapshot goes by that name, so there is no datasheet to file it against and the
   * count is waiting on the reader to say what it is. Told apart from a line the box left open on
   * purpose, because the reason differs: one is a kit with choices, this is a name the data does
   * not carry.
   */
  readonly unknownName?: true;
  /**
   * The same unit on other armies' lists.
   *
   * A Rhino is a Rhino. Space Marines, Grey Knights, the Sisters and half a dozen others each field
   * one, and the rules give each of them their own sheet, so the shelf counts them apart even though
   * the model on it is the same plastic. A box settles which sheet its own Rhino is, and this says
   * who else fields one, so a reader who plays two armies can see why their Rhino is filed where it
   * is rather than wondering where it went.
   */
  readonly alsoIn: readonly Datasheet[];
  /**
   * The box left this one to its owner, so it is waiting for them to say what it is rather than
   * missing from the data. A screen has to tell the two apart: one asks the player a question, the
   * other tells them their snapshot is behind.
   */
  readonly needsName: boolean;
}

export interface ResolvedBox {
  readonly box: BoxSet;
  readonly lines: readonly ResolvedLine[];
  /** Lines whose unit this snapshot does not have, by the name the box gives them. */
  readonly unknown: readonly string[];
  /** Lines waiting for their owner to say what they are. */
  readonly toName: readonly ResolvedLine[];
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

/**
 * The edition the snapshot describes began in this year.
 *
 * A boxed set older than it is assumed to hold the model that has since been moved to Legends;
 * one from this edition, the model still in print. Written down here because it is the one fact
 * this reasoning needs and it changes once an edition, rather than being buried in a comparison.
 */
export const LEGENDS_FROM = "2026";

/** Is this box old enough that a name on both a Legends sheet and a live one means the Legends one? */
export function isOlderThanEdition(box: BoxSet, from: string = LEGENDS_FROM): boolean {
  // A box nobody could date is an old box: the ones without a recorded date are the old ones.
  return !box.announced || box.announced.slice(0, 4) < from;
}

/**
 * The datasheets of a snapshot, under the word key a name matches them by.
 *
 * Reading every box asks the same question of every datasheet over and over, and the answer depends
 * only on the two names. Asking it one pair at a time normalised each datasheet name once per line
 * — near two million times for this list against a full snapshot — and opening the box picker took
 * eleven seconds on a warm machine. A datasheet's key is the same whoever asks, so it is built once
 * and kept on the snapshot, the way `nameIndexOf` keeps its own.
 */
const WORD_KEYS = new WeakMap<Snapshot, ReadonlyMap<string, readonly Datasheet[]>>();
function byWordKey(snapshot: Snapshot): ReadonlyMap<string, readonly Datasheet[]> {
  const cached = WORD_KEYS.get(snapshot);
  if (cached) return cached;
  const map = new Map<string, Datasheet[]>();
  // Walked in index order, so a line's candidates arrive in the order a scan of it would have found
  // them, and the faction a tie falls to does not change.
  for (const { ds } of nameIndexOf(snapshot).names) {
    const key = words(ds.name);
    const at = map.get(key);
    if (at) at.push(ds);
    else map.set(key, [ds]);
  }
  WORD_KEYS.set(snapshot, map);
  return map;
}

/**
 * Every datasheet in the snapshot that goes by this name, in whatever faction.
 *
 * Two names match on the same spelling or on the same words, and the same spelling carries the same
 * words, so the word key finds both kinds at once. A name with no words of its own — nothing but
 * the joiners `words` drops — has only the strict match left, which is the index's own name key.
 */
function candidates(snapshot: Snapshot, name: string): readonly Datasheet[] {
  const key = words(name);
  if (key === "") return nameIndexOf(snapshot).dsByKey.get(normaliseName(name)) ?? [];
  return byWordKey(snapshot).get(key) ?? [];
}

/**
 * Read a box against a snapshot: which datasheets its lines name, and how many models each brings.
 *
 * The same unit name often sits in more than one faction's list — Legionaries and Havocs are on both
 * the Chaos Space Marines and the Chaos Daemons sheets — so a line read on its own picks a faction
 * by accident. An Iron Warriors box filed its Legionaries under Daemons that way, and the army tick
 * a player uses to split a box would have offered them the wrong army to tick.
 *
 * So the box is read as a whole first. Each faction is scored by how many of the box's lines it
 * could account for, and every line then takes the candidate from the best-scoring faction that
 * offers it. A box of one army resolves to that army, because it is the only one that explains all
 * of the lines; a line that exists in no other faction still resolves to its own.
 */
export function resolveBox(box: BoxSet, snapshot: Snapshot): ResolvedBox {
  const named = box.lines.map((line) => (line.ownerNames ? [] : candidates(snapshot, line.name)));
  const score = new Map<string, number>();
  for (const cands of named) {
    for (const id of new Set(cands.map((d) => d.factionId))) score.set(id, (score.get(id) ?? 0) + 1);
  }
  // A box older than the edition in hand is assumed to hold the Legends model; one from this
  // edition, the live one. See LEGENDS_FROM.
  const old = isOlderThanEdition(box);

  /**
   * Which sheet a name belongs to when several carry it.
   *
   * The army the box is for comes first: that is what reading the box as a whole settles. Between a
   * Legends sheet and a live one of the same name, the box's age decides. A unit moved to Legends
   * is the unit that came in an older box, and the live sheet of that name is usually the kit that
   * replaced it, so an old box assumes Legends and a current one assumes live. Five names in a full
   * snapshot are carried by both — a Venerable Dreadnought among them — and without this the choice
   * was whichever the data happened to list first.
   *
   * It is only ever an assumption. The sheet not taken is offered beside it, because the person who
   * owns the model is the one who knows which of the two is in their hand.
   */
  const best = (cands: readonly Datasheet[]): Datasheet | undefined =>
    [...cands].sort(
      (a, b) =>
        (score.get(b.factionId) ?? 0) - (score.get(a.factionId) ?? 0) ||
        (old ? Number(!!b.isLegends) - Number(!!a.isLegends) : Number(!!a.isLegends) - Number(!!b.isLegends)),
    )[0];

  const lines: ResolvedLine[] = [];
  const unknown: string[] = [];
  const factionIds: string[] = [];
  let models = 0;
  box.lines.forEach((line, i) => {
    // Nothing to look up for a line the box leaves to its owner: the models are real, the datasheet
    // is a question, and guessing one from the word on the sprue is how drones become the wrong unit.
    if (line.ownerNames) {
      lines.push({ line, models: line.models ?? 0, alternatives: [], alsoIn: [], needsName: true });
      return;
    }
    // A name this snapshot carries under neither a Legends sheet nor a live one is the reader's to
    // place. Saying "not in your data" and stopping leaves them holding models and no way to count
    // them; asking them which sheet it is leaves them somewhere to put it.
    if (!named[i]!.length) {
      unknown.push(line.name);
      lines.push({ line, models: line.models ?? 0, alternatives: [], alsoIn: [], needsName: true, unknownName: true });
      return;
    }
    const ds = best(named[i]!);
    const alternatives = (line.or ?? []).map((n) => best(candidates(snapshot, n))).filter((d): d is Datasheet => !!d);
    // The same name under both a Legends sheet and a live one: whichever the age did not pick is
    // offered beside it rather than dropped, since only the owner knows which model they have.
    const twin = ds ? named[i]!.find((c) => c.id !== ds.id && c.factionId === ds.factionId && !!c.isLegends !== !!ds.isLegends) : undefined;
    if (twin) alternatives.push(twin);
    // One sheet per faction among the rest: a dozen Chapters' worth of the same Rhino is a fact
    // about the rules, not something a reader needs listed a dozen times.
    const alsoIn = ds ? named[i]!.filter((d) => d.factionId !== ds.factionId).filter((d, j, all) => all.findIndex((o) => o.factionId === d.factionId) === j) : [];
    const n = ds ? (line.models ?? (line.units ?? 1) * unitSize(ds)) : (line.models ?? 0);
    if (ds && !factionIds.includes(ds.factionId)) factionIds.push(ds.factionId);
    lines.push({ line, ...(ds ? { ds } : {}), models: n, alternatives, alsoIn, needsName: false });
    if (ds) models += n;
  });
  return { box, lines, unknown, toName: lines.filter((l) => l.needsName), factionIds, models };
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

/**
 * Boxes a snapshot can actually place, newest first: at least one line of the box names a datasheet
 * it has. A reader looking for the box they just bought is looking at this year's, and one looking
 * for a box from years back knows roughly when it was.
 */
export function boxesFor(boxes: readonly BoxSet[], snapshot: Snapshot): readonly ResolvedBox[] {
  // An undated box sorts last whichever way the dated ones run, since there is no year to put it
  // beside and the reader is looking for this year's box at the top.
  const when = (r: ResolvedBox): string => r.box.announced ?? "";
  return boxes
    .map((b) => resolveBox(b, snapshot))
    .filter((r) => r.lines.some((l) => l.ds))
    .sort((a, b) => (when(a) < when(b) ? 1 : when(a) > when(b) ? -1 : a.box.name.localeCompare(b.box.name)));
}

/** The year a box belongs under, or nothing when its date was never established. */
export function yearOf(box: BoxSet): string | undefined {
  return box.announced?.slice(0, 4);
}

/** Boxes under the year they were announced in, newest year first, undated ones last. */
export function boxesByYear(boxes: readonly ResolvedBox[]): readonly { year?: string; boxes: readonly ResolvedBox[] }[] {
  const years: { year?: string; boxes: ResolvedBox[] }[] = [];
  for (const b of boxes) {
    const year = yearOf(b.box);
    const group = years.find((g) => g.year === year) ?? (years.push({ ...(year ? { year } : {}), boxes: [] }), years[years.length - 1]!);
    group.boxes.push(b);
  }
  return years;
}

/**
 * What a set of lines adds, summed per datasheet.
 *
 * A box can name the same unit twice — two squads of the same troops, a character that comes in two
 * of its halves — and the shelf counts one number per datasheet. Handing the lines to the shelf one
 * at a time would read the record it is adding to once and write each line against that same
 * reading, so the last line would land and the ones before it would be lost. Summing first is what
 * makes "add this box" mean all of it.
 */
export function modelsByDatasheet(lines: readonly ResolvedLine[]): ReadonlyMap<string, { ds: Datasheet; models: number }> {
  const out = new Map<string, { ds: Datasheet; models: number }>();
  for (const l of lines) {
    if (!l.ds || l.models <= 0) continue;
    const had = out.get(l.ds.id);
    out.set(l.ds.id, { ds: l.ds, models: (had?.models ?? 0) + l.models });
  }
  return out;
}

/**
 * A line the player has labelled, ready to go on the shelf beside the rest.
 *
 * The models come from the box and the datasheet from them, so the count is not theirs to invent:
 * eight drones are eight drones however they were built, and the choice is only which sheet they
 * are counted against.
 */
export function nameLine(line: ResolvedLine, ds: Datasheet): ResolvedLine {
  return { ...line, ds, needsName: false, alternatives: [], alsoIn: [] };
}

/**
 * The list of boxes, read from the file it lives in.
 *
 * Fetched once and kept, because it does not change while the app is open and every screen that
 * wants it wants the same list. A file that will not parse gives an empty list rather than a broken
 * screen: the boxes are a convenience on a page that works without them, and a reader who came to
 * count their models should not lose the page to a stray comma in a data file.
 */
let pending: Promise<readonly BoxSet[]> | undefined;

export function loadBoxSets(fetcher: typeof fetch = fetch): Promise<readonly BoxSet[]> {
  pending ??= fetcher(BOXES_URL)
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${r.status} for ${BOXES_URL}`))))
    .then((raw) => BoxFileSchema.parse(raw).boxes as readonly BoxSet[])
    .catch((e) => {
      console.error("Could not read the list of boxes", e);
      return [];
    });
  return pending;
}

/** Forget the list that was read, so the next call reads it again. For tests. */
export function forgetBoxSets(): void {
  pending = undefined;
}
