import { useEffect, useMemo, useRef, useState } from "react";
import type { Snapshot } from "@grimstat/schema";
import { useApp } from "../../state/AppContext";
import { simClient } from "../../worker/client";
import { useWorkerTask } from "../../hooks/useWorkerTask";
import { useUnitSet } from "../../hooks/useUnitSet";
import { usePersistedSetting } from "../../hooks/usePersistedSetting";
import { DEFAULT_TURN_OPTIONS, OPTION_AUTO, TURN_OBJECTIVES, type TurnAssignment, type TurnObjective, type TurnOption, type TurnPlanInput, type TurnPlanResult, type TurnPlanStep } from "../../lib/turn";
import { modelCount } from "../../lib/scenario";
import { UNIT_SET_KEYS, type UnitEntry } from "../../lib/unitSet";
import { fmt, fmtInt, pct } from "../../lib/format";
import { UnitSetPicker } from "./UnitSetPicker";
import { AnalysisContextControls, DEFAULT_ANALYSIS_CONTEXT, RunActions, RunStatus, WarningList, parseAnalysisContext, useAnalysisHeader, type AnalysisContext } from "./shared";
import { BarChart } from "../charts/BarChart";
import { Badge, Field, Spinner } from "../ui";
import { t } from "../../i18n";

interface TurnOptions {
  cpBudget: number;
  objective: TurnObjective;
  context: AnalysisContext;
}

const DEFAULT_OPTIONS: TurnOptions = { cpBudget: 3, objective: "points", context: DEFAULT_ANALYSIS_CONTEXT };

function parseOptions(raw: unknown): TurnOptions | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Partial<Record<keyof TurnOptions, unknown>>;
  const cp = typeof r.cpBudget === "number" && Number.isFinite(r.cpBudget) ? Math.max(0, Math.floor(r.cpBudget)) : 3;
  const objective = TURN_OBJECTIVES.find((o) => o === r.objective) ?? "points";
  return { cpBudget: cp, objective, context: parseAnalysisContext(r.context) };
}

type PlanInput = Omit<TurnPlanInput, "snapshot">;

/** Display data for a plan: names, points and option lists keyed by the ids used in the result. */
export interface TurnPlanView {
  attackers: Array<{ id: string; name: string; points?: number }>;
  targets: Array<{ id: string; name: string; points?: number; models: number; weight: number }>;
  options: TurnOption[];
}

export function objectiveLabel(o: TurnObjective): string {
  return o === "points" ? t("analyses.turn.objective.points") : o === "kills" ? t("analyses.turn.objective.kills") : t("analyses.turn.objective.damage");
}

export function optionLabel(id: string | undefined, options: TurnOption[]): string {
  if (!id || id === "none") return options.find((o) => o.id === "none")?.label ?? t("analyses.turn.noStratagem");
  return options.find((o) => o.id === id)?.label ?? id;
}

/** Option label with its CP cost, unless the label already states it. */
export function optionDisplay(o: TurnOption): string {
  return o.cp && !/\bCP\b/i.test(o.label) ? `${o.label} (${o.cp} CP)` : o.label;
}

function optionsFor(optionId: string | undefined): TurnOption[] {
  if (!optionId || optionId === OPTION_AUTO) return DEFAULT_TURN_OPTIONS;
  const o = DEFAULT_TURN_OPTIONS.find((x) => x.id === optionId);
  return o ? [o] : DEFAULT_TURN_OPTIONS.filter((x) => x.cp === 0);
}

function buildInputs(attackers: UnitEntry[], targets: UnitEntry[], opts: TurnOptions): { optimise: PlanInput; evaluate: PlanInput; view: TurnPlanView } {
  const base = {
    targets: targets.map((e) => ({ id: e.id, unit: e.unit, weight: e.weight ?? 1 })),
    context: opts.context,
    cpBudget: opts.cpBudget,
    objective: opts.objective,
  };
  return {
    optimise: { ...base, attackers: attackers.map((e) => ({ id: e.id, unit: e.unit, options: optionsFor(e.optionId) })) },
    // manual overrides may pick any option, so evaluation sees the whole list
    evaluate: { ...base, attackers: attackers.map((e) => ({ id: e.id, unit: e.unit, options: DEFAULT_TURN_OPTIONS })) },
    view: {
      attackers: attackers.map((e) => ({ id: e.id, name: e.unit.name, ...(e.unit.points !== undefined ? { points: e.unit.points } : {}) })),
      targets: targets.map((e) => ({ id: e.id, name: e.unit.name, models: modelCount(e.unit), weight: e.weight ?? 1, ...(e.unit.points !== undefined ? { points: e.unit.points } : {}) })),
      options: DEFAULT_TURN_OPTIONS,
    },
  };
}

