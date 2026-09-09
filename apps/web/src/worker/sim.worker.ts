/// <reference lib="webworker" />
import * as Comlink from "comlink";
import type { Scenario, SimResult, Snapshot } from "@grimstat/schema";
import { runScenario } from "@grimstat/game-40k-11e";

/** Snapshots are large; the worker caches them by id so each run only ships the scenario. */
const cache = new Map<string, Snapshot>();

export interface SimWorkerApi {
  /** Cache a snapshot in the worker; later runs can refer to it by id. */
  putSnapshot(snapshot: Snapshot): void;
  hasSnapshot(id: string): boolean;
  forgetSnapshot(id: string): void;
  /**
   * Run a scenario. `snapshot` may be a full Snapshot (cached as a side effect) or the id of one
   * previously put with putSnapshot. Returns the result plus the wall time in ms.
   */
  run(scenario: Scenario, snapshot?: Snapshot | string): { result: SimResult; elapsedMs: number };
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
    let snap: Snapshot | undefined;
    if (typeof snapshot === "string") snap = cache.get(snapshot);
    else if (snapshot) {
      cache.set(snapshot.id, snapshot);
      snap = snapshot;
    }
    const t0 = performance.now();
    const result = runScenario(scenario, snap ? { snapshot: snap } : {});
    return { result, elapsedMs: performance.now() - t0 };
  },
};

Comlink.expose(api);
