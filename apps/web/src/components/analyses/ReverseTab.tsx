import { useMemo, useRef, useState } from "react";
import type { ScenarioUnit, Snapshot } from "@grimstat/schema";
import { useApp } from "../../state/AppContext";
import { navigate } from "../../router";
import { simClient } from "../../worker/client";
import { useWorkerTask } from "../../hooks/useWorkerTask";
import { useUnitSet } from "../../hooks/useUnitSet";
import { usePersistedSetting } from "../../hooks/usePersistedSetting";
import { cloneUnit, modelCount } from "../../lib/scenario";
import { UNIT_SET_KEYS, type UnitEntry } from "../../lib/unitSet";
import type { ReverseInput, ReverseResult, ReverseRow } from "../../lib/gameExtras";
import { fmt, fmtInt, pct } from "../../lib/format";
import { download } from "../../lib/download";
import { reverseToCsv } from "../../lib/matrixCsv";
import { UnitSetPicker } from "./UnitSetPicker";
import { AnalysisContextControls, DEFAULT_ANALYSIS_CONTEXT, RunActions, RunStatus, WarningList, parseAnalysisContext, useAnalysisHeader, type AnalysisContext } from "./shared";
import { Badge, Field } from "../ui";
import { t } from "../../i18n";

type Metric = ReverseInput["metric"];
const METRICS: Metric[] = ["pKill", "expectedDamage", "expectedSlain"];

interface ReverseOptions {
  metric: Metric;
  /** null = the metric's default (0.8 for P(kill), the target's wounds / models otherwise). */
  threshold: number | null;
  maxCombo: number;
  context: AnalysisContext;
}

const DEFAULT_OPTIONS: ReverseOptions = { metric: "pKill", threshold: null, maxCombo: 2, context: DEFAULT_ANALYSIS_CONTEXT };
const SHOW_ROWS = 25;

function parseOptions(raw: unknown): ReverseOptions | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Partial<Record<keyof ReverseOptions, unknown>>;
  const metric = METRICS.find((m) => m === r.metric) ?? "pKill";
  const threshold = typeof r.threshold === "number" && Number.isFinite(r.threshold) ? r.threshold : null;
  const maxCombo = typeof r.maxCombo === "number" ? Math.max(1, Math.min(3, Math.floor(r.maxCombo))) : 2;
  return { metric, threshold, maxCombo, context: parseAnalysisContext(r.context) };
}

export function metricLabel(m: Metric): string {
  return m === "pKill" ? t("analyses.metric.pKill") : m === "expectedSlain" ? t("analyses.metric.slain") : t("analyses.metric.damage");
}

function metricDisplay(m: Metric, v: number): string {
  return m === "pKill" ? pct(v) : fmt(v);
}

/** The threshold used when the user has not typed one. */
export function defaultThreshold(metric: Metric, target: ScenarioUnit | undefined): number {
  if (metric === "pKill") return 0.8;
  if (!target) return 0;
  if (metric === "expectedSlain") return modelCount(target);
  return target.models.reduce((s, m) => s + m.count * m.W, 0);
}

const runReverse = (input: Omit<ReverseInput, "snapshot">, snapshot: Snapshot | undefined) => simClient().reverse(input, snapshot);

const fingerprint = (target: UnitEntry[], cands: UnitEntry[], o: ReverseOptions) => JSON.stringify([target.map((e) => e.id), cands.map((e) => e.id), o]);

