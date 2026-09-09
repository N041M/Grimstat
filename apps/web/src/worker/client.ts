import * as Comlink from "comlink";
import type { Scenario, SimResult, Snapshot } from "@grimstat/schema";
import type { SimWorkerApi } from "./sim.worker";

export interface RunOutcome {
  result: SimResult;
  elapsedMs: number;
}

/** How long a superseded run may keep the worker busy before we terminate and respawn it. */
const STALE_KILL_MS = 2500;

/**
 * Owns the simulation Web Worker. Runs are sequenced: a result is only delivered if no newer run
 * was requested meanwhile. If a stale run hogs the worker for too long, the worker is terminated
 * and recreated (the only real way to cancel synchronous work).
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

  async run(scenario: Scenario, snapshot: Snapshot | undefined): Promise<{ seq: number; outcome: RunOutcome | undefined }> {
    const seq = ++this.seq;
    if (this.busySince !== undefined && performance.now() - this.busySince > STALE_KILL_MS) this.respawn();
    const proxy = this.ensure();
    const worker = this.worker;
    this.busySince = performance.now();
    try {
      let ref: Snapshot | string | undefined;
      if (snapshot) {
        // Key by id + checksum so a re-imported snapshot with the same id is never served stale.
        const key = `${snapshot.id}|${snapshot.checksum}|${snapshot.updatedAt}`;
        if (!this.cachedSnapshotIds.has(key)) {
          await proxy.putSnapshot(snapshot);
          this.cachedSnapshotIds.add(key);
        }
        ref = snapshot.id;
      }
      if (seq !== this.seq) return { seq, outcome: undefined };
      const outcome = await proxy.run(scenario, ref);
      return { seq, outcome: seq === this.seq ? outcome : undefined };
    } finally {
      if (this.worker === worker) this.busySince = undefined;
    }
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
