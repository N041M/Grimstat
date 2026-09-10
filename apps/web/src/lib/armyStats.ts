import type { Datasheet, Roster, RosterUnit } from "@grimstat/schema";
import type { UnitCost } from "@grimstat/resolver";
import { modelCountOf, sectionOf, unitDisplayName, type UnitSection } from "./roster";
import { BAR_ORDER, pointsBarModel, type SegmentTone } from "./pointsBar";

/**
 * Pure aggregation behind Armies → Statistics: what the army *is*, before anything is simulated.
 *
 * Everything here is derived from the roster plus the snapshot's datasheets and the resolver's
 * costing; no worker, no DOM, no storage. The simulated numbers (damage, durability) are joined on
 * top of these rows by `useArmyStats`.
 *
 * Two different foldings are used on purpose, and both are correct:
 *  - the **unit rows** fold an attached character into its host, because that is one unit on the
 *    table (and the same folding the units list and `unitFromRosterUnit` use);
 *  - the **role split** counts every roster entry under its own role, because that is what the
 *    header's points bar shows — so the two totals always agree.
 */

export interface ArmyUnitRow {
  /** Host unit id: what the units list selects when the row is clicked. */
  id: string;
  name: string;
  section: UnitSection;
  /** The datasheet's own role text when the data has one; the screen falls back to the section. */
  role: string;
  models: number;
  wounds: number;
  /** Objective Control, summed over models; profiles without an OC value count as 0. */
  oc: number;
  points: number;
  /** Roster unit ids folded into this row, host first. */
  memberIds: string[];
}

export interface ArmyRoleRow {
  section: UnitSection;
  tone: SegmentTone;
  units: number;
  models: number;
  points: number;
  /** Share of the army's points, 0..1. */
  share: number;
}

export interface KeywordCount {
  name: string;
  /** Roster entries whose datasheet carries the keyword. */
  count: number;
}

export interface ArmyComposition {
  rows: ArmyUnitRow[];
  roles: ArmyRoleRow[];
  /** Units on the table (attached characters folded into their host). */
  units: number;
  models: number;
  wounds: number;
  oc: number;
  /** Points used; identical to the header points bar's total. */
  points: number;
  limit: number;
  spare: number;
  over: number;
  /** 0 when the army has no models. */
  pointsPerModel: number;
  factionKeywords: KeywordCount[];
  unitKeywords: KeywordCount[];
}

/** Models / wounds / OC of one roster entry, read off the datasheet's model profiles. */
function profileTotals(unit: RosterUnit, ds: Datasheet | undefined): { models: number; wounds: number; oc: number } {
  const byId = new Map((ds?.models ?? []).map((m) => [m.id, m] as const));
  let models = 0;
  let wounds = 0;
  let oc = 0;
  for (const g of unit.models) {
    models += g.count;
    // A group whose profile is missing (hand-edited data) falls back to the first profile.
    const p = byId.get(g.modelProfileId) ?? ds?.models[0];
    wounds += g.count * (p?.W ?? 0);
    oc += g.count * (p?.OC ?? 0);
  }
  return { models, wounds, oc };
}

