import { useEffect, useMemo, useRef, useState } from "react";
import type { ScenarioUnit, Snapshot } from "@grimstat/schema";
import type { DurabilityIndexRow } from "@grimstat/game-40k-11e";
import { useApp } from "../../state/AppContext";
import { navigate } from "../../router";
import { simClient } from "../../worker/client";
import { useWorkerTask } from "../../hooks/useWorkerTask";
import { useUnitSet } from "../../hooks/useUnitSet";
import { usePersistedSetting } from "../../hooks/usePersistedSetting";
import { MATRIX_METRICS, heatmapModel, type MatrixMetric } from "../../lib/heatmap";
import { matrixToCsv } from "../../lib/matrixCsv";
import { download } from "../../lib/download";
import { cloneUnit } from "../../lib/scenario";
import { fmtInt } from "../../lib/format";
import type { UnitEntry } from "../../lib/unitSet";
import { UnitSetPicker } from "./UnitSetPicker";
import { HeatLegend, Heatmap, formatMetric, metricLabel } from "./Heatmap";
import { AnalysisContextControls, DEFAULT_ANALYSIS_CONTEXT, RunStatus, parseAnalysisContext, useAnalysisHeader, type AnalysisContext } from "./shared";
import { PanelHead, ProportionBar, SelectBox } from "../kit";
import { t } from "../../i18n";

interface MatrixOptions {
  metric: MatrixMetric;
  context: AnalysisContext;
}

const DEFAULT_OPTIONS: MatrixOptions = { metric: "damagePer100", context: DEFAULT_ANALYSIS_CONTEXT };

function parseOptions(raw: unknown): MatrixOptions | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Partial<Record<keyof MatrixOptions, unknown>>;
  const metric = MATRIX_METRICS.find((m) => m === r.metric) ?? "damagePer100";
  return { metric, context: parseAnalysisContext(r.context) };
}

const runMatrix = (attackers: ScenarioUnit[], defenders: ScenarioUnit[], context: AnalysisContext, snapshot: Snapshot | undefined) => simClient().matrix(attackers, defenders, context, [], snapshot);
const runDurability = (defenders: ScenarioUnit[], snapshot: Snapshot | undefined) => simClient().durabilityIndex(defenders, {}, snapshot);

const fingerprint = (a: UnitEntry[], d: UnitEntry[], ctx: AnalysisContext) => JSON.stringify([a.map((e) => e.id), d.map((e) => e.id), ctx]);

/** "Best answer per defender": the attacker with the highest value in each column. */
function bestAnswers(values: Array<Array<number | undefined>>, attackers: string[], defenders: string[]): Array<{ defender: string; attacker: string; value: number } | undefined> {
  return defenders.map((defender, d) => {
    let best: { defender: string; attacker: string; value: number } | undefined;
    values.forEach((row, a) => {
      const v = row[d];
      if (v === undefined || !Number.isFinite(v)) return;
      if (!best || v > best.value) best = { defender, attacker: attackers[a] ?? "", value: v };
    });
    return best;
  });
}

function DurabilityCard({ rows, running }: { rows: DurabilityIndexRow[] | undefined; running: boolean }) {
  const sorted = useMemo(() => (rows ?? []).filter((r) => Number.isFinite(r.pointsToRemove)).sort((a, b) => b.pointsToRemove - a.pointsToRemove), [rows]);
  const max = sorted[0]?.pointsToRemove ?? 0;
  return (
    <section className="mx-card" aria-labelledby="mx-dur-h">
      <h3 className="mx-card-h" id="mx-dur-h">
        {t("analyses.matrix.durabilityTitle")}
      </h3>
      <p className="mx-card-sub">{t("analyses.matrix.durabilitySub")}</p>
      {running ? <p className="mx-card-empty">{t("results.running")}</p> : null}
      {!running && !sorted.length ? <p className="mx-card-empty">{t("analyses.matrix.durabilityNone")}</p> : null}
      {sorted.map((r, i) => (
        <div key={r.unit} className="mx-dur-row">
          <span className="mx-dur-name" title={r.unit}>
            {r.unit}
          </span>
          <ProportionBar value={max > 0 ? r.pointsToRemove / max : 0} height={7} tone={i < 2 ? "ink" : i < 4 ? "mid" : "dim"} />
          <span className="mx-dur-v">{fmtInt(Math.round(r.pointsToRemove))}</span>
        </div>
      ))}
    </section>
  );
}

/**
 * Matchup matrix. The Heatmap tab renders the same run without the per-cell numbers, so both tabs
 * share this component and only `view` differs.
 */
