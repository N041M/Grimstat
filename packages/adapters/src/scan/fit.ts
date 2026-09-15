/**
 * The army a token stream describes, and the questions left over.
 *
 * Most of a list settles itself. The names anchor, the numbers are a count or a cost because the
 * price table says so, and the wargear lands on the only unit that can carry it. What is left is a
 * handful of readings the data permits equally, and those are decided here by costing each one and
 * keeping the army that agrees with what was printed.
 *
 * Where two readings still score alike, this stops rather than choosing. A confident wrong answer
 * costs the reader more than an honest question, and the questions are part of the result rather
 * than a failure of it. A draft is always returned and is always saveable.
 */

import type { Datasheet, Roster, RosterUnit, Snapshot } from "@grimstat/schema";
import { createContext } from "@grimstat/resolver";
import { profileGroups } from "../roster/import-common";
import type { Span } from "./anchors";
import type { ArmyGuess } from "./army";
import { readArmy, sizeFor } from "./army";
import type { NameEntry, ScanIndex } from "./names";
import { matchName } from "./names";
import type { Multiplier } from "./numbers";
import { costAfter, costIndexAfter, modelsForCost, multipliersBefore, sizesOf } from "./numbers";
import { placeEvidence, type UnitAnchor } from "./own";
import type { Token } from "./tokens";

/** A name matched this poorly is worth asking about even though it was the best on offer. */
const UNSURE = 0.9;
/** How far the search is loosened when asking the reader which unit a name was. */
const WIDER = 0.55;
/** Units whose reading is open that the fit will try every combination of. */
const MAX_OPEN = 6;
/** Readings tried per open unit. */
const MAX_READINGS = 3;

export interface ScanUnit {
  readonly datasheetId: string;
  readonly name: string;
  /** How many models, as the fit settled it. */
  readonly models: number;
  readonly wargear: readonly string[];
  readonly enhancementId: string | undefined;
  /** The cost the list printed against this unit, when it printed one. */
  readonly printedCost: number | undefined;
  /** What the snapshot says it costs. */
  readonly computedCost: number;
  /** The words that were read, and how well they matched. */
  readonly text: string;
  readonly score: number;
  readonly alternatives: readonly NameEntry[];
}

export type Question =
  | { readonly id: string; readonly kind: "unit"; readonly asked: string; readonly at: number; readonly options: readonly { readonly id: string; readonly label: string }[] }
  | { readonly id: string; readonly kind: "models"; readonly asked: string; readonly at: number; readonly options: readonly number[] }
  | { readonly id: string; readonly kind: "faction"; readonly asked: string; readonly options: readonly { readonly id: string; readonly label: string }[] }
  | { readonly id: string; readonly kind: "detachment"; readonly asked: string; readonly options: readonly { readonly id: string; readonly label: string }[] }
  | { readonly id: string; readonly kind: "owner"; readonly asked: string; readonly options: readonly { readonly id: string; readonly label: string }[] };

/** What the reader has already said, keyed by question id. */
export type Answers = Readonly<Record<string, string>>;

export interface Draft {
  readonly roster: Roster;
  readonly units: readonly ScanUnit[];
  readonly army: ArmyGuess;
  readonly total: number;
  readonly questions: readonly Question[];
  /** Names that matched nothing in the loaded data, for the reader to place or ignore. */
  readonly unplaced: readonly string[];
}

export interface ScanOptions {
  readonly answers?: Answers;
  readonly name?: string;
}

/** One unit before its reading is chosen. */
interface Open {
  readonly span: Span;
  readonly ds: Datasheet;
  readonly readings: readonly Multiplier[];
  readonly printedCost: number | undefined;
  wargear: string[];
  enhancementId: string | undefined;
}

const label = (n: number, name: string): string => (n === 1 ? name : `${n} x ${name}`);

