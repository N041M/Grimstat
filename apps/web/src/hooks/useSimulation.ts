import { useEffect, useRef, useState } from "react";
import type { Scenario, SimResult, Snapshot } from "@grimstat/schema";
import { simClient } from "../worker/client";

/** Why the scenario cannot run at all: nothing to attack with, or nothing to attack. */
export type IdleReason = "no-weapons" | "no-models";

export interface SimulationState {
  result: SimResult | undefined;
  running: boolean;
  error: string | undefined;
  elapsedMs: number | undefined;
  /** Scenario revision the current result belongs to. */
  resultFor: string | undefined;
  /** True from the moment an input changes until the worker's answer for it lands. */
  stale: boolean;
  /** Set while the scenario is missing what a run needs; nothing is computing then. */
  idle: IdleReason | undefined;
}

export function idleReason(s: Scenario): IdleReason | undefined {
  if (!s.attacker.weapons.some((w) => w.enabled && w.count > 0)) return "no-weapons";
  if (!s.defender.models.some((m) => m.count > 0)) return "no-models";
  return undefined;
}

const DEBOUNCE_MS = 150;

function fingerprint(s: Scenario): string {
  // Only fields that influence the result; name/timestamps excluded.
  return JSON.stringify([s.attacker, s.defender, s.context, s.enabledToggles, s.extraEffects, s.snapshotId, s.gameSystemId]);
}

/**
 * Runs `scenario` in the simulation worker (via Comlink), debounced 150 ms, with stale-run
 * cancellation: only the most recent request's result is ever surfaced.
 */
export function useSimulation(scenario: Scenario, snapshot: Snapshot | undefined): SimulationState {
  const [state, setState] = useState<Omit<SimulationState, "stale" | "idle">>({ result: undefined, running: false, error: undefined, elapsedMs: undefined, resultFor: undefined });
  const fp = fingerprint(scenario);
  const idle = idleReason(scenario);
  const latestScenario = useRef(scenario);
  latestScenario.current = scenario;

  useEffect(() => {
    let cancelled = false;
    if (idleReason(scenario)) {
      setState((s) => ({ ...s, running: false, result: undefined, error: undefined, resultFor: fp }));
      return;
    }
    const handle = window.setTimeout(async () => {
      setState((s) => ({ ...s, running: true, error: undefined }));
      try {
        const { seq, outcome } = await simClient().run(latestScenario.current, snapshot);
        if (cancelled || !outcome || seq !== simClient().latest) return;
        setState({ result: outcome.result, running: false, error: undefined, elapsedMs: outcome.elapsedMs, resultFor: fp });
      } catch (e) {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : String(e);
        setState((s) => ({ ...s, running: false, error: msg, resultFor: fp }));
      }
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
    // fp captures every result-relevant field of the scenario; snapshot identity by reference.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fp, snapshot]);

  // Stale covers the debounce window too, so the shell's solve dot reacts to the first keystroke.
  // An idle scenario is never stale: there is nothing pending for it.
  return { ...state, idle, stale: !idle && (state.running || state.resultFor !== fp) };
}
