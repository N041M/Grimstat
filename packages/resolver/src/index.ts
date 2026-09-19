import type { Datasheet, Detachment, Diagnostic, Enhancement, PriceRule, Roster, RosterUnit, Snapshot } from "@grimstat/schema";
import { companionHostOf } from "./factions";

/**
 * Roster legality and costing. ONE module shared by UI, CLI and tests.
 * The resolver is generic: game-system plugins register constraint evaluators; this package
 * provides the runner, the costing helpers and the lookup context.
 */

export { compositionSegments, compositionPart, compositionParts, compositionLineBounds, compositionBranches, compositionBounds, profileBounds } from "./composition";
export type { CompositionPart, CompositionLineLike, ProfileBounds } from "./composition";
export { factionKeywordsOf, isOwnFaction, companionHostOf, companionsOf } from "./factions";

export interface RosterContext {
  roster: Roster;
  snapshot: Snapshot;
  datasheet(id: string): Datasheet | undefined;
  detachment(id: string): Detachment | undefined;
  enhancement(id: string): Enhancement | undefined;
  /** Units grouped by datasheet id in roster order. */
  copies(datasheetId: string): RosterUnit[];
  /** Cost breakdown per unit (points), computed once. */
  unitCost(unit: RosterUnit): UnitCost;
  totalPoints(): number;
}

export interface UnitCost {
  base: number;
  wargear: number;
  enhancement: number;
  total: number;
  /** 1-based index of this copy among units of the same datasheet. */
  copyIndex: number;
  modelCount: number;
  notes: string[];
}

export type ConstraintEvaluator = (ctx: RosterContext) => Diagnostic[];

export interface ConstraintSet {
  id: string;
  evaluators: Array<{ code: string; run: ConstraintEvaluator }>;
}

export function modelCountOf(unit: RosterUnit): number {
  return unit.models.reduce((s, m) => s + m.count, 0);
}

/** Stands in for an open-ended `copyRange.max`. */
const OPEN_ENDED = Number.MAX_SAFE_INTEGER;

function covers(rule: PriceRule, copyIndex: number): boolean {
  return rule.copyRange.min <= copyIndex && copyIndex <= (rule.copyRange.max ?? OPEN_ENDED);
}

function span(rule: PriceRule): number {
  return (rule.copyRange.max ?? OPEN_ENDED) - rule.copyRange.min;
}

/** The band that starts latest wins; among equal starts the narrower one does. "Your 3rd Unit Costs" beats an open "Your Unit Costs". */
function bySpecificity(a: PriceRule, b: PriceRule): number {
  return b.copyRange.min - a.copyRange.min || span(a) - span(b);
}

/** How many copies this one falls outside the band; 0 when the band covers it. */
function distanceTo(rule: PriceRule, copyIndex: number): number {
  if (covers(rule, copyIndex)) return 0;
  return copyIndex < rule.copyRange.min ? rule.copyRange.min - copyIndex : copyIndex - (rule.copyRange.max ?? OPEN_ENDED);
}

function bandText(rule: PriceRule): string {
  const { min, max } = rule.copyRange;
  if (max === undefined) return `${min}+`;
  return min === max ? `${min}` : `${min}-${max}`;
}

/**
 * The lookups a context needs from a snapshot, built once per snapshot rather than once per context.
 *
 * A context is asked for by unit as well as by army — `unitFromRosterUnit` makes one to cost the
 * unit it is resolving — so an army of twenty units used to index every datasheet, detachment,
 * enhancement and price rule in the game twenty times over.
 */
interface SnapshotIndex {
  ds: Map<string, Datasheet>;
  det: Map<string, Detachment>;
  enh: Map<string, Enhancement>;
  pricesByDatasheet: Map<string, PriceRule[]>;
}
const INDEXES = new WeakMap<Snapshot, SnapshotIndex>();

function indexOf(snapshot: Snapshot): SnapshotIndex {
  const cached = INDEXES.get(snapshot);
  if (cached) return cached;
  const pricesByDatasheet = new Map<string, PriceRule[]>();
  for (const r of snapshot.data.priceRules) pricesByDatasheet.set(r.datasheetId, [...(pricesByDatasheet.get(r.datasheetId) ?? []), r]);
  const index: SnapshotIndex = {
    ds: new Map(snapshot.data.datasheets.map((d) => [d.id, d] as const)),
    det: new Map(snapshot.data.detachments.map((d) => [d.id, d] as const)),
    enh: new Map(snapshot.data.enhancements.map((e) => [e.id, e] as const)),
    pricesByDatasheet,
  };
  INDEXES.set(snapshot, index);
  return index;
}

/** The context of the last army that asked, so the units of one army share one. */
const CONTEXTS = new WeakMap<Roster, { snapshot: Snapshot; ctx: RosterContext }>();