const runOptimise = (input: PlanInput, snapshot: Snapshot | undefined) => simClient().optimiseTurn(input, snapshot);
const runEvaluate = (input: PlanInput, plan: TurnPlanStep[], snapshot: Snapshot | undefined) => simClient().evaluateTurnPlan(input, plan, snapshot);

const fingerprint = (a: UnitEntry[], d: UnitEntry[], o: TurnOptions) => JSON.stringify([a.map((e) => [e.id, e.optionId]), d.map((e) => [e.id, e.weight]), o]);

export function isApproximate(result: TurnPlanResult): boolean {
  return result.warnings.some((w) => /monte carlo|fell back|fallback|approximat/i.test(w));
}

function stepsOf(result: TurnPlanResult): TurnPlanStep[] {
  return [...result.assignments].sort((a, b) => a.order - b.order).map((a) => ({ attackerId: a.attackerId, targetId: a.targetId, ...(a.optionId ? { optionId: a.optionId } : {}) }));
}

export function TurnPlanTable({ result, view, onChange }: { result: TurnPlanResult; view: TurnPlanView; onChange?: (index: number, patch: Partial<TurnPlanStep>) => void }) {
  const rows = useMemo(() => [...result.assignments].sort((a, b) => a.order - b.order), [result]);
  const name = (list: Array<{ id: string; name: string }>, id: string) => list.find((x) => x.id === id)?.name ?? id;
  if (!rows.length) return <div className="empty">{t("analyses.turn.noPlan")}</div>;
  return (
    <div className="table-wrap">
      <table className="data plan-table">
        <thead>
          <tr>
            <th className="num">{t("analyses.turn.order")}</th>
            <th>{t("side.attacker")}</th>
            <th>{t("analyses.turn.target")}</th>
            <th>{t("analyses.turn.stratagem")}</th>
            <th className="num">{t("analyses.metric.damage")}</th>
            <th className="num">{t("analyses.metric.slain")}</th>
            <th className="num">{t("analyses.turn.pDeadAfter")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((a: TurnAssignment, i) => (
            <tr key={`${a.order}-${a.attackerId}`}>
              <td className="num">{i + 1}</td>
              <td>{name(view.attackers, a.attackerId)}</td>
              <td>
                {onChange ? (
                  <select value={a.targetId} aria-label={t("analyses.turn.targetFor", { name: name(view.attackers, a.attackerId) })} onChange={(e) => onChange(i, { targetId: e.target.value })}>
                    {view.targets.map((tg) => (
                      <option key={tg.id} value={tg.id}>
                        {tg.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  name(view.targets, a.targetId)
                )}
              </td>
              <td>
                {onChange ? (
                  <select value={a.optionId ?? "none"} aria-label={t("analyses.turn.stratagemFor", { name: name(view.attackers, a.attackerId) })} onChange={(e) => onChange(i, { optionId: e.target.value })}>
                    {view.options.map((o) => (
                      <option key={o.id} value={o.id}>
                        {optionDisplay(o)}
                      </option>
                    ))}
                  </select>
                ) : (
                  optionLabel(a.optionId, view.options)
                )}
              </td>
              <td className="num">{fmt(a.expectedDamage)}</td>
              <td className="num">{fmt(a.expectedSlain)}</td>
              <td className="num">{pct(a.pKillAfter)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function TurnTargetCards({ result, view }: { result: TurnPlanResult; view: TurnPlanView }) {
  if (!result.targets.length) return <div className="empty">{t("analyses.turn.noPlan")}</div>;
  return (
    <div className="tiles target-cards">
      {result.targets.map((o) => {
        const tg = view.targets.find((x) => x.id === o.targetId);
        return (
          <div key={o.targetId} className="tile">
            <div className="k" title={tg?.name}>
              {tg?.name ?? o.targetId}
              {tg?.points !== undefined ? <span className="muted"> · {t("unit.points", { v: fmtInt(tg.points) })}</span> : null}
              {tg && tg.weight !== 1 ? <span className="muted"> · ×{fmt(tg.weight, 1)}</span> : null}
            </div>
            <div className="v">
              {fmt(o.expectedSlain, 1)}
              {tg ? <span className="sub"> / {tg.models}</span> : null}
            </div>
            <div className="sub">{t("analyses.turn.card.pKill", { v: pct(o.pKill) })}</div>
            <div className="sub">{t("analyses.turn.card.points", { v: fmt(o.expectedPointsSlain, 1) })}</div>
            <div className="sub">{t("analyses.turn.card.wasted", { v: fmt(o.expectedWasted, 1) })}</div>
          </div>
        );
      })}
    </div>
  );
}

export function TurnTotals({ result }: { result: TurnPlanResult }) {
  const cp = result.cpBudget !== undefined ? `${result.cpSpent} / ${result.cpBudget}` : String(result.cpSpent);
  return (
    <div className="tiles">
      <div className="tile">
        <div className="k">{t("summary.pointsSlain")}</div>
        <div className="v">{fmt(result.totalExpectedPoints, 1)}</div>
      </div>
      <div className="tile">
        <div className="k">{t("summary.expectedSlain")}</div>
        <div className="v">{fmt(result.totalExpectedSlain, 1)}</div>
      </div>
      <div className="tile">
        <div className="k">{t("summary.expectedDamage")}</div>
        <div className="v">{fmt(result.totalExpectedDamage, 1)}</div>
      </div>
      <div className="tile">
        <div className="k">{t("summary.wasted")}</div>
        <div className="v">{fmt(result.totalExpectedWasted, 1)}</div>
      </div>
      <div className="tile">
        <div className="k">{t("analyses.turn.cpSpent")}</div>
        <div className="v">{cp}</div>
      </div>
      <div className="tile">
        <div className="k">{t("analyses.turn.score", { objective: objectiveLabel(result.objective) })}</div>
        <div className="v">{fmt(result.score)}</div>
        <div className="sub">{t("analyses.turn.evaluations", { n: fmtInt(result.evaluations) })}</div>
      </div>
    </div>
  );
}

export function TurnSlainChart({ result }: { result: TurnPlanResult }) {
  const pmf = result.slainPMF;
  if (pmf.length <= 1) return <div className="empty">{t("analyses.turn.noPlan")}</div>;
  return (
    <div className="chart-wrap" style={{ minHeight: 220 }}>
      <BarChart values={pmf} marker={result.totalExpectedSlain} markerLabel={t("chart.mean", { v: fmt(result.totalExpectedSlain) })} maxIndex={Math.max(1, pmf.length - 1)} xLabel={t("analyses.turn.slainTotal")} yLabel={t("chart.probability")} ariaLabel={t("analyses.turn.slainAria")} tooltip={(k) => [t("chart.slain.k", { k }), `P(X = ${k}) = ${pct(pmf[k] ?? 0, 2)}`]} />
    </div>
  );
}

export function TurnTab() {
  const { snapshot } = useApp();
  const attackers = useUnitSet("analyses.turn.attackers");
  const targets = useUnitSet("analyses.turn.targets");
  const [opts, setOpts] = usePersistedSetting<TurnOptions>("analyses.turn.options", DEFAULT_OPTIONS, parseOptions);
  const optimise = useWorkerTask(runOptimise, "analyses.turn");
  const evaluate = useWorkerTask(runEvaluate, "analyses.turn.evaluate");
  const [ran, setRan] = useState<{ evaluate: PlanInput; view: TurnPlanView; fp: string } | undefined>(undefined);
  const [plan, setPlan] = useState<TurnPlanStep[] | undefined>(undefined);

  const baseline = optimise.result;
  useEffect(() => {
    setPlan(baseline ? stepsOf(baseline) : undefined);
    evaluate.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseline]);

  const canRun = attackers.entries.length > 0 && targets.entries.length > 0;
  const dirty = !!ran && ran.fp !== fingerprint(attackers.entries, targets.entries, opts);

  const run = () => {
    if (!canRun) return;
    const built = buildInputs(attackers.entries, targets.entries, opts);
    setRan({ evaluate: built.evaluate, view: built.view, fp: fingerprint(attackers.entries, targets.entries, opts) });
    optimise.run(built.optimise, snapshot);
  };

  const overridden = !!baseline && !!plan && JSON.stringify(plan) !== JSON.stringify(stepsOf(baseline));
  const current = overridden && evaluate.result ? evaluate.result : baseline;
  const delta = overridden && evaluate.result && baseline ? evaluate.result.score - baseline.score : undefined;

  const changeStep = (index: number, patch: Partial<TurnPlanStep>) => {
    if (!plan || !ran) return;
    const next = plan.map((s, i) => (i === index ? { ...s, ...patch } : s));
    setPlan(next);
    evaluate.run(ran.evaluate, next, snapshot);
  };
  const resetPlan = () => {
    if (!baseline) return;
    setPlan(stepsOf(baseline));
    evaluate.reset();
  };

  // Header actions call through a ref so they never run against a stale closure.
  const handlers = useRef({ run, cancel: optimise.cancel });
  handlers.current = { run, cancel: optimise.cancel };
  useAnalysisHeader(
    () => ({
      subtitle: t("analyses.turn.sub", { a: attackers.entries.length, t: targets.entries.length, cp: opts.cpBudget }),
      actions: <RunActions canRun={canRun} running={optimise.running} onRun={() => handlers.current.run()} onCancel={() => handlers.current.cancel()} runLabel={t("analyses.turn.run")} />,
    }),
    [canRun, optimise.running, attackers.entries.length, targets.entries.length, opts.cpBudget],
  );

  return (
    <div className="analysis">
      <aside className="analysis-controls stack">
        <section className="panel">
          <UnitSetPicker
            label={t("analyses.set.attackers")}
            storageKey={UNIT_SET_KEYS.turnAttackers}
            entries={attackers.entries}
            onChange={attackers.setEntries}
            archetypeFilter="attackers"
            renderExtra={(e, update) => (
              <label className="inline small">
                <span className="muted">{t("analyses.turn.stratagem")}</span>
                <select value={e.optionId ?? OPTION_AUTO} aria-label={t("analyses.turn.stratagemFor", { name: e.unit.name })} onChange={(ev) => update({ optionId: ev.target.value })}>
                  <option value={OPTION_AUTO}>{t("analyses.turn.optionAuto")}</option>
                  {DEFAULT_TURN_OPTIONS.map((o) => (
                    <option key={o.id} value={o.id}>
                      {optionDisplay(o)}
                    </option>
                  ))}
                </select>
              </label>
            )}
          />
        </section>
        <section className="panel">
          <UnitSetPicker
            label={t("analyses.set.targets")}
            storageKey={UNIT_SET_KEYS.turnTargets}
            entries={targets.entries}
            onChange={targets.setEntries}
            renderExtra={(e, update) => (
              <label className="inline small">
                <span className="muted">{t("analyses.turn.weight")}</span>
                <input type="number" min={0.5} max={3} step={0.1} value={e.weight ?? 1} aria-label={t("analyses.turn.weightFor", { name: e.unit.name })} onChange={(ev) => update({ weight: Math.max(0.5, Math.min(3, Number(ev.target.value) || 1)) })} />
              </label>
            )}
          />
        </section>
        <section className="panel stack" aria-labelledby="turn-opt-h">
          <h3 id="turn-opt-h" style={{ margin: 0 }}>
            {t("analyses.turn.settings")}
          </h3>
          <div className="field-row">
            <Field label={t("analyses.turn.cpBudget")} hint={t("analyses.turn.cpHint")}>
              <input type="number" min={0} max={30} step={1} value={opts.cpBudget} onChange={(e) => setOpts((o) => ({ ...o, cpBudget: Math.max(0, Math.floor(Number(e.target.value) || 0)) }))} />
            </Field>
            <Field label={t("analyses.turn.objective")}>
              <select value={opts.objective} onChange={(e) => setOpts((o) => ({ ...o, objective: TURN_OBJECTIVES.find((x) => x === e.target.value) ?? "points" }))}>
                {TURN_OBJECTIVES.map((o) => (
                  <option key={o} value={o}>
                    {objectiveLabel(o)}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <AnalysisContextControls value={opts.context} onChange={(context) => setOpts((o) => ({ ...o, context }))} fields={["rangeBand", "phase"]} />
        </section>
      </aside>
      <section className="analysis-results stack">
        <RunStatus task={optimise} stale={dirty} />
        {current && ran && baseline ? (
          <>
            {isApproximate(current) ? <Badge tone="warn">{t("analyses.turn.approximate")}</Badge> : null}
            <WarningList warnings={current.warnings} />
            <div className="row between">
              <h3 style={{ margin: 0 }}>{t("analyses.turn.plan")}</h3>
              <span className="row">
                {evaluate.running ? <Spinner label={t("analyses.turn.rescoring")} /> : null}
                {delta !== undefined ? (
                  <Badge tone={delta > 1e-9 ? "ok" : delta < -1e-9 ? "danger" : undefined}>
                    {t("analyses.turn.delta", { v: `${delta >= 0 ? "+" : ""}${fmt(delta)}` })}
                  </Badge>
                ) : null}
                {overridden ? (
                  <button type="button" className="sm" onClick={resetPlan}>
                    {t("analyses.turn.resetPlan")}
                  </button>
                ) : null}
              </span>
            </div>
            <TurnPlanTable result={current} view={ran.view} onChange={changeStep} />
            <p className="small muted">{t("analyses.turn.overrideHint")}</p>
            <h3 style={{ margin: 0 }}>{t("analyses.turn.totals")}</h3>
            <TurnTotals result={current} />
            <h3 style={{ margin: 0 }}>{t("analyses.turn.targets")}</h3>
            <TurnTargetCards result={current} view={ran.view} />
            <h3 style={{ margin: 0 }}>{t("analyses.turn.slainTitle")}</h3>
            <TurnSlainChart result={current} />
          </>
        ) : (
          <div className="empty">{canRun ? t("analyses.turn.ready") : t("analyses.turn.needBoth")}</div>
        )}
      </section>
    </div>
  );
}
