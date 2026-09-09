import type { Scenario, ScenarioContext, ScenarioUnit, SimResult, Snapshot } from "@grimstat/schema";
import { archetypes } from "./archetypes";
import { runScenario } from "./scenario";

const now = () => new Date().toISOString();

export function makeScenario(attacker: ScenarioUnit, defender: ScenarioUnit, context: Partial<ScenarioContext> = {}, enabledToggles: string[] = []): Scenario {
  return {
    id: "adhoc",
    ownerId: "local",
    createdAt: now(),
    updatedAt: now(),
    revision: 0,
    name: `${attacker.name} vs ${defender.name}`,
    gameSystemId: "wh40k-11e",
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

/** Melee-only attackers are resolved in the fight phase (charged); everyone else as given. */
function phaseFor(a: ScenarioUnit, context: Partial<ScenarioContext>): Partial<ScenarioContext> {
  if (context.phase) return context;
  const enabled = a.weapons.filter((w) => w.enabled && w.count > 0);
  const meleeOnly = enabled.length > 0 && enabled.every((w) => w.kind === "melee");
  return meleeOnly ? { ...context, phase: "fight", charged: context.charged ?? true } : context;
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
}

const DEFAULT_TARGETS = ["guardsman-like", "marine-like", "terminator-like", "light-vehicle", "heavy-tank"];

/** Rank attackers by damage per point across a set of target archetypes. */
export function efficiencyRanking(attackers: ScenarioUnit[], opts: { targetIds?: string[]; snapshot?: Snapshot; context?: Partial<ScenarioContext> } = {}): EfficiencyRow[] {
  const targets = (opts.targetIds ?? DEFAULT_TARGETS).flatMap((id) => archetypes.find((a) => a.id === id)?.unit ?? []);
  const rows = attackers.map((a) => {
    const byTarget: Record<string, number> = {};
    let sum = 0;
    for (const t of targets) {
      const r = runScenario(makeScenario(a, t, phaseFor(a, opts.context ?? { rangeBand: "half" })), { snapshot: opts.snapshot });
      byTarget[t.name] = r.expectedDamage;
      sum += a.points ? (r.expectedDamage / a.points) * 100 : r.expectedDamage;
    }
    const row: EfficiencyRow = { unit: a.name, damagePer100: targets.length ? sum / targets.length : 0, byTarget };
    if (a.points !== undefined) row.points = a.points;
    return row;
  });
  return rows.sort((x, y) => y.damagePer100 - x.damagePer100);
}
