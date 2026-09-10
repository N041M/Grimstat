import { useEffect, useMemo, useRef, useState } from "react";
import type { Scenario, ScenarioContext, Snapshot } from "@grimstat/schema";
import { defineWidget, type WidgetProps } from "./registry";
import { useApp } from "../state/AppContext";
import { simClient } from "../worker/client";
import { useWorkerTask } from "../hooks/useWorkerTask";
import { listToggles } from "@grimstat/game-40k-11e";
import { defaultContext, isToggleOn, setToggle } from "../lib/scenario";
import { SENSITIVITY_VARIANTS, type SensitivityVariant, type SensitivityVariantDef } from "../lib/gameExtras";
import { fmt, pct } from "../lib/format";
import { HBarChart, type HBarRow } from "../components/charts/HBarChart";
import { Empty, Spinner } from "../components/ui";
import { t } from "../i18n";

/** Delay after the main result before the variants are evaluated (editing bursts only pay once). */
const DEBOUNCE_MS = 400;

function variantDef(id: string): SensitivityVariantDef | undefined {
  return SENSITIVITY_VARIANTS.find((v) => v.id === id);
}

/** Is this variant already part of the scenario (its context fields set / its toggles on)? */
export function variantActive(scenario: Scenario, id: string, snapshot: Snapshot | undefined): boolean {
  const def = variantDef(id);
  const ctx = def?.context ?? {};
  for (const [k, v] of Object.entries(ctx)) if (scenario.context[k as keyof ScenarioContext] !== v) return false;
  const ids = def?.toggles ?? (def ? [] : [id]);
  if (!ids.length) return Object.keys(ctx).length > 0;
  const toggles = listToggles(scenario, snapshot);
  return ids.every((tid) => {
    const toggle = toggles.find((x) => x.id === tid);
    return toggle ? isToggleOn(toggle, scenario.enabledToggles) : scenario.enabledToggles.includes(tid);
  });
}

/** Apply (on) or remove (off) a variant: its context fields are set / reset to defaults, its toggles switched. */
export function applyVariant(scenario: Scenario, id: string, on: boolean, snapshot: Snapshot | undefined): Scenario {
  const def = variantDef(id);
  let next = scenario;
  const ctx = def?.context ?? {};
  if (Object.keys(ctx).length) {
    const defaults = defaultContext();
    const patch: Partial<ScenarioContext> = {};
    for (const k of Object.keys(ctx) as Array<keyof ScenarioContext>) (patch as Record<string, unknown>)[k] = on ? ctx[k] : defaults[k];
    next = { ...next, context: { ...next.context, ...patch } };
  }
  const ids = def?.toggles ?? (def ? [] : [id]);
  if (ids.length) {
    const toggles = listToggles(next, snapshot);
    let enabled = next.enabledToggles;
    for (const tid of ids) {
      const toggle = toggles.find((x) => x.id === tid);
      if (toggle) enabled = setToggle(enabled, toggle, on);
      else {
        enabled = enabled.filter((x) => x !== tid && x !== `-${tid}`);
        if (on) enabled = [...enabled, tid];
      }
    }
    next = { ...next, enabledToggles: enabled };
  }
  return next;
}

const runSensitivity = (scenario: Scenario, snapshot: Snapshot | undefined) => simClient().sensitivity(scenario, undefined, snapshot);

function fingerprint(s: Scenario): string {
  return JSON.stringify([s.attacker, s.defender, s.context, s.enabledToggles, s.extraEffects, s.snapshotId, s.gameSystemId]);
}

function signedDisplay(v: number, f: (x: number) => string): string {
  return `${v > 0 ? "+" : ""}${f(v)}`;
}

