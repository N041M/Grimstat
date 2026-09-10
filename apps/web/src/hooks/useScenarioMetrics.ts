import { useEffect, useMemo, useRef, useState } from "react";
import type { Scenario, Snapshot } from "@grimstat/schema";
import { simClient } from "../worker/client";
import type { RowMetrics } from "../lib/scenarioTable";

/** Stored scenarios carry no cached result, so the table's numbers are solved on demand. */
export interface ScenarioMetricsState {
  get(s: Scenario): RowMetrics | undefined;
  /** How many rows are still waiting for the worker. */
  pending: number;
}

/** Cache key: a scenario only needs re-solving when its content changes. */
function keyOf(s: Scenario): string {
  return `${s.id}:${s.revision}:${s.updatedAt}`;
}

function metricsFrom(r: { expectedDamage: number; pKill: number; damagePerPoint?: number | undefined; attackerPoints?: number | undefined }): RowMetrics {
  const perPoint = r.damagePerPoint ?? (r.attackerPoints ? r.expectedDamage / r.attackerPoints : undefined);
  return { expectedDamage: r.expectedDamage, pKill: r.pKill, per100: perPoint === undefined ? undefined : perPoint * 100 };
}

/** Give the table a frame to paint before the first solve starts. */
const START_DELAY_MS = 60;

/**
 * Solve every listed scenario in the simulation worker, one at a time, and hand the results back by
 * scenario. The batch is cancellable — unmounting or a changed list stops it — and never blocks the
 * render: rows show "—" until their number arrives.
 */
export function useScenarioMetrics(items: Scenario[] | undefined, snapshot: Snapshot | undefined, activeSnapshotId: string | undefined): ScenarioMetricsState {
  // null marks "tried and failed" so a broken scenario is not retried on every render.
  const cache = useRef(new Map<string, RowMetrics | null>());
  const [version, bump] = useState(0);
  const [pending, setPending] = useState(0);

  useEffect(() => {
    if (!items || items.length === 0) {
      setPending(0);
      return;
    }
    let cancelled = false;
    const todo = items.filter((s) => !cache.current.has(keyOf(s)));
    setPending(todo.length);
    const timer = window.setTimeout(() => {
      void (async () => {
        for (const s of todo) {
          if (cancelled) return;
          const key = keyOf(s);
          try {
            // Scenarios store their unit stats inline, so only the active snapshot is worth shipping.
            const snap = s.snapshotId && s.snapshotId === activeSnapshotId ? snapshot : undefined;
            const { outcome } = await simClient().run(s, snap);
            if (cancelled) return;
            cache.current.set(key, outcome ? metricsFrom(outcome.result) : null);
          } catch {
            if (cancelled) return;
            cache.current.set(key, null);
          }
          setPending((n) => Math.max(0, n - 1));
          bump((n) => n + 1);
          // Yield between runs so typing in the filter stays responsive.
          await new Promise((r) => window.setTimeout(r, 0));
        }
      })();
    }, START_DELAY_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [items, snapshot, activeSnapshotId]);

  // Identity only changes when a result lands, so the table's sort/filter memo can depend on it.
  return useMemo(
    () => ({
      get: (s: Scenario) => cache.current.get(keyOf(s)) ?? undefined,
      pending,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `version` is the memo-buster: it is bumped when a result lands in the ref cache.
    [version, pending],
  );
}
