import type { Scenario, ScenarioContext, ScenarioModel, ScenarioUnit, SimResult, Snapshot } from "@grimstat/schema";
import { archetypes } from "./archetypes";
import { hitGate, pUnsaved, woundGate, woundTarget } from "./attack";
import { runScenario } from "./scenario";

const now = () => new Date().toISOString();

export function makeScenario(attacker: ScenarioUnit, defender: ScenarioUnit, context: Partial<ScenarioContext> = {}, enabledToggles: string[] = [], gameSystemId = "wh40k-11e"): Scenario {
  return {
    id: "adhoc",
    ownerId: "local",
    createdAt: now(),
    updatedAt: now(),
    revision: 0,
    name: `${attacker.name} vs ${defender.name}`,
    gameSystemId,
    attacker,
    defender,
    context: {
      rangeBand: "full",
      charged: false,
      stationary: false,
      inCover: false,
      snapShooting: false,
      phase: "shooting",
      flags: [],
      allocationPolicy: "protect-character",
      lethalChoice: "auto",
      weaponOrder: "heuristic",
      mcIterations: 10000,
      backend: "auto",
      ...context,
    },
    enabledToggles,
    extraEffects: [],
  };
}

export interface MatrixCell {
  attacker: string;
  defender: string;
  result: SimResult;
  attackerPoints?: number | undefined;
  defenderPoints?: number | undefined;
  /** Expected damage per 100 attacker points, when known. */
  damagePer100?: number;
  /** Expected defender points destroyed per 100 attacker points, when known. */
  pointsTradePer100?: number;
}

export interface MatrixResult {
  attackers: string[];
  defenders: string[];
  cells: MatrixCell[][]; // [attackerIndex][defenderIndex]
}

/**
 * Resolve an attacker in the phase where it can actually fight.
 *
 * A unit with no weapon for the requested phase would score a flat zero, which says nothing about
 * the unit; when it has weapons for the other phase, use that instead. An explicit phase is still
 * honoured whenever the unit can act in it.
 */
export function phaseFor(a: ScenarioUnit, context: Partial<ScenarioContext>): Partial<ScenarioContext> {
  const enabled = a.weapons.filter((w) => w.enabled && w.count > 0);
  if (!enabled.length) return context;
  const wanted = context.phase ?? "shooting";
  const kind = wanted === "fight" ? "melee" : "ranged";
  if (enabled.some((w) => w.kind === kind)) return context;
  return wanted === "fight" ? { ...context, phase: "shooting" } : { ...context, phase: "fight", charged: context.charged ?? true };
}

/** Many-vs-many: every attacker against every defender under one context. */
export function runMatrix(attackers: ScenarioUnit[], defenders: ScenarioUnit[], context: Partial<ScenarioContext> = {}, opts: { snapshot?: Snapshot; enabledToggles?: string[] } = {}): MatrixResult {
  const cells = attackers.map((a) =>
    defenders.map((d) => {
      const result = runScenario(makeScenario(a, d, phaseFor(a, context), opts.enabledToggles ?? []), { snapshot: opts.snapshot });
      delete result.finalState; // not needed for a matrix; keeps the payload small
      const cell: MatrixCell = { attacker: a.name, defender: d.name, result, attackerPoints: a.points, defenderPoints: d.points };
      if (a.points) {
        cell.damagePer100 = (result.expectedDamage / a.points) * 100;
        if (result.pointsSlain !== undefined) cell.pointsTradePer100 = (result.pointsSlain / a.points) * 100;
      }
      return cell;
    }),
  );
  return { attackers: attackers.map((a) => a.name), defenders: defenders.map((d) => d.name), cells };
}

export interface DurabilityEntry {
  archetype: string;
  expectedDamage: number;
  pKill: number;
  /** Wounds the unit is expected to lose per 100 of its own points against this archetype (lower is tougher). */
  damageTakenPer100?: number;
}

const DEFAULT_ATTACKER_ARCHETYPES = ["bolter-squad", "lascannon-team", "melta-squad", "chainsword-mob"];

/** Durability profile: how a unit fares against a spread of attacker archetypes. */
export function durabilityProfile(defender: ScenarioUnit, opts: { attackerIds?: string[]; snapshot?: Snapshot; context?: Partial<ScenarioContext> } = {}): DurabilityEntry[] {
  const ids = opts.attackerIds ?? DEFAULT_ATTACKER_ARCHETYPES;
  return ids.flatMap((id) => {
    const a = archetypes.find((x) => x.id === id);
    if (!a) return [];
    const isMelee = a.unit.weapons.every((w) => w.kind === "melee");
    const ctx: Partial<ScenarioContext> = { ...(opts.context ?? {}), phase: isMelee ? "fight" : "shooting", rangeBand: "half", charged: isMelee };
    const r = runScenario(makeScenario(a.unit, defender, ctx), { snapshot: opts.snapshot });
    const e: DurabilityEntry = { archetype: a.name, expectedDamage: r.expectedDamage, pKill: r.pKill };
    if (defender.points) e.damageTakenPer100 = (r.expectedDamage / defender.points) * 100;
    return [e];
  });
}

