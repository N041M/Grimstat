import * as Comlink from "comlink";
import type { Scenario, ScenarioContext, ScenarioUnit, SimResult, Snapshot } from "@grimstat/schema";
import type { DurabilityEntry, DurabilityIndexRow, EfficiencyRow, IncomingFireRow, MatrixResult } from "@grimstat/game-40k-11e";
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

/** What a request in flight rejects with when `cancel()` terminates the worker under it. */
export class CancelledError extends Error {
  constructor() {
    super("cancelled");
    this.name = "CancelledError";
  }
}

export function isCancelled(e: unknown): e is CancelledError {
  return e instanceof CancelledError;
}

/** What a request in flight rejects with when the worker itself fails to load or to answer. */
export class WorkerFailedError extends Error {
  constructor(options?: ErrorOptions) {
    super("The calculation stopped. Try again.", options);
    this.name = "WorkerFailedError";
  }
}

/**
 * How a snapshot is addressed in the worker. The id on its own will not do. Applying an override
 * rewrites a snapshot's contents and its checksum while keeping its id, so an id-keyed cache would
 * serve the un-patched data back (see `effectiveSnapshot` in ../lib/overrides).
 */
export function snapshotKey(snapshot: Snapshot): string {
  return `${snapshot.id}|${snapshot.checksum}|${snapshot.updatedAt}`;
}

/** What the browser said about a worker that failed. */
function failureDetail(e: Event): string {
  return "message" in e && typeof e.message === "string" && e.message ? e.message : e.type;
}

/** How a call in flight is settled from outside. A respawn supersedes it and a failure rejects it. */
interface Interrupt {
  supersede(): void;
  reject(e: Error): void;
}

/** What the race in `call` yields when the worker under it was replaced. */
const SUPERSEDED = Symbol("superseded");

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
  /** The snapshot keys the worker reported holding after the last hand-over. */
  private cachedSnapshots = new Set<string>();
  /** The calls in flight, so `cancel()`, a respawn and a worker failure can settle them. */
  private pending = new Set<Interrupt>();

  private ensure(): Comlink.Remote<SimWorkerApi> {
    if (!this.proxy) {
      const worker = new Worker(new URL("./sim.worker.ts", import.meta.url), { type: "module", name: "grimstat-sim" });
      // A worker that fails to load or throws on its own never answers, so the calls waiting on it are
      // rejected here. The listener ignores a worker this client has already replaced.
      const failed = (e: Event): void => {
        if (this.worker === worker) this.fail(new WorkerFailedError({ cause: failureDetail(e) }));
      };
      worker.addEventListener("error", failed);
      worker.addEventListener("messageerror", failed);
      this.worker = worker;
      this.proxy = Comlink.wrap<SimWorkerApi>(worker);
      this.cachedSnapshots.clear();
    }
    return this.proxy;
  }

  private respawn(): void {
    // Comlink's request promise has no rejection path, so a call left waiting on a terminated worker
    // would stay pending for the life of the page. Every one of them is settled as superseded.
    const waiting = [...this.pending];
    this.pending.clear();
    this.worker?.terminate();
    this.proxy?.[Comlink.releaseProxy]();
    this.worker = undefined;
    this.proxy = undefined;
    this.busySince = undefined;
    this.cachedSnapshots.clear();
    for (const p of waiting) p.supersede();
  }

  /** Drop the worker and reject every call in flight. The next call spawns a fresh worker. */
  private fail(e: Error): void {
    const waiting = [...this.pending];
    this.pending.clear();
    this.respawn();
    for (const p of waiting) p.reject(e);
  }

  /** Sequence id of the most recent request; used by callers to drop stale results. */
  get latest(): number {
    return this.seq;
  }

  /**
   * Sequence a worker call. Hands the snapshot over once per worker lifetime, under the key the worker
   * caches it by, then invokes `fn` with that key. A call the worker can no longer answer resolves
   * with no outcome, the same as one a newer request superseded.
   */
  private async call<T>(snapshot: Snapshot | undefined, fn: (proxy: Comlink.Remote<SimWorkerApi>, ref: SnapshotRef) => Promise<T>): Promise<Sequenced<T>> {
    const seq = ++this.seq;
    if (this.busySince !== undefined && performance.now() - this.busySince > STALE_KILL_MS) this.respawn();
    const proxy = this.ensure();
    const worker = this.worker;
    this.busySince = performance.now();
    let interrupt: Interrupt = { supersede: () => undefined, reject: () => undefined };
    const interrupted = new Promise<typeof SUPERSEDED>((resolve, reject) => {
      interrupt = { supersede: () => resolve(SUPERSEDED), reject };
    });
    this.pending.add(interrupt);
    try {
      let ref: SnapshotRef;
      if (snapshot) {
        const key = snapshotKey(snapshot);
        if (!this.cachedSnapshots.has(key)) {
          const held = await Promise.race([proxy.putSnapshot(key, snapshot), interrupted]);
          if (held === SUPERSEDED || this.worker !== worker) return { seq, outcome: undefined };
          // The worker reports what it kept, so the client never refers to a snapshot it has dropped.
          this.cachedSnapshots = new Set(held);
        }
        ref = key;
      }
      if (seq !== this.seq) return { seq, outcome: undefined };
      const outcome = await Promise.race([fn(proxy, ref), interrupted]);
      if (outcome === SUPERSEDED) return { seq, outcome: undefined };
      return { seq, outcome: seq === this.seq ? outcome : undefined };
    } finally {
      this.pending.delete(interrupt);
      if (this.worker === worker) this.busySince = undefined;
    }
  }

  /**
   * Abandon whatever the worker is doing: terminate it (the next call spawns a fresh one) and
   * reject every call in flight with `CancelledError`. A no-op while nothing is in flight.
   */
  cancel(): void {
    if (!this.pending.size) return;
    this.fail(new CancelledError());
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

  durabilityIndex(defenders: ScenarioUnit[], opts: { attackerIds?: string[]; context?: Partial<ScenarioContext> }, snapshot: Snapshot | undefined): Promise<Sequenced<Timed<DurabilityIndexRow[]>>> {
    return this.call(snapshot, (p, ref) => p.durabilityIndex(defenders, opts, ref));
  }

  /** `durabilityIndex`'s runs, with the per-100-point rates and effective wounds kept. */
  incoming(defenders: ScenarioUnit[], opts: { attackerIds?: string[]; context?: Partial<ScenarioContext> }, snapshot: Snapshot | undefined): Promise<Sequenced<Timed<IncomingFireRow[]>>> {
    return this.call(snapshot, (p, ref) => p.incoming(defenders, opts, ref));
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