export function WhatIf({ scenario, result, snapshot, running }: WidgetProps) {
  const { updateScenario, notify } = useApp();
  const task = useWorkerTask(runSensitivity);
  const [ranFor, setRanFor] = useState<string | undefined>(undefined);
  const latest = useRef({ scenario, snapshot });
  latest.current = { scenario, snapshot };
  const fp = fingerprint(scenario);

  // Evaluate the variants once the main result has settled; a newer main run supersedes an in-flight evaluation.
  useEffect(() => {
    if (!result) return;
    const handle = window.setTimeout(() => {
      const cur = latest.current;
      setRanFor(fingerprint(cur.scenario));
      task.run(cur.scenario, cur.snapshot);
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);

  const active = useMemo(() => new Set((task.result?.variants ?? []).filter((v) => variantActive(scenario, v.id, snapshot)).map((v) => v.id)), [task.result, scenario, snapshot]);

  const select = (id: string) => {
    const v = task.result?.variants.find((x) => x.id === id);
    if (!v) return;
    const on = !active.has(id);
    updateScenario((s) => applyVariant(s, id, on, snapshot));
    notify(t(on ? "whatIf.applied" : "whatIf.removed", { label: v.label }), "success");
  };

  if (!result) return <Empty>{running ? t("results.running") : t("results.none")}</Empty>;
  if (!task.result) return <Empty>{task.error ? task.error : task.running ? t("whatIf.running") : t("whatIf.waiting")}</Empty>;

  const stale = ranFor !== fp;
  const rows = (side: SensitivityVariant["side"]): HBarRow[] =>
    task.result!.variants
      .filter((v) => v.side === side)
      .map((v) => ({
        key: v.id,
        label: v.label,
        value: v.deltaDamage,
        display: signedDisplay(v.deltaDamage, (x) => fmt(x)),
        tone: v.deltaDamage < -1e-9 ? "danger" : v.deltaDamage > 1e-9 ? "ok" : "info",
        pressed: active.has(v.id),
        actionLabel: t(active.has(v.id) ? "whatIf.remove" : "whatIf.apply", { label: v.label }),
        title: `${v.label}: ${t("whatIf.deltaDamage")} ${signedDisplay(v.deltaDamage, (x) => fmt(x))} · ${t("whatIf.deltaSlain")} ${signedDisplay(v.deltaSlain, (x) => fmt(x))} · ${t("whatIf.deltaPKill")} ${signedDisplay(v.deltaPKill, (x) => pct(x))}`,
      }));
  const max = task.result.variants.reduce((m, v) => Math.max(m, Math.abs(v.deltaDamage)), 0);
  const attackerRows = rows("attacker");
  const defenderRows = rows("defender");
  if (!attackerRows.length && !defenderRows.length) return <Empty>{t("whatIf.none")}</Empty>;

  return (
    <div className="stack">
      <div className="row between small">
        <span className="muted">{t("whatIf.base", { d: fmt(task.result.base.expectedDamage), s: fmt(task.result.base.expectedSlain), p: pct(task.result.base.pKill) })}</span>
        {task.running || stale ? <Spinner label={t(task.running ? "whatIf.running" : "whatIf.stale")} /> : null}
      </div>
      <div className="grid-2 grid-fold">
        {attackerRows.length ? (
          <div>
            <h4 className="chart-h">{t("whatIf.attacker")}</h4>
            <HBarChart signed max={max} ariaLabel={`${t("whatIf.chartAria")} — ${t("whatIf.attacker")}`} rows={attackerRows} onSelect={select} />
          </div>
        ) : null}
        {defenderRows.length ? (
          <div>
            <h4 className="chart-h">{t("whatIf.defender")}</h4>
            <HBarChart signed max={max} ariaLabel={`${t("whatIf.chartAria")} — ${t("whatIf.defender")}`} rows={defenderRows} onSelect={select} />
          </div>
        ) : null}
      </div>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>{t("whatIf.variant")}</th>
              <th className="num">{t("whatIf.deltaDamage")}</th>
              <th className="num">{t("whatIf.deltaSlain")}</th>
              <th className="num">{t("whatIf.deltaPKill")}</th>
            </tr>
          </thead>
          <tbody>
            {task.result.variants.map((v) => (
              <tr key={v.id} className={active.has(v.id) ? "row-best" : undefined}>
                <td className="wrap">
                  <button type="button" className="ghost sm" aria-pressed={active.has(v.id)} onClick={() => select(v.id)}>
                    {v.label}
                  </button>
                  {active.has(v.id) ? <span className="badge accent">{t("whatIf.active")}</span> : null}
                  <span className="muted small"> · {v.side === "attacker" ? t("side.attacker") : t("side.defender")}</span>
                </td>
                <td className="num">{signedDisplay(v.deltaDamage, (x) => fmt(x))}</td>
                <td className="num">{signedDisplay(v.deltaSlain, (x) => fmt(x))}</td>
                <td className="num">{signedDisplay(v.deltaPKill, (x) => pct(x))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="small muted" style={{ margin: 0 }}>
        {t("whatIf.hint")}
      </p>
    </div>
  );
}

export const whatIfWidget = defineWidget({
  id: "core.what-if",
  title: t("widget.whatIf"),
  description: t("widget.whatIf.desc"),
  inputs: ["scenario", "result", "snapshot"],
  defaultSize: { w: 6, h: 9 },
  minSize: { w: 6, h: 6 },
  render: WhatIf,
});