/** A roster carrying `units`, ready for the resolver to cost. */
function assemble(snapshot: Snapshot, factionId: string, units: readonly RosterUnit[], detachmentIds: readonly string[], forceDisposition: string | undefined, name: string, total: number): Roster {
  const now = new Date().toISOString();
  const { battleSize, pointsLimit } = sizeFor(total);
  return {
    id: "scan",
    ownerId: "local",
    createdAt: now,
    updatedAt: now,
    revision: 0,
    name,
    gameSystemId: snapshot.gameSystemId,
    snapshotId: snapshot.id,
    factionId,
    battleSize,
    pointsLimit,
    detachments: detachmentIds.map((detachmentId, i) => ({ id: `d${i + 1}`, detachmentId, ...(forceDisposition && i === 0 ? { forceDisposition } : {}) })),
    units: [...units],
  };
}

/** A name matched at least this well is a name, not a coincidence. */
const STRONG = 0.9;

/**
 * Whether the picture holds a list at all.
 *
 * Matching tolerates misspelling, which is what lets a photograph of a printed page be read, and the
 * same tolerance will find units in things that are not lists. A café menu offering garden squash
 * soup, spiced drake pie and an ashen crust flatbread matched a Warden Squad, a Spine Drake and an
 * Ashen Crusher at around eight tenths apiece, and produced a three-unit army out of a lunch.
 *
 * What tells the two apart is not the individual match but what sits around it. A real list names
 * its faction, or its detachment, or an enhancement, or it names at least one unit unmistakably.
 * Three names matched at eight tenths and nothing else is a coincidence, and a coincidence is worth
 * nothing to a reader: the units it produces look exactly like units that were really there.
 *
 * So a stream with no strong evidence anywhere in it yields no units, and the reader is told the
 * picture held no list rather than handed a plausible one.
 */
function corroborated(spans: readonly Span[]): boolean {
  return spans.some((s) => (s.entry.kind === "datasheet" && s.score >= STRONG) || s.entry.kind === "detachment" || s.entry.kind === "enhancement" || s.entry.kind === "faction");
}

/**
 * What can be added to a unit's base cost: its own paid wargear, and every enhancement.
 *
 * The same allowance `sizesOf` makes when it works out which totals a unit can be written down as,
 * needed here to read a printed total back into a model count.
 */
function extrasFor(snapshot: Snapshot, datasheetId: string): number[] {
  const out = new Set<number>([0]);
  for (const w of snapshot.data.wargearPrices) if (w.datasheetId === datasheetId && w.points > 0) out.add(w.points);
  for (const e of snapshot.data.enhancements) if (e.cost > 0) out.add(e.cost);
  return [...out];
}

/** The model count a datasheet is fielded at when the list did not say. */
const mins = (ds: Datasheet): number => {
  const sum = ds.composition.reduce((s, c) => s + (c.min ?? 0), 0);
  return sum > 0 ? sum : 1;
};

/** The units one choice of readings produces, and what they cost. */
function costOf(snapshot: Snapshot, open: readonly Open[], pick: readonly Multiplier[], factionId: string): { units: RosterUnit[]; perUnit: number[]; total: number } {
  const units: RosterUnit[] = [];
  for (let i = 0; i < open.length; i++) {
    const o = open[i]!;
    const m = pick[i]!;
    for (let copy = 0; copy < Math.max(1, m.copies); copy++) {
      const groups = profileGroups(o.ds, m.models ?? mins(o.ds));
      const unit: RosterUnit = { id: `u${units.length + 1}`, datasheetId: o.ds.id, models: groups, isWarlord: false };
      if (o.wargear.length && groups.length) groups[groups.length - 1]!.wargear = [...o.wargear];
      if (o.enhancementId) unit.enhancementId = o.enhancementId;
      units.push(unit);
    }
  }
  const roster = assemble(snapshot, factionId, units, [], undefined, "scan", 0);
  const ctx = createContext(roster, snapshot);
  const perUnit = units.map((u) => ctx.unitCost(u).total);
  return { units, perUnit, total: ctx.totalPoints() };
}

