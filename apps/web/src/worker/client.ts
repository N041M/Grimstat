import * as Comlink from "comlink";
import type { Scenario, ScenarioContext, ScenarioUnit, SimResult, Snapshot } from "@grimstat/schema";
import type { DurabilityEntry, EfficiencyRow, MatrixResult } from "@grimstat/game-40k-11e";
import type { SimWorkerApi, SnapshotRef, Timed } from "./sim.worker";
import type { TurnPlanInput, TurnPlanResult, TurnPlanStep } from "../lib/turn";
import type { ReverseInput, ReverseResult, SensitivityResult } from "../lib/gameExtras";

export type RunOutcome = Timed<SimResult>;

/** What every client call resolves to: the request's sequence id and, unless superseded, its outcome. */
export interface Sequenced<T> {
  seq: number;
  outcome: T | undefined;
}

/** How long a superseded run may keep the worker busy before we terminate and respawn it. */
const STALE_KILL_MS = 2500;

/**
 * Owns the simulation Web Worker. Requests are sequenced: a result is only delivered if no newer
 * request was made meanwhile. If a stale request hogs the worker for too long, the worker is
 * terminated and recreated (the only real way to cancel synchronous work).
 */
export class SimClient {
  private worker: Worker | undefined;
  private proxy: Comlink.Remote<SimWorkerApi> | undefined;
  private seq = 0;
  private busySince: number | undefined;
  private cachedSnapshotIds = new Set<string>();

  private ensure(): Comlink.Remote<SimWorkerApi> {
    if (!this.proxy) {
      this.worker = new Worker(new URL("./sim.worker.ts", import.meta.url), { type: "module", name: "grimstat-sim" });
      this.proxy = Comlink.wrap<SimWorkerApi>(this.worker);
      this.cachedSnapshotIds.clear();
    }
    return this.proxy;
  }

  private respawn(): void {
    this.worker?.terminate();
    this.proxy?.[Comlink.releaseProxy]();
    this.worker = undefined;
    this.proxy = undefined;
    this.busySince = undefined;
    this.cachedSnapshotIds.clear();
  }

  /** Sequence id of the most recent request; used by callers to drop stale results. */
  get latest(): number {
    return this.seq;
  }

  /**
   * Sequence a worker call. Ships the snapshot once per worker lifetime (keyed by id + checksum so a
   * re-imported snapshot with the same id is never served stale), then invokes `fn` with a reference.
   */
  private async call<T>(snapshot: Snapshot | undefined, fn: (proxy: Comlink.Remote<SimWorkerApi>, ref: SnapshotRef) => Promise<T>): Promise<Sequenced<T>> {
    const seq = ++this.seq;
    if (this.busySince !== undefined && performance.now() - this.busySince > STALE_KILL_MS) this.respawn();
    const proxy = this.ensure();
    const worker = this.worker;
    this.busySince = performance.now();
    try {
      let ref: SnapshotRef;
      if (snapshot) {
        const key = `${snapshot.id}|${snapshot.checksum}|${snapshot.updatedAt}`;
        if (!this.cachedSnapshotIds.has(key)) {
          await proxy.putSnapshot(snapshot);
          this.cachedSnapshotIds.add(key);
        }
        ref = snapshot.id;
      }
      if (seq !== this.seq) return { seq, outcome: undefined };
      const outcome = await fn(proxy, ref);
      return { seq, outcome: seq === this.seq ? outcome : undefined };
    } finally {
      if (this.worker === worker) this.busySince = undefined;
    }
  }

  run(scenario: Scenario, snapshot: Snapshot | undefined): Promise<Sequenced<RunOutcome>> {
    return this.call(snapshot, (p, ref) => p.run(scenario, ref));
  }

  matrix(attackers: ScenarioUnit[], defenders: ScenarioUnit[], context: Partial<ScenarioContext>, enabledToggles: string[], snapshot: Snapshot | undefined): Promise<Sequenced<Timed<MatrixResult>>> {
    return this.call(snapshot, (p, ref) => p.matrix(attackers, defenders, context, enabledToggles, ref));
  }

  durability(defender: ScenarioUnit, opts: { attackerIds?: string[]; context?: Partial<ScenarioContext> }, snapshot: Snapshot | undefined): Promise<Sequenced<Timed<DurabilityEntry[]>>> {
    return this.call(snapshot, (p, ref) => p.durability(defender, opts, ref));
  }

  efficiency(attackers: ScenarioUnit[], opts: { targetIds?: string[]; context?: Partial<ScenarioContext> }, snapshot: Snapshot | undefined): Promise<Sequenced<Timed<EfficiencyRow[]>>> {
    return this.call(snapshot, (p, ref) => p.efficiency(attackers, opts, ref));
  }

  optimiseTurn(input: Omit<TurnPlanInput, "snapshot">, snapshot: Snapshot | undefined): Promise<Sequenced<Timed<TurnPlanResult>>> {
    return this.call(snapshot, (p, ref) => p.optimiseTurn(input, ref));
  }

  evaluateTurnPlan(input: Omit<TurnPlanInput, "snapshot">, plan: TurnPlanStep[], snapshot: Snapshot | undefined): Promise<Sequenced<Timed<TurnPlanResult>>> {
    return this.call(snapshot, (p, ref) => p.evaluateTurnPlan(input, plan, ref));
  }

  reverse(input: Omit<ReverseInput, "snapshot">, snapshot: Snapshot | undefined): Promise<Sequenced<Timed<ReverseResult>>> {
    return this.call(snapshot, (p, ref) => p.reverse(input, ref));
  }

  sensitivity(scenario: Scenario, variantIds: string[] | undefined, snapshot: Snapshot | undefined): Promise<Sequenced<Timed<SensitivityResult>>> {
    return this.call(snapshot, (p, ref) => p.sensitivity(scenario, variantIds, ref));
  }

  dispose(): void {
    this.respawn();
  }
}

let shared: SimClient | undefined;
export function simClient(): SimClient {
  if (!shared) shared = new SimClient();
  return shared;
}