export function MatrixTab({ view = "values" }: { view?: "values" | "swatches" }) {
  const { snapshot, scenario, activeSnapshotId, replaceScenario, notify } = useApp();
  const attackers = useUnitSet("analyses.matrix.attackers");
  const defenders = useUnitSet("analyses.matrix.defenders");
  const [opts, setOpts] = usePersistedSetting<MatrixOptions>("analyses.matrix.options", DEFAULT_OPTIONS, parseOptions);
  const task = useWorkerTask(runMatrix);
  const durability = useWorkerTask(runDurability);
  const [ran, setRan] = useState<{ attackers: UnitEntry[]; defenders: UnitEntry[]; fp: string } | undefined>(undefined);
  const [showSets, setShowSets] = useState(false);

  const canRun = attackers.entries.length > 0 && defenders.entries.length > 0;
  const dirty = !!ran && ran.fp !== fingerprint(attackers.entries, defenders.entries, opts.context);

  const run = () => {
    if (!canRun) return;
    setRan({ attackers: attackers.entries, defenders: defenders.entries, fp: fingerprint(attackers.entries, defenders.entries, opts.context) });
    durability.reset();
    task.run(
      attackers.entries.map((e) => e.unit),
      defenders.entries.map((e) => e.unit),
      opts.context,
      snapshot,
    );
  };

  const exportCsv = () => {
    if (!task.result) return;
    download(`grimstat-matrix-${new Date().toISOString().slice(0, 10)}.csv`, matrixToCsv(task.result), "text/csv");
  };

  // The worker sequences requests and drops superseded ones, so the durability index only starts
  // once the matrix result is in hand.
  const defenderUnits = ran?.defenders.map((e) => e.unit);
  useEffect(() => {
    if (!task.result || !defenderUnits?.length) return;
    durability.run(defenderUnits, snapshot);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.result]);

  const openPair = async (a: number, d: number) => {
    const A = ran?.attackers[a];
    const D = ran?.defenders[d];
    if (!A || !D) return;
    await replaceScenario({ ...scenario, name: `${A.unit.name} vs ${D.unit.name}`, attacker: cloneUnit(A.unit), defender: cloneUnit(D.unit), context: { ...scenario.context, ...opts.context } }, activeSnapshotId);
    notify(t("analyses.matrix.opened", { a: A.unit.name, d: D.unit.name }), "success");
    navigate("calculator");
  };

  // Header actions call through a ref so they never run against a stale closure.
  const handlers = useRef({ run, exportCsv });
  handlers.current = { run, exportCsv };
  const hasResult = !!task.result;
  useAnalysisHeader(
    () => ({
      subtitle: hasResult ? t("analyses.matrix.sub", { a: ran?.attackers.length ?? 0, d: ran?.defenders.length ?? 0, metric: metricLabel(opts.metric) }) : t("analyses.matrix.subIdle", { a: attackers.entries.length, d: defenders.entries.length }),
      actions: (
        <>
          <button type="button" disabled={!hasResult} onClick={() => handlers.current.exportCsv()}>
            {t("analyses.matrix.exportCsv")}
          </button>
          <button type="button" className="primary" disabled={!canRun || task.running} onClick={() => handlers.current.run()}>
            {t("analyses.run")}
          </button>
        </>
      ),
    }),
    // `view` is in here because the Matrix and Heatmap tabs share this instance: switching tabs
    // clears the header, so the effect has to run again to put it back.
    [view, hasResult, canRun, task.running, opts.metric, attackers.entries.length, defenders.entries.length, ran?.attackers.length, ran?.defenders.length],
  );

  const attackerPoints = useMemo(() => ran?.attackers.map((e) => e.unit.points), [ran]);
  const defenderPoints = useMemo(() => ran?.defenders.map((e) => e.unit.points), [ran]);
  const model = useMemo(() => (task.result ? heatmapModel(task.result, opts.metric) : undefined), [task.result, opts.metric]);
  const best = useMemo(() => (task.result && model ? bestAnswers(model.values, task.result.attackers, task.result.defenders) : []), [task.result, model]);

  const setsOpen = showSets || !canRun;

  return (
    <>
      <div className="mx-toolbar">
        <button type="button" className="mx-sets-toggle" aria-expanded={setsOpen} onClick={() => setShowSets((v) => !v)}>
          <span aria-hidden="true">{setsOpen ? "⌄" : "›"}</span>
          {t("analyses.matrix.sets", { a: attackers.entries.length, d: defenders.entries.length })}
        </button>
        <SelectBox label={t("analyses.matrix.metric")} value={opts.metric} options={MATRIX_METRICS.map((m) => ({ value: m, label: metricLabel(m) }))} onChange={(m) => setOpts((o) => ({ ...o, metric: m }))} />
        <RunStatus task={task} extra={dirty ? t("analyses.stale") : undefined} />
      </div>

      {setsOpen ? (
        <div className="mx-sets">
          <section className="mx-set">
            <UnitSetPicker label={t("analyses.set.attackers")} entries={attackers.entries} onChange={attackers.setEntries} archetypeFilter="attackers" />
          </section>
          <section className="mx-set">
            <UnitSetPicker label={t("analyses.set.defenders")} entries={defenders.entries} onChange={defenders.setEntries} />
          </section>
          <section className="mx-set" aria-labelledby="matrix-ctx-h">
            <PanelHead id="matrix-ctx-h" title={t("ctx.title")} />
            <AnalysisContextControls value={opts.context} onChange={(context) => setOpts((o) => ({ ...o, context }))} />
          </section>
        </div>
      ) : null}

      {task.result && ran ? (
        <>
          <Heatmap matrix={task.result} metric={opts.metric} view={view} attackerPoints={attackerPoints} defenderPoints={defenderPoints} onSelect={(a, d) => void openPair(a, d)} />
          <HeatLegend matrix={task.result} metric={opts.metric} />
          <div className="mx-cards">
            <section className="mx-card" aria-labelledby="mx-best-h">
              <h3 className="mx-card-h" id="mx-best-h">
                {t("analyses.matrix.bestTitle")}
              </h3>
              <p className="mx-card-sub">{t("analyses.matrix.bestSub", { metric: metricLabel(opts.metric) })}</p>
              {best.map((b, i) =>
                b ? (
                  <div key={i} className="mx-best-row">
                    <span className="mx-best-def" title={b.defender}>
                      {b.defender}
                    </span>
                    <span className="mx-best-att" title={b.attacker}>
                      {b.attacker}
                    </span>
                    <span className="mx-best-v">{formatMetric(opts.metric, b.value)}</span>
                  </div>
                ) : null,
              )}
            </section>
            <DurabilityCard rows={durability.result} running={durability.running} />
          </div>
          <p className="mx-hint">{t("analyses.matrix.hint")}</p>
        </>
      ) : (
        <div className="empty">{canRun ? t("analyses.matrix.ready") : t("analyses.matrix.needBoth")}</div>
      )}
    </>
  );
}