/**
 * How well a choice of readings matches what the list printed.
 *
 * A printed cost that agrees with the computed one is the strongest evidence there is, so it
 * dominates. A total landing just under a standard battle size is a weak confirmation and breaks
 * ties between readings the costs said nothing about.
 */
function scoreOf(open: readonly Open[], pick: readonly Multiplier[], perUnit: readonly number[], total: number): number {
  let score = 0;
  let at = 0;
  for (let i = 0; i < open.length; i++) {
    const o = open[i]!;
    const copies = Math.max(1, pick[i]!.copies);
    const cost = perUnit[at];
    at += copies;
    if (o.printedCost === undefined || cost === undefined) continue;
    score += o.printedCost === cost ? 10 : -10;
  }
  const { pointsLimit } = sizeFor(total);
  if (total > 0 && total / pointsLimit >= 0.9) score += 1;
  return score;
}

/** Every combination of the open readings, capped so an unusual list cannot make this expensive. */
function combinations(open: readonly Open[]): Multiplier[][] {
  const openAt = open.flatMap((o, i) => (o.readings.length > 1 ? [i] : []));
  const base = open.map((o) => o.readings[0]!);
  if (!openAt.length) return [base];
  const tried = openAt.slice(0, MAX_OPEN);
  let out: Multiplier[][] = [base];
  for (const i of tried) {
    const next: Multiplier[][] = [];
    for (const pick of out) {
      for (const reading of open[i]!.readings.slice(0, MAX_READINGS)) {
        const copy = [...pick];
        copy[i] = reading;
        if (!next.some((p) => p.every((m, j) => m === copy[j]))) next.push(copy);
      }
    }
    out = next;
  }
  return out;
}

/**
 * The army a stream describes.
 *
 * Answers are pinned before anything else runs, so answering one question re-runs the whole fit and
 * usually settles more than the one that was asked.
 */
