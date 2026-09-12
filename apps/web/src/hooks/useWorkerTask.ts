import { useCallback, useState, useSyncExternalStore } from "react";
import { isCancelled, simClient, type Sequenced } from "../worker/client";
import type { Timed } from "../worker/sim.worker";

export interface TaskState<T> {
  result: T | undefined;
  running: boolean;
  error: string | undefined;
  elapsedMs: number | undefined;
}

export interface WorkerTask<A extends unknown[], T> extends TaskState<T> {
  /**
   * The arguments `result` was computed from. Set together with the result, so a failed or
   * cancelled run leaves the previous pair intact; tabs fingerprint these to flag changed inputs.
   */
  ran: A | undefined;
  /** Start (or restart) the task; a newer call supersedes an older one whose result is then dropped. */
  run: (...args: A) => void;
  /** Stop the run in flight. The worker is terminated and the previous result stays. */
  cancel: () => void;
  reset: () => void;
}

interface Snap<A, T> {
  state: TaskState<T>;
  ran: A | undefined;
}

/** One task's store. `gen` grows on every run, cancel and reset so late completions know they are stale. */
interface Entry<A, T> {
  snap: Snap<A, T>;
  gen: number;
  listeners: Set<() => void>;
}

const IDLE: TaskState<never> = { result: undefined, running: false, error: undefined, elapsedMs: undefined };

function newEntry<A, T>(): Entry<A, T> {
  return { snap: { state: IDLE, ran: undefined }, gen: 0, listeners: new Set() };
}

/**
 * Entries kept by cache key. A run's result outlives the component that started it, so leaving the
 * Analyses screen and coming back shows the last result (and its inputs) instead of an empty tab.
 * A run still in flight when the tab unmounts completes into the entry as well.
 */
const cache = new Map<string, Entry<unknown, unknown>>();

function entryFor<A, T>(key: string): Entry<A, T> {
  let e = cache.get(key);
  if (!e) {
    e = newEntry();
    cache.set(key, e);
  }
  return e as Entry<A, T>;
}

function commit<A, T>(e: Entry<A, T>, patch: Partial<TaskState<T>>, ran?: { value: A | undefined }): void {
  e.snap = { state: { ...e.snap.state, ...patch }, ran: ran ? ran.value : e.snap.ran };
  for (const l of e.listeners) l();
}

/**
 * Runs an explicit (button-triggered) analysis in the simulation worker with the same stale-run
 * semantics as `useSimulation`: only the most recent request of this hook ever updates the state,
 * and a request superseded by any newer worker call is dropped silently.
 *
 * With a `cacheKey` the state lives in a module-level map and survives remounts (see `cache`).
 */
export function useWorkerTask<A extends unknown[], T>(fn: (...args: A) => Promise<Sequenced<Timed<T>>>, cacheKey?: string): WorkerTask<A, T> {
  const [local] = useState(() => newEntry<A, T>());
  const entry = cacheKey ? entryFor<A, T>(cacheKey) : local;
  const subscribe = useCallback(
    (listener: () => void) => {
      entry.listeners.add(listener);
      return () => {
        entry.listeners.delete(listener);
      };
    },
    [entry],
  );
  const { state, ran } = useSyncExternalStore(subscribe, () => entry.snap);

  const run = useCallback(
    (...args: A) => {
      const gen = ++entry.gen;
      commit(entry, { running: true, error: undefined });
      void (async () => {
        try {
          const { outcome } = await fn(...args);
          if (gen !== entry.gen) return;
          if (!outcome) {
            // superseded by a newer worker request elsewhere (e.g. the calculator); nothing to show
            commit(entry, { running: false });
            return;
          }
          commit(entry, { result: outcome.result, running: false, error: undefined, elapsedMs: outcome.elapsedMs }, { value: args });
        } catch (e) {
          if (gen !== entry.gen) return;
          commit(entry, { running: false, ...(isCancelled(e) ? {} : { error: e instanceof Error ? e.message : String(e) }) });
        }
      })();
    },
    [fn, entry],
  );

  const cancel = useCallback(() => {
    if (!entry.snap.state.running) return;
    entry.gen++;
    commit(entry, { running: false });
    simClient().cancel();
  }, [entry]);

  const reset = useCallback(() => {
    entry.gen++;
    commit(entry, IDLE, { value: undefined });
  }, [entry]);

  return { ...state, ran, run, cancel, reset };
}
