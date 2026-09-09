import { useCallback, useEffect, useRef, useState } from "react";
import type { Sequenced } from "../worker/client";
import type { Timed } from "../worker/sim.worker";

export interface TaskState<T> {
  result: T | undefined;
  running: boolean;
  error: string | undefined;
  elapsedMs: number | undefined;
}

export interface WorkerTask<A extends unknown[], T> extends TaskState<T> {
  /** Start (or restart) the task; a newer call supersedes an older one whose result is then dropped. */
  run: (...args: A) => void;
  reset: () => void;
}

const IDLE = { result: undefined, running: false, error: undefined, elapsedMs: undefined };

/**
 * Runs an explicit (button-triggered) analysis in the simulation worker with the same stale-run
 * semantics as `useSimulation`: only the most recent request of this hook ever updates the state,
 * and a request superseded by any newer worker call is dropped silently.
 */
export function useWorkerTask<A extends unknown[], T>(fn: (...args: A) => Promise<Sequenced<Timed<T>>>): WorkerTask<A, T> {
  const [state, setState] = useState<TaskState<T>>(IDLE);
  const alive = useRef(true);
  const latest = useRef(0);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const run = useCallback(
    (...args: A) => {
      const mine = ++latest.current;
      setState((s) => ({ ...s, running: true, error: undefined }));
      void (async () => {
        try {
          const { outcome } = await fn(...args);
          if (!alive.current || mine !== latest.current) return;
          if (!outcome) {
            // superseded by a newer worker request elsewhere (e.g. the calculator); nothing to show
            setState((s) => ({ ...s, running: false }));
            return;
          }
          setState({ result: outcome.result, running: false, error: undefined, elapsedMs: outcome.elapsedMs });
        } catch (e) {
          if (!alive.current || mine !== latest.current) return;
          setState((s) => ({ ...s, running: false, error: e instanceof Error ? e.message : String(e) }));
        }
      })();
    },
    [fn],
  );

  const reset = useCallback(() => {
    latest.current++;
    setState(IDLE);
  }, []);

  return { ...state, run, reset };
}