export function scanList(snapshot: Snapshot, tokens: readonly Token[], options: ScanOptions = {}): Draft {
  const answers = options.answers ?? {};
  const { spans, army, index } = readArmy(snapshot, tokens);
  const sheets = new Map(snapshot.data.datasheets.map((d) => [d.id, d] as const));

  // A faction the reader chose overrules the vote, and every later step reads it from here.
  const chosenFaction = answers["faction"] ?? army.factionId;
  const unitSpans = corroborated(spans) ? spans.filter((s) => s.entry.kind === "datasheet") : [];
  /*
   * Units the snapshot can account for, in one list. `place` hands back indices into this, and the
   * readings below are read back by the same index, so the two must not be filtered apart.
   */
  const anchors: UnitAnchor[] = unitSpans
    .map((span, i) => ({ span, datasheetId: answers[`unit:${i}`] ?? span.entry.ids[0]! }))
    .filter((a) => sheets.has(a.datasheetId));

  const open: Open[] = anchors.map((a, i) => {
    const ds = sheets.get(a.datasheetId)!;
    const sizes = sizesOf(snapshot, ds.id);
    const answered = answers[`models:${i}`];
    const printedCost = costAfter(tokens, a.span.to, sizes);
    // The numbers in front of this name stop at the unit before it on the line, and at that unit's
    // cost. Three cards of a broadcast overlay read as one line otherwise leave each unit counted by
    // the price of the one to its left.
    const before = anchors[i - 1];
    const prev = before && before.span.to <= a.span.from ? before : undefined;
    const prevCost = prev ? costIndexAfter(tokens, prev.span.to, sizesOf(snapshot, prev.datasheetId)) : undefined;
    const floor = prev ? Math.max(prev.span.to, (prevCost ?? prev.span.to - 1) + 1) : 0;
    let readings = multipliersBefore(tokens, a.span.from, sizes, floor);
    /*
     * A count the picture lost, recovered from the cost it kept.
     *
     * The count sits at the start of a line where the bullet is and is one or two characters long,
     * so it is the first thing a picture loses. The cost is four characters in the clear. Where no
     * count was read and a cost was, the price table says which model counts cost that.
     */
    if (printedCost !== undefined && readings.every((r) => r.models === undefined)) {
      const fromCost = modelsForCost(sizes, printedCost, extrasFor(snapshot, a.datasheetId));
      if (fromCost.length) readings = fromCost.map((models) => ({ copies: readings[0]?.copies ?? 1, models, spare: [] }));
    }
    return {
      span: a.span,
      ds,
      readings: answered ? [{ copies: 1, models: Number(answered), spare: [] }] : readings,
      printedCost,
      wargear: [],
      enhancementId: undefined,
    };
  });

  // Wargear, model profiles and enhancements go to the unit that can own them.
  const unplaced: string[] = [];
  const owners = new Map<number, readonly number[]>();
  for (const span of spans) {
    if (span.entry.kind === "datasheet" || span.entry.kind === "detachment" || span.entry.kind === "disposition") continue;
    const placed = placeEvidence(snapshot, anchors, span, tokens);
    if (placed.unit === undefined) {
      if (span.entry.kind === "weapon" || span.entry.kind === "enhancement") unplaced.push(span.text);
      continue;
    }
    const owner = open[placed.unit];
    if (!owner) continue;
    if (span.entry.kind === "enhancement") owner.enhancementId ??= span.entry.ids[0];
    else if (span.entry.kind === "weapon") owner.wargear.push(span.entry.name);
    /*
     * Only worth asking about when the answer changes the army. Where the picture said which unit it
     * sat under, position is evidence and not a guess. Where the candidates are copies of one
     * datasheet, which squad of two identical squads carries a weapon barely matters and the roster
     * editor is the place to move it. Asking either way is how an importer ends up putting ten
     * questions in front of a reader and losing their patience before the first one.
     */
    const sameSheet = new Set(placed.candidates.map((c) => anchors[c]?.datasheetId)).size === 1;
    if (placed.reason === "stream" && placed.candidates.length > 1 && !sameSheet) owners.set(spans.indexOf(span), placed.candidates);
  }

  const factionId = chosenFaction ?? open[0]?.ds.factionId ?? snapshot.data.factions[0]?.id ?? "unknown";

  /*
   * Trying every reading is only worth the work when something can tell them apart. A printed cost
   * can. Without one the only thing left is the battle-size bonus, which is a guess about how people
   * build lists rather than evidence about this list, and on a misread count it guesses wrong: four
   * units of twenty came to 97% of a battle size and one unit of twenty came to 61%, so the bonus
   * preferred the misread. Each combination also costs a roster and a resolver context, and there
   * can be hundreds.
   */
  const printed = open.some((o) => o.printedCost !== undefined);
  const picks = printed ? combinations(open) : [open.map((o) => o.readings[0]!)];

  let best: { pick: Multiplier[]; units: RosterUnit[]; perUnit: number[]; total: number; score: number } | undefined;
  let runnerUp = -Infinity;
  for (const pick of picks) {
    const { units, perUnit, total } = costOf(snapshot, open, pick, factionId);
    const score = scoreOf(open, pick, perUnit, total);
    if (!best || score > best.score) {
      if (best) runnerUp = best.score;
      best = { pick, units, perUnit, total, score };
    } else if (score > runnerUp) runnerUp = score;
  }

  const pick = best?.pick ?? [];
  const units = best?.units ?? [];
  const total = best?.total ?? 0;
  const settled = best !== undefined && (open.every((o) => o.readings.length === 1) || best.score > runnerUp);

  const scanUnits: ScanUnit[] = [];
  let at = 0;
  for (let i = 0; i < open.length; i++) {
    const o = open[i]!;
    const m = pick[i] ?? { copies: 1, spare: [] };
    const copies = Math.max(1, m.copies);
    const models = m.models ?? mins(o.ds);
    for (let c = 0; c < copies; c++) {
      scanUnits.push({
        datasheetId: o.ds.id,
        name: o.ds.name,
        models,
        wargear: [...o.wargear],
        enhancementId: o.enhancementId,
        printedCost: o.printedCost,
        computedCost: best?.perUnit[at] ?? 0,
        text: o.span.text,
        score: o.span.score,
        alternatives: o.span.alternatives,
      });
      at++;
    }
  }

  const questions = ask(snapshot, index, open, army, chosenFaction, settled, answers, owners, spans, anchors);
  const roster = assemble(snapshot, factionId, units, army.detachmentIds, army.forceDisposition, options.name ?? nameFor(snapshot, factionId, army), total);
  return { roster, units: scanUnits, army: { ...army, factionId: chosenFaction }, total, questions, unplaced };
}