/** Trimmed, uppercased, de-duplicated keywords of one datasheet. */
function keywordsOf(list: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list) {
    const name = raw.trim().toUpperCase();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

/** Busiest keyword first; ties alphabetical, so the chip rows are stable between renders. */
function tally(counts: Map<string, number>): KeywordCount[] {
  return [...counts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/**
 * Describe an army: per-unit rows, the points-by-role split, the headline totals and the keywords
 * present in the list.
 *
 * `costById` is the resolver's per-unit costing keyed by roster unit id; a unit missing from it
 * counts as 0 points, exactly as the units list shows it.
 */
export function armyComposition(roster: Roster, datasheets: Map<string, Datasheet>, costById: Map<string, UnitCost>): ArmyComposition {
  const byId = new Map(roster.units.map((u) => [u.id, u] as const));
  const pointsOf = (u: RosterUnit) => costById.get(u.id)?.total ?? 0;

  // ---- unit rows: top-level units in section order, attached characters folded in ----
  const attachedByHost = new Map<string, RosterUnit[]>();
  const top: RosterUnit[] = [];
  for (const u of roster.units) {
    const hostId = u.attachedTo?.unitId;
    if (hostId && byId.has(hostId) && hostId !== u.id) attachedByHost.set(hostId, [...(attachedByHost.get(hostId) ?? []), u]);
    else top.push(u);
  }

  const rows: ArmyUnitRow[] = [];
  for (const section of ["character", "battleline", "transport", "other", "allied"] as UnitSection[]) {
    for (const host of top) {
      const ds = datasheets.get(host.datasheetId);
      if (sectionOf(ds, roster) !== section) continue;
      const members = [host, ...(attachedByHost.get(host.id) ?? [])];
      let models = 0;
      let wounds = 0;
      let oc = 0;
      let points = 0;
      for (const m of members) {
        const totals = profileTotals(m, datasheets.get(m.datasheetId));
        models += totals.models;
        wounds += totals.wounds;
        oc += totals.oc;
        points += pointsOf(m);
      }
      rows.push({ id: host.id, name: unitDisplayName(host, ds), section, role: ds?.role?.trim() ?? "", models, wounds, oc, points, memberIds: members.map((m) => m.id) });
    }
  }

  // ---- role split: every entry under its own role, so the total matches the header bar ----
  const bar = pointsBarModel(
    roster.units.map((u) => ({ section: sectionOf(datasheets.get(u.datasheetId), roster), points: pointsOf(u) })),
    roster.pointsLimit,
  );
  const agg = new Map<UnitSection, { units: number; models: number; points: number }>();
  for (const u of roster.units) {
    const section = sectionOf(datasheets.get(u.datasheetId), roster);
    const cur = agg.get(section) ?? { units: 0, models: 0, points: 0 };
    cur.units += 1;
    cur.models += modelCountOf(u);
    cur.points += pointsOf(u);
    agg.set(section, cur);
  }
  // A role with units but no points still gets a row (the bar model drops zero-width segments).
  const roles: ArmyRoleRow[] = [];
  for (const { section, tone } of BAR_ORDER) {
    const a = agg.get(section);
    if (!a || a.units === 0) continue;
    roles.push({ section, tone, units: a.units, models: a.models, points: a.points, share: bar.total > 0 ? a.points / bar.total : 0 });
  }

  // ---- headline totals ----
  const models = rows.reduce((s, r) => s + r.models, 0);
  const wounds = rows.reduce((s, r) => s + r.wounds, 0);
  const oc = rows.reduce((s, r) => s + r.oc, 0);

  // ---- keywords ----
  const faction = new Map<string, number>();
  const unit = new Map<string, number>();
  for (const u of roster.units) {
    const ds = datasheets.get(u.datasheetId);
    if (!ds) continue;
    for (const k of keywordsOf(ds.factionKeywords)) faction.set(k, (faction.get(k) ?? 0) + 1);
    for (const k of keywordsOf(ds.keywords)) unit.set(k, (unit.get(k) ?? 0) + 1);
  }

  return {
    rows,
    roles,
    units: rows.length,
    models,
    wounds,
    oc,
    points: bar.total,
    limit: bar.limit,
    spare: bar.spare,
    over: bar.over,
    pointsPerModel: models > 0 ? bar.total / models : 0,
    factionKeywords: tally(faction),
    unitKeywords: tally(unit),
  };
}

// ---------- sorting ----------

export type StatSortCol = "unit" | "points" | "models" | "wounds" | "oc" | "damage" | "durability" | "effective" | "trade";
export type SortDir = "asc" | "desc";
export interface StatSort {
  col: StatSortCol;
  dir: SortDir;
}

/** A composition row joined with whatever the worker has returned so far. */
export interface ArmyStatRow extends ArmyUnitRow {
  /** Expected damage per 100 points against the chosen target; undefined until the worker answers. */
  damagePer100: number | undefined;
  /** Points of shooting needed to remove the unit; undefined until the worker answers. */
  durability: number | undefined;
  /** Reference attacks expected to remove the unit; undefined until the worker answers. */
  effectiveWounds: number | undefined;
  /** Enemy points destroyed in one round against the chosen target, per point of the unit's own cost. */
  trade: number | undefined;
}

function valueOf(row: ArmyStatRow, col: StatSortCol): number | string | undefined {
  switch (col) {
    case "unit":
      return row.name.toLowerCase();
    case "points":
      return row.points;
    case "models":
      return row.models;
    case "wounds":
      return row.wounds;
    case "oc":
      return row.oc;
    case "damage":
      return row.damagePer100;
    case "durability":
      return row.durability;
    case "effective":
      return row.effectiveWounds;
    case "trade":
      return row.trade;
  }
}

/**
 * Compare two rows of the details table. Rows the worker has not answered for yet sort last in both
 * directions — a pending row must never head a "toughest first" ordering — and ties break on the
 * unit name so the order stays stable while results stream in.
 */
export function compareStatRows(a: ArmyStatRow, b: ArmyStatRow, sort: StatSort): number {
  const va = valueOf(a, sort.col);
  const vb = valueOf(b, sort.col);
  const missing = (v: number | string | undefined) => v === undefined || (typeof v === "number" && Number.isNaN(v));
  if (missing(va) || missing(vb)) {
    if (missing(va) && missing(vb)) return a.name.localeCompare(b.name);
    return missing(va) ? 1 : -1;
  }
  const dir = sort.dir === "asc" ? 1 : -1;
  const cmp = typeof va === "string" || typeof vb === "string" ? String(va).localeCompare(String(vb)) : (va as number) - (vb as number);
  return cmp !== 0 ? cmp * dir : a.name.localeCompare(b.name);
}

/** Sorted copy; the input array is untouched. */
export function sortStatRows(rows: ArmyStatRow[], sort: StatSort): ArmyStatRow[] {
  return [...rows].sort((a, b) => compareStatRows(a, b, sort));
}


// ---------- casualty curve ----------

/**
 * Attacker-point levels the casualty curve is sampled at — roughly "a quarter of a list" up to
 * "a whole list of shooting".
 */
export const CASUALTY_LEVELS = [250, 500, 750, 1000, 1500, 2000] as const;

/** What the curve needs to know about one unit: its size and how fast it comes apart. */
export interface CasualtyUnit {
  points: number;
  models: number;
  wounds: number;
  /** Wounds removed per 100 attacker points (the slope of `incomingFire`). */
  woundsPer100: number;
  /** Models removed per 100 attacker points. */
  slainPer100: number;
}

export interface CasualtyPoint {
  attackerPoints: number;
  woundsLost: number;
  modelsLost: number;
  /** 0..1 of the measured army's wounds / models. */
  woundsFraction: number;
  modelsFraction: number;
}

/**
 * The army under `attackerPoints` of incoming fire.
 *
 * The incoming points are split across the units in proportion to their own points — an even
 * spread over the list rather than focused fire — and each unit loses wounds and models at its own
 * measured rate, capped at what it has. Denominators are the units passed in, so a curve built
 * while the worker is still solving describes the part of the army that has answers rather than
 * pretending the rest is unhurt.
 */
export function casualtyAt(units: CasualtyUnit[], attackerPoints: number): CasualtyPoint {
  const totalWounds = units.reduce((s, u) => s + u.wounds, 0);
  const totalModels = units.reduce((s, u) => s + u.models, 0);
  const totalPoints = units.reduce((s, u) => s + u.points, 0);
  let woundsLost = 0;
  let modelsLost = 0;
  for (const u of units) {
    // A unit with no points value (or an army with none at all) takes an equal share instead.
    const share = totalPoints > 0 ? u.points / totalPoints : units.length > 0 ? 1 / units.length : 0;
    const incoming = Math.max(0, attackerPoints) * share;
    woundsLost += Math.min(u.wounds, (incoming * u.woundsPer100) / 100);
    modelsLost += Math.min(u.models, (incoming * u.slainPer100) / 100);
  }
  return {
    attackerPoints,
    woundsLost,
    modelsLost,
    woundsFraction: totalWounds > 0 ? woundsLost / totalWounds : 0,
    modelsFraction: totalModels > 0 ? modelsLost / totalModels : 0,
  };
}

/** The curve, sampled at each level. */
export function casualtyCurve(units: CasualtyUnit[], levels: readonly number[] = CASUALTY_LEVELS): CasualtyPoint[] {
  return levels.map((p) => casualtyAt(units, p));
}

/**
 * Attacker points at which the army has lost `fraction` of its wounds. The loss function is
 * piecewise linear and never decreases, so a doubling search for an upper bound followed by
 * bisection lands on the exact knee; Infinity when the army cannot be hurt that far at all.
 */
export function pointsForLoss(units: CasualtyUnit[], fraction = 0.5): number {
  if (units.length === 0) return Number.POSITIVE_INFINITY;
  const target = Math.max(0, Math.min(1, fraction));
  if (target <= 0) return 0;
  let hi = 100;
  while (casualtyAt(units, hi).woundsFraction < target) {
    hi *= 2;
    if (hi > 1e7) return Number.POSITIVE_INFINITY;
  }
  let lo = 0;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (casualtyAt(units, mid).woundsFraction < target) lo = mid;
    else hi = mid;
  }
  return hi;
}

// ---------- threat saturation ----------

/** A unit can remove the target on its own when it kills it at least this often. */
export const SOLO_THRESHOLD = 0.5;
/** Units are combined until they remove the target at least this often. */
export const JOINT_THRESHOLD = 0.9;

/** One row of `reverseMathhammer`, reduced to what the saturation summary needs. */
export interface SaturationCandidate {
  candidateIds: string[];
  names: string[];
  points: number;
  pKill: number;
}

export interface SaturationSummary {
  /** Names of the units that reach `solo` on their own, cheapest first. */
  soloNames: string[];
  /** How many units the cheapest combination reaching `joint` uses; undefined when none does. */
  needed: number | undefined;
  cheapestNames: string[];
  cheapestPoints: number | undefined;
  cheapestPKill: number | undefined;
}

/**
 * Reduce every combination the reverse search tried to the three facts the row shows: who can do it
 * alone, how many are needed together, and the cheapest such group. "Cheapest" is fewest points,
 * then fewest units, then the surest kill — so a cheaper pair beats a pricier single.
 */
export function summariseSaturation(rows: SaturationCandidate[], solo = SOLO_THRESHOLD, joint = JOINT_THRESHOLD): SaturationSummary {
  const eps = 1e-9;
  const soloRows = rows.filter((r) => r.candidateIds.length === 1 && r.pKill >= solo - eps).sort((a, b) => a.points - b.points || b.pKill - a.pKill);
  const meets = rows.filter((r) => r.pKill >= joint - eps).sort((a, b) => a.points - b.points || a.candidateIds.length - b.candidateIds.length || b.pKill - a.pKill);
  const best = meets[0];
  return {
    soloNames: soloRows.map((r) => r.names[0] ?? ""),
    needed: best?.candidateIds.length,
    cheapestNames: best?.names ?? [],
    cheapestPoints: best?.points,
    cheapestPKill: best?.pKill,
  };
}