export interface EfficiencyRow {
  unit: string;
  points?: number;
  /** Mean expected damage per 100 points across the target set. */
  damagePer100: number;
  /** Per-target expected damage. */
  byTarget: Record<string, number>;
  /** Per-target expected *points* of the target destroyed (the target archetype's own points value). */
  pointsByTarget: Record<string, number>;
}

const DEFAULT_TARGETS = ["guardsman-like", "marine-like", "terminator-like", "light-vehicle", "heavy-tank"];

/** Rank attackers by damage per point across a set of target archetypes. */
export function efficiencyRanking(attackers: ScenarioUnit[], opts: { targetIds?: string[]; snapshot?: Snapshot; context?: Partial<ScenarioContext> } = {}): EfficiencyRow[] {
  const targets = (opts.targetIds ?? DEFAULT_TARGETS).flatMap((id) => archetypes.find((a) => a.id === id)?.unit ?? []);
  const rows = attackers.map((a) => {
    const byTarget: Record<string, number> = {};
    const pointsByTarget: Record<string, number> = {};
    let sum = 0;
    for (const t of targets) {
      const r = runScenario(makeScenario(a, t, phaseFor(a, opts.context ?? { rangeBand: "half" })), { snapshot: opts.snapshot });
      byTarget[t.name] = r.expectedDamage;
      // `pointsSlain` is only present when the target carries a points value; a target without one trades 0.
      pointsByTarget[t.name] = r.pointsSlain ?? 0;
      sum += a.points ? (r.expectedDamage / a.points) * 100 : r.expectedDamage;
    }
    const row: EfficiencyRow = { unit: a.name, damagePer100: targets.length ? sum / targets.length : 0, byTarget, pointsByTarget };
    if (a.points !== undefined) row.points = a.points;
    return row;
  });
  return rows.sort((x, y) => y.damagePer100 - x.damagePer100);
}

export interface DurabilityIndexRow {
  unit: string;
  points?: number;
  /** Expected points of attacker needed to remove the unit, averaged over the attacker archetypes. */
  pointsToRemove: number;
  /** Per-archetype: expected attacker points needed (attacker points × unit wounds / expected damage). */
  byArchetype: Record<string, number>;
}

/** One attacker archetype's reading of a defender, per 100 of the *attacker's* points. */
export interface IncomingEntry {
  archetype: string;
  /** Points value of the attacking archetype (the denominator of the two rates). */
  attackerPoints: number;
  expectedDamage: number;
  expectedSlain: number;
  /** Wounds removed per 100 attacker points. */
  woundsPer100: number;
  /** Models removed per 100 attacker points. */
  slainPer100: number;
  /** Attacker points needed to strip the unit's wounds at this rate; Infinity when the archetype cannot hurt it. */
  pointsToRemove: number;
}

export interface IncomingFireRow extends DurabilityIndexRow {
  models: number;
  wounds: number;
  /**
   * Wounds removed per 100 attacker points, averaged over the archetypes — the *slope* of the
   * durability reading, where `pointsToRemove` is its endpoint. The two are different averages of
   * the same runs on purpose: the endpoint averages "points needed" (so one archetype that cannot
   * hurt the unit drops out), the slope averages rates (so it stays defined and linear near zero).
   */
  woundsPer100: number;
  /** Models removed per 100 attacker points, averaged over the archetypes. */
  slainPer100: number;
  /**
   * Raw wounds divided by the chance a single reference attack's damage sticks: the number of
   * reference attacks expected to remove the unit. Saves, invulnerable saves and Feel No Pain all
   * push it above the raw wound count. See `REFERENCE_ATTACK`.
   */
  effectiveWounds: number;
  entries: IncomingEntry[];
}

/**
 * The attack profile "effective wounds" is measured against: a plain BS 3+, S4, AP 0, damage 1
 * shot with no keywords and no modifiers. It is deliberately generic, a measuring stick rather than a real threat.
 */
export const REFERENCE_ATTACK = { skill: 3, S: 4, AP: 0 } as const;
export type ReferenceAttack = { skill: number; S: number; AP: number };

/**
 * Probability that one reference attack takes a wound off this model: hit × wound × failed save ×
 * survived Feel No Pain. 0 when nothing can get through.
 */