const nameFor = (snapshot: Snapshot, factionId: string, army: ArmyGuess): string => {
  const faction = snapshot.data.factions.find((f) => f.id === factionId)?.name;
  const det = snapshot.data.detachments.find((d) => d.id === army.detachmentIds[0])?.name;
  return [faction, det].filter(Boolean).join(" - ") || "Imported list";
};

/** What is left for the reader, most consequential first. */
function ask(
  snapshot: Snapshot,
  index: ScanIndex,
  open: readonly Open[],
  army: ArmyGuess,
  factionId: string | undefined,
  settled: boolean,
  answers: Answers,
  owners: ReadonlyMap<number, readonly number[]>,
  spans: readonly Span[],
  anchors: readonly UnitAnchor[],
): Question[] {
  const out: Question[] = [];
  const sheets = new Map(snapshot.data.datasheets.map((d) => [d.id, d] as const));

  /*
   * A unit that was the best match going and still not a good one.
   *
   * The options come from a second, looser search rather than from the alternatives the anchor pass
   * kept. That pass is deliberately strict, so an unsure match often arrives with nothing beside it,
   * and a question offering one answer is no question. Loosening it here costs a lookup and only
   * happens for the few names that were read badly.
   */
  open.forEach((o, i) => {
    if (answers[`unit:${i}`] || o.span.score >= UNSURE) return;
    const wider = matchName(index, o.span.text, { kinds: ["datasheet"], minScore: WIDER, limit: 4 });
    const options = [o.ds.id, ...wider.flatMap((m) => m.entry.ids)].flatMap((id) => {
      const ds = sheets.get(id);
      return ds ? [{ id: ds.id, label: ds.name }] : [];
    });
    const unique = options.filter((opt, at) => options.findIndex((o2) => o2.id === opt.id) === at);
    out.push({ id: `unit:${i}`, kind: "unit", asked: o.span.text, at: i, options: unique });
  });

  // A count the price table could not settle and the costs did not either.
  if (!settled) {
    open.forEach((o, i) => {
      if (answers[`models:${i}`] || o.readings.length < 2) return;
      const options = [...new Set(o.readings.map((r) => r.models ?? mins(o.ds)))];
      if (options.length < 2) return;
      out.push({ id: `models:${i}`, kind: "models", asked: label(Math.max(1, o.readings[0]!.copies), o.ds.name), at: i, options });
    });
  }

  if (!factionId && army.votes.length > 1) {
    out.push({ id: "faction", kind: "faction", asked: "", options: army.votes.map((v) => ({ id: v.factionId, label: `${v.name} (${v.units})` })) });
  }

  if (!army.detachmentIds.length && factionId) {
    const options = snapshot.data.detachments.filter((d) => d.factionId === factionId).map((d) => ({ id: d.id, label: d.name }));
    if (options.length) out.push({ id: "detachment", kind: "detachment", asked: "", options });
  }

  for (const [spanAt, candidates] of owners) {
    const span = spans[spanAt];
    if (!span || answers[`owner:${spanAt}`]) continue;
    out.push({
      id: `owner:${spanAt}`,
      kind: "owner",
      asked: span.entry.name,
      options: candidates.flatMap((c) => {
        const ds = sheets.get(anchors[c]?.datasheetId ?? "");
        return ds ? [{ id: String(c), label: ds.name }] : [];
      }),
    });
  }

  return out;
}
