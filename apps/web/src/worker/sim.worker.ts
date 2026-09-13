/// <reference lib="webworker" />
import * as Comlink from "comlink";
import type { Scenario, ScenarioContext, ScenarioUnit, SimResult, Snapshot } from "@grimstat/schema";
import { durabilityIndex, durabilityProfile, efficiencyRanking, incomingFire, runMatrix, runScenario, type DurabilityEntry, type DurabilityIndexRow, type EfficiencyRow, type IncomingFireRow, type MatrixResult } from "@grimstat/game-40k-11e";
import { evaluateTurnPlan, optimiseTurn, type TurnPlanInput, type TurnPlanResult, type TurnPlanStep } from "../lib/turn";
import { reverseMathhammer, sensitivity, type ReverseInput, type ReverseResult, type SensitivityResult } from "../lib/gameExtras";

/**
 * Snapshots are large, so the worker caches them and each run only ships the scenario. The key comes
 * from the client (see `snapshotKey` in client.ts). A snapshot id on its own would not do, because
 * applying an override rewrites a snapshot's contents and its checksum while leaving its id alone, and
 * a cache keyed by id would go on serving the un-patched data.
 */
const cache = new Map<string, Snapshot>();

/** How many snapshots the worker keeps. Every override edit makes a new key, so old ones are dropped. */
export const SNAPSHOT_CACHE_LIMIT = 3;

/** The key of a snapshot previously handed over with `putSnapshot`. */
export type SnapshotRef = string | undefined;

export interface Timed<T> {
  result: T;
  elapsedMs: number;
}

export interface ArchetypeAnalysisOpts {
  context?: Partial<ScenarioContext>;
}

export interface SimWorkerApi {
  /**
   * Cache a snapshot under the client's key; later runs refer to it by that key. Returns the keys the
   * worker holds afterwards, so the client knows which ones it has to hand over again.
   */
  putSnapshot(key: string, snapshot: Snapshot): string[];
  /** Run a scenario. Returns the result plus the wall time in ms. */
  run(scenario: Scenario, ref?: SnapshotRef): Timed<SimResult>;
  /** Every attacker against every defender (Analyses → Matrix). Cells are stripped of engine state. */
  matrix(attackers: ScenarioUnit[], defenders: ScenarioUnit[], context: Partial<ScenarioContext>, enabledToggles: string[], ref?: SnapshotRef): Timed<MatrixResult>;
  /** One defender against attacker archetypes (Analyses → Durability). */
  durability(defender: ScenarioUnit, opts: ArchetypeAnalysisOpts & { attackerIds?: string[] }, ref?: SnapshotRef): Timed<DurabilityEntry[]>;
  /** Points of shooting needed to remove each unit (Analyses → Matrix's durability index card). */
  durabilityIndex(defenders: ScenarioUnit[], opts: ArchetypeAnalysisOpts & { attackerIds?: string[] }, ref?: SnapshotRef): Timed<DurabilityIndexRow[]>;
  /**
   * The same runs as `durabilityIndex`, reporting the rate as well as the endpoint plus effective
   * wounds (Armies → Statistics: durability, casualty curve and effective wounds all read this).
   */
  incoming(defenders: ScenarioUnit[], opts: ArchetypeAnalysisOpts & { attackerIds?: string[] }, ref?: SnapshotRef): Timed<IncomingFireRow[]>;
  /** Attackers ranked by damage per point across target archetypes (Analyses → Efficiency). */
  efficiency(attackers: ScenarioUnit[], opts: ArchetypeAnalysisOpts & { targetIds?: string[] }, ref?: SnapshotRef): Timed<EfficiencyRow[]>;
  /** Joint target allocation for one turn (Analyses → Turn optimiser). */
  optimiseTurn(input: Omit<TurnPlanInput, "snapshot">, ref?: SnapshotRef): Timed<TurnPlanResult>;
  /** Re-score a manually edited plan. */
  evaluateTurnPlan(input: Omit<TurnPlanInput, "snapshot">, plan: TurnPlanStep[], ref?: SnapshotRef): Timed<TurnPlanResult>;
  /** "What kills X?": candidates (and combinations) ranked against one target (Analyses → Reverse). */
  reverse(input: Omit<ReverseInput, "snapshot">, ref?: SnapshotRef): Timed<ReverseResult>;
  /** One-step variations of the scenario (Calculator → What if widget). */
  sensitivity(scenario: Scenario, variantIds: string[] | undefined, ref?: SnapshotRef): Timed<SensitivityResult>;
}