export function pReferenceSticks(m: ScenarioModel, ref: ReferenceAttack = REFERENCE_ATTACK): number {
  const hit = hitGate({ target: ref.skill, rollMod: 0, critThreshold: 6, snap: false, reroll: null });
  const wound = woundGate({ target: woundTarget(ref.S, m.T), rollMod: 0, critThreshold: 6, reroll: null });
  const unsaved = pUnsaved({ armourTarget: m.Sv + ref.AP, invulnTarget: m.InvSv ?? null, rollMod: 0, reroll: null });
  // A Feel No Pain of N+ ignores (7 − N)/6 of the damage, so (N − 1)/6 of it sticks.
  const fnp = m.fnp && m.fnp >= 2 && m.fnp <= 6 ? (m.fnp - 1) / 6 : 1;
  return (hit.pHit + hit.pCrit) * (wound.pWound + wound.pCrit) * unsaved * fnp;
}

/**
 * Effective wounds of a unit: every model's wounds divided by the chance one reference attack
 * sticks, summed. A model nothing can get through contributes Infinity, so the unit's total is
 * Infinity too — the caller shows that as a dash rather than a number.
 */
export function effectiveWounds(unit: ScenarioUnit, ref: ReferenceAttack = REFERENCE_ATTACK): number {
  let total = 0;
  for (const m of unit.models) {
    const p = pReferenceSticks(m, ref);
    if (!(p > 0)) return Number.POSITIVE_INFINITY;
    total += (m.count * m.W) / p;
  }
  return total;
}

/**
 * Incoming fire: what a spread of attacker archetypes does to each unit, expressed both as a rate
 * (wounds and models removed per 100 attacker points) and as an endpoint (`pointsToRemove`). One
 * run per attacker/defender pair; `durabilityIndex` is the endpoint-only view of the same runs.
 */
export function incomingFire(defenders: ScenarioUnit[], opts: { attackerIds?: string[]; snapshot?: Snapshot; context?: Partial<ScenarioContext>; reference?: ReferenceAttack } = {}): IncomingFireRow[] {
  const ids = opts.attackerIds ?? DEFAULT_ATTACKER_ARCHETYPES;
  const attackers = ids.flatMap((id) => archetypes.find((a) => a.id === id) ?? []);
  return defenders.map((d) => {
    const models = d.models.reduce((s, m) => s + m.count, 0);
    const totalWounds = d.models.reduce((s, m) => s + m.count * m.W, 0);
    const byArchetype: Record<string, number> = {};
    const entries: IncomingEntry[] = [];
    let needSum = 0;
    let needN = 0;
    let woundRate = 0;
    let slainRate = 0;
    for (const a of attackers) {
      const isMelee = a.unit.weapons.every((w) => w.kind === "melee");
      const ctx: Partial<ScenarioContext> = { ...(opts.context ?? {}), phase: isMelee ? "fight" : "shooting", rangeBand: "half", charged: isMelee };
      const r = runScenario(makeScenario(a.unit, d, ctx), { snapshot: opts.snapshot });
      const pts = a.unit.points ?? 100;
      const need = r.expectedDamage > 1e-9 ? (pts * totalWounds) / r.expectedDamage : Number.POSITIVE_INFINITY;
      const woundsPer100 = (r.expectedDamage / pts) * 100;
      const slainPer100 = (r.expectedSlain / pts) * 100;
      byArchetype[a.name] = need;
      entries.push({ archetype: a.name, attackerPoints: pts, expectedDamage: r.expectedDamage, expectedSlain: r.expectedSlain, woundsPer100, slainPer100, pointsToRemove: need });
      woundRate += woundsPer100;
      slainRate += slainPer100;
      if (Number.isFinite(need)) {
        needSum += need;
        needN++;
      }
    }
    const n = attackers.length || 1;
    const row: IncomingFireRow = {
      unit: d.name,
      pointsToRemove: needN ? needSum / needN : Number.POSITIVE_INFINITY,
      byArchetype,
      models,
      wounds: totalWounds,
      woundsPer100: woundRate / n,
      slainPer100: slainRate / n,
      effectiveWounds: effectiveWounds(d, opts.reference ?? REFERENCE_ATTACK),
      entries,
    };
    if (d.points !== undefined) row.points = d.points;
    return row;
  });
}

/**
 * Durability index: how many points of shooting (from the attacker archetypes) it takes, in expectation,
 * to remove the unit entirely. Higher is tougher. Uses expected damage from one activation, scaled linearly.
 */
export function durabilityIndex(defenders: ScenarioUnit[], opts: { attackerIds?: string[]; snapshot?: Snapshot; context?: Partial<ScenarioContext> } = {}): DurabilityIndexRow[] {
  return incomingFire(defenders, opts).map((r) => {
    const row: DurabilityIndexRow = { unit: r.unit, pointsToRemove: r.pointsToRemove, byArchetype: r.byArchetype };
    if (r.points !== undefined) row.points = r.points;
    return row;
  });
}
