import { useEffect, useRef, useState } from "react";
import type { Scenario, SimResult, Snapshot } from "@grimstat/schema";
import { simClient } from "../worker/client";
import type { I18nKey } from "../i18n";

/**
 * Why the scenario cannot run at all: nothing to attack with, nothing to attack, or weapons of the
 * kind the chosen phase does not use.
 */
export type IdleReason = "no-weapons" | "no-models" | "melee-only" | "ranged-only";

/** What the screen says about each reason. The dock and the Play screen both read it from here. */
export const IDLE_MESSAGE: Record<IdleReason, I18nKey> = {
  "no-weapons": "dock.idle.noWeapons",
  "no-models": "dock.idle.noModels",
  "melee-only": "dock.idle.meleeOnly",
  "ranged-only": "dock.idle.rangedOnly",
};

export interface SimulationState {
  result: SimResult | undefined;
  running: boolean;
  error: string | undefined;
  elapsedMs: number | undefined;
  /** Scenario revision the current result belongs to. */
  resultFor: string | undefined;
  /** True from the moment an input changes until the worker's answer for it lands. */
  stale: boolean;
  /** Set while the scenario is missing what a run needs, which means nothing is computing. */
  idle: IdleReason | undefined;
}

export function idleReason(s: Scenario): IdleReason | undefined {
  const live = s.attacker.weapons.filter((w) => w.enabled && w.count > 0);
  if (!live.length) return "no-weapons";
  if (!s.defender.models.some((m) => m.count > 0)) return "no-models";
  // The engine resolves only the weapons the phase uses, so an attacker holding nothing of that
  // kind has no attacks to make. Without this the screen answered a melee profile in the shooting
  // phase with a flat 0.0 and said nothing about the phase.
  const kind = s.context.phase === "fight" ? "melee" : "ranged";
  if (!live.some((w) => w.kind === kind)) return kind === "melee" ? "ranged-only" : "melee-only";
  return undefined;
}

const DEBOUNCE_MS = 150;

/**
 * How many times a request that came back without an answer is put again.
 *
 * The worker client is shared and answers only whoever asked last, so a run can be cut across by
 * another consumer on the same screen — the what-if widget evaluates its variants on a timer of its
 * own. Asking again turns that into a short wait; without it the edit never gets a result at all.
 */
const SUPERSEDED_RETRIES = 4;

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
        for (let attempt = 0; ; attempt++) {
          const { seq, outcome } = await simClient().run(latestScenario.current, snapshot);
          if (cancelled) return;
          if (outcome && seq === simClient().latest) {
            setState({ result: outcome.result, running: false, error: undefined, elapsedMs: outcome.elapsedMs, resultFor: fp });
            return;
          }
          // No answer: someone else took the worker mid-flight. After a few goes, give up and let
          // the state say so, rather than leaving the dock computing over the old numbers.
          if (attempt >= SUPERSEDED_RETRIES) {
            setState((s) => ({ ...s, running: false }));
            return;
          }
        }
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