/** Store a snapshot and drop the least recently used ones past the limit. Returns the keys kept. */
function remember(key: string, snapshot: Snapshot): string[] {
  cache.delete(key);
  cache.set(key, snapshot);
  for (const old of [...cache.keys()].slice(0, Math.max(0, cache.size - SNAPSHOT_CACHE_LIMIT))) cache.delete(old);
  return [...cache.keys()];
}

function resolve(ref: SnapshotRef): Snapshot | undefined {
  if (ref === undefined) return undefined;
  const snapshot = cache.get(ref);
  // Running without the snapshot would quietly produce different numbers, so an unknown key is an error.
  if (!snapshot) throw new Error(`snapshot ${ref} is not cached in the worker`);
  // Reading counts as use, so the snapshot the screens keep running against is the last one dropped.
  cache.delete(ref);
  cache.set(ref, snapshot);
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

/** Exported so the cache can be exercised directly; the app reaches it over Comlink. */
export const api: SimWorkerApi = {
  putSnapshot(key, snapshot) {
    return remember(key, snapshot);
  },
  run(scenario, ref) {
    const snap = resolve(ref);
    return timed(() => runScenario(scenario, snap ? { snapshot: snap } : {}));
  },
  matrix(attackers, defenders, context, enabledToggles, ref) {
    const snap = resolve(ref);
    return timed(() => {
      const m = runMatrix(attackers, defenders, context, { ...(snap ? { snapshot: snap } : {}), enabledToggles });
      return { ...m, cells: m.cells.map((row) => row.map((c) => ({ ...c, result: slim(c.result) }))) };
    });
  },
  durability(defender, opts, ref) {
    const snap = resolve(ref);
    return timed(() => durabilityProfile(defender, { ...opts, ...(snap ? { snapshot: snap } : {}) }));
  },
  durabilityIndex(defenders, opts, ref) {
    const snap = resolve(ref);
    return timed(() => durabilityIndex(defenders, { ...opts, ...(snap ? { snapshot: snap } : {}) }));
  },
  incoming(defenders, opts, ref) {
    const snap = resolve(ref);
    return timed(() => incomingFire(defenders, { ...opts, ...(snap ? { snapshot: snap } : {}) }));
  },
  efficiency(attackers, opts, ref) {
    const snap = resolve(ref);
    return timed(() => {
      // efficiencyRanking evaluates every attacker under one context; melee-only units would score 0 in the
      // shooting phase, so they are ranked in the fight phase (charged) and merged back into one ordering.
      const isMelee = (u: ScenarioUnit) => u.weapons.some((w) => w.enabled && w.count > 0) && u.weapons.every((w) => !w.enabled || w.count <= 0 || w.kind === "melee");
      const melee = attackers.filter(isMelee);
      const ranged = attackers.filter((u) => !isMelee(u));
      // The two halves are ranked separately and sorted into one column, so whether that column is
      // denominated in points has to be settled across the whole set. Left to each call, a priced
      // ranged half and an unpriced melee half would put damage per 100 points and raw damage in the
      // same column.
      const perPoints = attackers.length > 0 && attackers.every((u) => u.points !== undefined && u.points > 0);
      const base = { ...opts, perPoints, ...(snap ? { snapshot: snap } : {}) };
      // Each row carries its own backend and its own interval, both worked out over that unit's own
      // target runs. The two halves are concatenated whole, so no row is dropped and no two rows are
      // folded together. Settling `perPoints` above also settles the scale the intervals arrive on,
      // because a row's half-width is denominated the same way its damage figure is.
      const rows = [...(ranged.length ? efficiencyRanking(ranged, base) : []), ...(melee.length ? efficiencyRanking(melee, { ...base, context: { ...(opts.context ?? {}), phase: "fight", charged: true } }) : [])];
      // The order is still expected damage alone. Reading a tie off the intervals belongs to the screen.
      return rows.sort((x, y) => y.damagePer100 - x.damagePer100);
    });
  },
  optimiseTurn(input, ref) {
    const snap = resolve(ref);
    return timed(() => optimiseTurn({ ...input, ...(snap ? { snapshot: snap } : {}) }));
  },
  evaluateTurnPlan(input, plan, ref) {
    const snap = resolve(ref);
    return timed(() => evaluateTurnPlan({ ...input, ...(snap ? { snapshot: snap } : {}) }, plan));
  },
  reverse(input, ref) {
    const snap = resolve(ref);
    return timed(() => reverseMathhammer({ ...input, ...(snap ? { snapshot: snap } : {}) }));
  },
  sensitivity(scenario, variantIds, ref) {
    const snap = resolve(ref);
    return timed(() => sensitivity(scenario, { ...(snap ? { snapshot: snap } : {}), ...(variantIds ? { variantIds } : {}) }));
  },
};

Comlink.expose(api);