export function ReverseTable({ result, metric, onOpen }: { result: ReverseResult; metric: Metric; onOpen?: (row: ReverseRow) => void }) {
  const [all, setAll] = useState(false);
  if (!result.rows.length) return <div className="empty">{t("analyses.reverse.none")}</div>;
  const rows = all ? result.rows : result.rows.slice(0, SHOW_ROWS);
  const isCheapest = (r: ReverseRow) => !!result.cheapest && r.candidateIds.join("|") === result.cheapest.candidateIds.join("|");
  return (
    <div className="stack">
      <div className="table-wrap">
        <table className="data reverse-table">
          <thead>
            <tr>
              <th className="num">{t("analyses.reverse.rank")}</th>
              <th>{t("analyses.reverse.units")}</th>
              <th className="num">{t("analyses.reverse.points")}</th>
              <th>{t("analyses.reverse.threshold")}</th>
              {METRICS.map((m) => (
                <th key={m} className={`num${m === metric ? " metric-col" : ""}`} aria-sort={m === metric ? "descending" : undefined}>
                  {metricLabel(m)}
                </th>
              ))}
              {onOpen ? <th /> : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const best = isCheapest(r);
              return (
                <tr key={r.candidateIds.join("|")} className={best ? "row-best" : undefined}>
                  <td className="num">{i + 1}</td>
                  <td className="wrap">
                    {r.names.join(" + ")}
                    {best ? (
                      <>
                        {" "}
                        <Badge tone="accent">{t("analyses.reverse.cheapest")}</Badge>
                      </>
                    ) : null}
                  </td>
                  <td className="num">{r.points ? fmtInt(r.points) : "–"}</td>
                  <td>{r.meets ? <Badge tone="ok">{t("analyses.reverse.meets")}</Badge> : <Badge tone="warn">{t("analyses.reverse.misses")}</Badge>}</td>
                  {METRICS.map((m) => {
                    const v = m === "pKill" ? r.pKill : m === "expectedSlain" ? r.expectedSlain : r.expectedDamage;
                    return (
                      <td key={m} className={`num${m === metric ? " metric-col" : ""}`}>
                        {m === metric ? <strong>{metricDisplay(m, v)}</strong> : metricDisplay(m, v)}
                      </td>
                    );
                  })}
                  {onOpen ? (
                    <td>
                      {r.candidateIds.length === 1 ? (
                        <button type="button" className="sm" onClick={() => onOpen(r)}>
                          {t("analyses.reverse.open")}
                        </button>
                      ) : null}
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {result.rows.length > SHOW_ROWS ? (
        <div className="row">
          <button type="button" className="sm" onClick={() => setAll((v) => !v)}>
            {all ? t("analyses.reverse.showFewer") : t("analyses.reverse.showAll", { n: result.rows.length })}
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function ReverseTab() {
  const { snapshot, scenario, activeSnapshotId, replaceScenario, notify } = useApp();
  const target = useUnitSet("analyses.reverse.target");
  const candidates = useUnitSet("analyses.reverse.candidates");
  const [opts, setOpts] = usePersistedSetting<ReverseOptions>("analyses.reverse.options", DEFAULT_OPTIONS, parseOptions);
  const task = useWorkerTask(runReverse, "analyses.reverse");
  const [ran, setRan] = useState<{ target: UnitEntry; candidates: UnitEntry[]; metric: Metric; threshold: number; fp: string } | undefined>(undefined);

  const unit = target.entries[0];
  const auto = defaultThreshold(opts.metric, unit?.unit);
  const threshold = opts.threshold ?? auto;
  const canRun = !!unit && candidates.entries.length > 0;
  const dirty = !!ran && ran.fp !== fingerprint(target.entries, candidates.entries, opts);

  const run = () => {
    if (!unit) return;
    setRan({ target: unit, candidates: candidates.entries, metric: opts.metric, threshold, fp: fingerprint(target.entries, candidates.entries, opts) });
    task.run({ target: unit.unit, candidates: candidates.entries.map((e) => ({ id: e.id, unit: e.unit })), metric: opts.metric, threshold, context: opts.context, maxCombo: opts.maxCombo, enabledToggles: [] }, snapshot);
  };

  const open = async (row: ReverseRow) => {
    const c = ran?.candidates.find((e) => e.id === row.candidateIds[0]);
    if (!c || !ran) return;
    await replaceScenario({ ...scenario, name: `${c.unit.name} vs ${ran.target.unit.name}`, attacker: cloneUnit(c.unit), defender: cloneUnit(ran.target.unit), context: { ...scenario.context, ...opts.context } }, activeSnapshotId);
    notify(t("analyses.reverse.opened", { a: c.unit.name, d: ran.target.unit.name }), "success");
    navigate("calculator");
  };

  const thresholdHint = useMemo(() => {
    if (opts.metric === "pKill") return t("analyses.reverse.thresholdHint.pKill");
    const v = unit ? fmtInt(defaultThreshold(opts.metric, unit.unit)) : "–";
    return opts.metric === "expectedSlain" ? t("analyses.reverse.thresholdHint.slain", { v }) : t("analyses.reverse.thresholdHint.damage", { v });
  }, [opts.metric, unit]);

  const meeting = task.result ? task.result.rows.filter((r) => r.meets).length : 0;

  const exportCsv = () => {
    if (!task.result) return;
    download(`grimstat-reverse-${new Date().toISOString().slice(0, 10)}.csv`, reverseToCsv(task.result), "text/csv");
  };

  // Header actions call through a ref so they never run against a stale closure.
  const handlers = useRef({ run, cancel: task.cancel, exportCsv });
  handlers.current = { run, cancel: task.cancel, exportCsv };
  const hasResult = !!task.result;
  useAnalysisHeader(
    () => ({
      subtitle: unit ? t("analyses.reverse.sub", { name: unit.unit.name, n: candidates.entries.length }) : t("analyses.reverse.subIdle"),
      actions: (
        <RunActions canRun={canRun} running={task.running} onRun={() => handlers.current.run()} onCancel={() => handlers.current.cancel()} runLabel={t("analyses.reverse.run")}>
          <button type="button" disabled={!hasResult} onClick={() => handlers.current.exportCsv()}>
            {t("analyses.exportCsv")}
          </button>
        </RunActions>
      ),
    }),
    [canRun, hasResult, task.running, unit?.unit.name, candidates.entries.length],
  );

  return (
    <div className="analysis">
      <aside className="analysis-controls stack">
        <section className="panel">
          <UnitSetPicker label={t("analyses.reverse.target")} storageKey={UNIT_SET_KEYS.reverseTarget} entries={target.entries} onChange={target.setEntries} single />
        </section>
        <section className="panel">
          <UnitSetPicker label={t("analyses.reverse.candidates")} storageKey={UNIT_SET_KEYS.reverseCandidates} entries={candidates.entries} onChange={candidates.setEntries} archetypeFilter="attackers" />
        </section>
        <section className="panel stack" aria-labelledby="rev-opt-h">
          <h3 id="rev-opt-h" style={{ margin: 0 }}>
            {t("analyses.reverse.settings")}
          </h3>
          <div className="field-row">
            <Field label={t("analyses.reverse.metric")}>
              <select value={opts.metric} onChange={(e) => setOpts((o) => ({ ...o, metric: METRICS.find((m) => m === e.target.value) ?? "pKill", threshold: null }))}>
                {METRICS.map((m) => (
                  <option key={m} value={m}>
                    {metricLabel(m)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t("analyses.reverse.threshold")} hint={thresholdHint}>
              <span className="row" style={{ gap: "0.3rem" }}>
                <input type="number" min={0} step={opts.metric === "pKill" ? 0.05 : 1} max={opts.metric === "pKill" ? 1 : undefined} value={threshold} onChange={(e) => setOpts((o) => ({ ...o, threshold: e.target.value.trim() === "" || !Number.isFinite(Number(e.target.value)) ? null : Number(e.target.value) }))} />
                {opts.threshold !== null ? (
                  <button type="button" className="ghost sm" onClick={() => setOpts((o) => ({ ...o, threshold: null }))}>
                    {t("analyses.reverse.thresholdReset")}
                  </button>
                ) : (
                  <span className="small muted">{t("analyses.reverse.thresholdAuto", { v: opts.metric === "pKill" ? pct(auto, 0) : fmtInt(auto) })}</span>
                )}
              </span>
            </Field>
            <Field label={t("analyses.reverse.maxCombo")}>
              <select value={opts.maxCombo} onChange={(e) => setOpts((o) => ({ ...o, maxCombo: Math.max(1, Math.min(3, Number(e.target.value) || 2)) }))}>
                {[1, 2, 3].map((n) => (
                  <option key={n} value={n}>
                    {t("analyses.reverse.maxComboUnit", { n })}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <AnalysisContextControls value={opts.context} onChange={(context) => setOpts((o) => ({ ...o, context }))} />
        </section>
      </aside>
      <section className="analysis-results stack">
        <RunStatus task={task} stale={dirty} />
        {task.result && ran ? (
          <>
            <h3 style={{ margin: 0 }}>{t("analyses.reverse.title", { name: ran.target.unit.name })}</h3>
            <WarningList warnings={task.result.warnings} />
            <p className="small muted" style={{ margin: 0 }}>
              {t("analyses.reverse.summary", { rows: task.result.rows.length, evals: fmtInt(task.result.evaluations), meeting })}
            </p>
            {task.result.cheapest ? (
              <div className="notice success" role="status" style={{ marginBottom: 0 }}>
                <span>{t("analyses.reverse.cheapestLine", { names: task.result.cheapest.names.join(" + "), points: task.result.cheapest.points ? fmtInt(task.result.cheapest.points) : "–", metric: metricLabel(ran.metric), value: metricDisplay(ran.metric, task.result.cheapest.value) })}</span>
              </div>
            ) : task.result.rows.length ? (
              <div className="notice info" role="status" style={{ marginBottom: 0 }}>
                <span>{t("analyses.reverse.noAnswer")}</span>
              </div>
            ) : null}
            <ReverseTable result={task.result} metric={ran.metric} onOpen={(row) => void open(row)} />
          </>
        ) : (
          <div className="empty">{canRun ? t("analyses.reverse.ready") : t("analyses.reverse.needBoth")}</div>
        )}
      </section>
    </div>
  );
}
