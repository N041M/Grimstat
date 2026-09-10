/// <reference lib="webworker" />
import * as Comlink from "comlink";
import type { Scenario, ScenarioContext, ScenarioUnit, SimResult, Snapshot } from "@grimstat/schema";
import { durabilityIndex, durabilityProfile, efficiencyRanking, runMatrix, runScenario, type DurabilityEntry, type DurabilityIndexRow, type EfficiencyRow, type MatrixResult } from "@grimstat/game-40k-11e";
import { evaluateTurnPlan, optimiseTurn, type TurnPlanInput, type TurnPlanResult, type TurnPlanStep } from "../lib/turn";
import { reverseMathhammer, sensitivity, type ReverseInput, type ReverseResult, type SensitivityResult } from "../lib/gameExtras";

/** Snapshots are large; the worker caches them by id so each run only ships the scenario. */
const cache = new Map<string, Snapshot>();

/** A full Snapshot (cached as a side effect) or the id of one previously put with putSnapshot. */
export type SnapshotRef = Snapshot | string | undefined;

export interface Timed<T> {
  result: T;
  elapsedMs: number;
}

export interface ArchetypeAnalysisOpts {
  context?: Partial<ScenarioContext>;
}

export interface SimWorkerApi {
  /** Cache a snapshot in the worker; later runs can refer to it by id. */
  putSnapshot(snapshot: Snapshot): void;
  hasSnapshot(id: string): boolean;
  forgetSnapshot(id: string): void;
  /** Run a scenario. Returns the result plus the wall time in ms. */
  run(scenario: Scenario, snapshot?: SnapshotRef): Timed<SimResult>;
  /** Every attacker against every defender (Analyses → Matrix). Cells are stripped of engine state. */
  matrix(attackers: ScenarioUnit[], defenders: ScenarioUnit[], context: Partial<ScenarioContext>, enabledToggles: string[], snapshot?: SnapshotRef): Timed<MatrixResult>;
  /** One defender against attacker archetypes (Analyses → Durability). */
  durability(defender: ScenarioUnit, opts: ArchetypeAnalysisOpts & { attackerIds?: string[] }, snapshot?: SnapshotRef): Timed<DurabilityEntry[]>;
  /** Points of shooting needed to remove each unit (Analyses → Matrix's durability index card). */
  durabilityIndex(defenders: ScenarioUnit[], opts: ArchetypeAnalysisOpts & { attackerIds?: string[] }, snapshot?: SnapshotRef): Timed<DurabilityIndexRow[]>;
  /** Attackers ranked by damage per point across target archetypes (Analyses → Efficiency). */
  efficiency(attackers: ScenarioUnit[], opts: ArchetypeAnalysisOpts & { targetIds?: string[] }, snapshot?: SnapshotRef): Timed<EfficiencyRow[]>;
  /** Joint target allocation for one turn (Analyses → Turn optimiser). */
  optimiseTurn(input: Omit<TurnPlanInput, "snapshot">, snapshot?: SnapshotRef): Timed<TurnPlanResult>;
  /** Re-score a manually edited plan. */
  evaluateTurnPlan(input: Omit<TurnPlanInput, "snapshot">, plan: TurnPlanStep[], snapshot?: SnapshotRef): Timed<TurnPlanResult>;
  /** "What kills X?": candidates (and combinations) ranked against one target (Analyses → Reverse). */
  reverse(input: Omit<ReverseInput, "snapshot">, snapshot?: SnapshotRef): Timed<ReverseResult>;
  /** One-step variations of the scenario (Calculator → What if widget). */
  sensitivity(scenario: Scenario, variantIds: string[] | undefined, snapshot?: SnapshotRef): Timed<SensitivityResult>;
}

function resolve(snapshot: SnapshotRef): Snapshot | undefined {
  if (typeof snapshot === "string") return cache.get(snapshot);
  if (snapshot) cache.set(snapshot.id, snapshot);
  return snapshot;
}

function timed<T>(fn: () => T): Timed<T> {
  const t0 = performance.now();
  const result = fn();
  return { result, elapsedMs: performance.now() - t0 };
}

/** The final defender state distribution is only useful for chaining; drop it before crossing the worker boundary. */
function slim(r: SimResult): SimResult {
  if (!r.finalState) return r;
  const { finalState: _f, ...rest } = r;
  return rest;
}

const api: SimWorkerApi = {
  putSnapshot(snapshot) {
    cache.set(snapshot.id, snapshot);
  },
  hasSnapshot(id) {
    return cache.has(id);
  },
  forgetSnapshot(id) {
    cache.delete(id);
  },
  run(scenario, snapshot) {
    const snap = resolve(snapshot);
    return timed(() => runScenario(scenario, snap ? { snapshot: snap } : {}));
  },
  matrix(attackers, defenders, context, enabledToggles, snapshot) {
    const snap = resolve(snapshot);
    return timed(() => {
      const m = runMatrix(attackers, defenders, context, { ...(snap ? { snapshot: snap } : {}), enabledToggles });
      return { ...m, cells: m.cells.map((row) => row.map((c) => ({ ...c, result: slim(c.result) }))) };
    });
  },
  durability(defender, opts, snapshot) {
    const snap = resolve(snapshot);
    return timed(() => durabilityProfile(defender, { ...opts, ...(snap ? { snapshot: snap } : {}) }));
  },
  durabilityIndex(defenders, opts, snapshot) {
    const snap = resolve(snapshot);
    return timed(() => durabilityIndex(defenders, { ...opts, ...(snap ? { snapshot: snap } : {}) }));
  },
  efficiency(attackers, opts, snapshot) {
    const snap = resolve(snapshot);
    return timed(() => {
      // efficiencyRanking evaluates every attacker under one context; melee-only units would score 0 in the
      // shooting phase, so they are ranked in the fight phase (charged) and merged back into one ordering.
      const isMelee = (u: ScenarioUnit) => u.weapons.some((w) => w.enabled && w.count > 0) && u.weapons.every((w) => !w.enabled || w.count <= 0 || w.kind === "melee");
      const melee = attackers.filter(isMelee);
      const ranged = attackers.filter((u) => !isMelee(u));
      const base = { ...opts, ...(snap ? { snapshot: snap } : {}) };
      const rows = [...(ranged.length ? efficiencyRanking(ranged, base) : []), ...(melee.length ? efficiencyRanking(melee, { ...base, context: { ...(opts.context ?? {}), phase: "fight", charged: true } }) : [])];
      return rows.sort((x, y) => y.damagePer100 - x.damagePer100);
    });
  },
  optimiseTurn(input, snapshot) {
    const snap = resolve(snapshot);
    return timed(() => optimiseTurn({ ...input, ...(snap ? { snapshot: snap } : {}) }));
  },
  evaluateTurnPlan(input, plan, snapshot) {
    const snap = resolve(snapshot);
    return timed(() => evaluateTurnPlan({ ...input, ...(snap ? { snapshot: snap } : {}) }, plan));
  },
  reverse(input, snapshot) {
    const snap = resolve(snapshot);
    return timed(() => reverseMathhammer({ ...input, ...(snap ? { snapshot: snap } : {}) }));
  },
  sensitivity(scenario, variantIds, snapshot) {
    const snap = resolve(snapshot);
    return timed(() => sensitivity(scenario, { ...(snap ? { snapshot: snap } : {}), ...(variantIds ? { variantIds } : {}) }));
  },
};

Comlink.expose(api);
