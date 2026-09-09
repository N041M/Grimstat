import type { Datasheet, Detachment, Diagnostic, Enhancement, Roster, RosterUnit, Snapshot } from "@grimstat/schema";

/**
 * Roster legality and costing. ONE module shared by UI, CLI and tests.
 * The resolver is generic: game-system plugins register constraint evaluators; this package
 * provides the runner, the costing helpers and the lookup context.
 */

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

export function createContext(roster: Roster, snapshot: Snapshot): RosterContext {
  const ds = new Map(snapshot.data.datasheets.map((d) => [d.id, d] as const));
  const det = new Map(snapshot.data.detachments.map((d) => [d.id, d] as const));
  const enh = new Map(snapshot.data.enhancements.map((e) => [e.id, e] as const));
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
    const rules = snapshot.data.priceRules.filter((r) => r.datasheetId === unit.datasheetId);
    const rule = rules.find((r) => r.copyRange.min <= copyIndex && (r.copyRange.max === undefined || copyIndex <= r.copyRange.max)) ?? rules[0];
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
    } else notes.push("No points found for this unit.");
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