export function createContext(roster: Roster, snapshot: Snapshot): RosterContext {
  const held = CONTEXTS.get(roster);
  if (held && held.snapshot === snapshot) return held.ctx;
  const ctx = buildContext(roster, snapshot);
  CONTEXTS.set(roster, { snapshot, ctx });
  return ctx;
}

function buildContext(roster: Roster, snapshot: Snapshot): RosterContext {
  const { ds, det, enh, pricesByDatasheet } = indexOf(snapshot);
  const byDatasheet = new Map<string, RosterUnit[]>();
  for (const u of roster.units) byDatasheet.set(u.datasheetId, [...(byDatasheet.get(u.datasheetId) ?? []), u]);
  const costCache = new Map<string, UnitCost>();

  const unitCost = (unit: RosterUnit): UnitCost => {
    const cached = costCache.get(unit.id);
    if (cached) return cached;
    const notes: string[] = [];
    const sheet = ds.get(unit.datasheetId);
    const copies = byDatasheet.get(unit.datasheetId) ?? [];
    const copyIndex = Math.max(1, copies.findIndex((u) => u.id === unit.id) + 1);
    const modelCount = modelCountOf(unit);
    let base = 0;
    const rules = pricesByDatasheet.get(unit.datasheetId) ?? [];
    let rule = rules.filter((r) => covers(r, copyIndex)).sort(bySpecificity)[0];
    if (!rule && rules.length) {
      // Every band is closed and this copy falls outside all of them, so the nearest band stands in for it.
      rule = [...rules].sort((a, b) => distanceTo(a, copyIndex) - distanceTo(b, copyIndex) || bySpecificity(a, b))[0]!;
      notes.push(`No price band covers copy ${copyIndex}; used the band for copies ${bandText(rule)}.`);
    }
    if (rule) {
      const exact = rule.tiers.find((t) => t.models === modelCount);
      if (exact) base = exact.points;
      else {
        const below = rule.tiers.filter((t) => t.models <= modelCount).sort((a, b) => b.models - a.models)[0];
        const above = rule.tiers.slice().sort((a, b) => a.models - b.models)[0];
        const chosen = below ?? above;
        base = chosen?.points ?? 0;
        notes.push(`No price tier for ${modelCount} models; used the ${chosen?.models ?? "?"}-model tier.`);
      }
    } else if (sheet?.fallbackPoints !== undefined) {
      base = sheet.fallbackPoints;
      notes.push("Using fallback points (no price rule in snapshot).");
    } else if (!sheet || !companionHostOf(snapshot, sheet)) notes.push("No points found for this unit.");
    // A model that comes with another unit is paid for in that unit's points.
    let wargear = 0;
    const prices = snapshot.data.wargearPrices.filter((w) => w.datasheetId === unit.datasheetId);
    for (const m of unit.models) for (const item of m.wargear) {
      const p = prices.find((w) => w.item.toLowerCase() === item.toLowerCase());
      if (p) wargear += p.points * m.count;
    }
    let enhancement = 0;
    if (unit.enhancementId) enhancement = enh.get(unit.enhancementId)?.cost ?? 0;
    const cost: UnitCost = { base, wargear, enhancement, total: base + wargear + enhancement, copyIndex, modelCount, notes };
    costCache.set(unit.id, cost);
    return cost;
  };

  return {
    roster,
    snapshot,
    datasheet: (id) => ds.get(id),
    detachment: (id) => det.get(id),
    enhancement: (id) => enh.get(id),
    copies: (id) => byDatasheet.get(id) ?? [],
    unitCost,
    totalPoints: () => roster.units.reduce((s, u) => s + unitCost(u).total, 0),
  };
}

export function validateRoster(roster: Roster, snapshot: Snapshot, sets: ConstraintSet[]): Diagnostic[] {
  const ctx = createContext(roster, snapshot);
  const out: Diagnostic[] = [];
  for (const set of sets) for (const ev of set.evaluators) {
    try {
      out.push(...ev.run(ctx));
    } catch (e) {
      out.push({ severity: "error", code: `${ev.code}.crash`, message: `Constraint ${ev.code} failed: ${(e as Error).message}` });
    }
  }
  const order = { error: 0, warn: 1, info: 2 } as const;
  return out.sort((a, b) => order[a.severity] - order[b.severity] || a.code.localeCompare(b.code));
}

export function rosterSummary(roster: Roster, snapshot: Snapshot) {
  const ctx = createContext(roster, snapshot);
  return {
    points: ctx.totalPoints(),
    limit: roster.pointsLimit,
    units: roster.units.map((u) => ({ id: u.id, name: u.customName ?? ctx.datasheet(u.datasheetId)?.name ?? u.datasheetId, cost: ctx.unitCost(u) })),
    detachmentPoints: roster.detachments.reduce((s, d) => s + (ctx.detachment(d.detachmentId)?.dp ?? 0), 0),
  };
}
