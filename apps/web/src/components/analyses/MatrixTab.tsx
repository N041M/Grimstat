import { useMemo, useState } from "react";
import type { ScenarioUnit, Snapshot } from "@grimstat/schema";
import { useApp } from "../../state/AppContext";
import { navigate } from "../../router";
import { simClient } from "../../worker/client";
import { useWorkerTask } from "../../hooks/useWorkerTask";
import { useUnitSet } from "../../hooks/useUnitSet";
import { usePersistedSetting } from "../../hooks/usePersistedSetting";
import { MATRIX_METRICS, type MatrixMetric } from "../../lib/heatmap";
import { matrixToCsv } from "../../lib/matrixCsv";
import { download } from "../../lib/download";
import { cloneUnit } from "../../lib/scenario";
import type { UnitEntry } from "../../lib/unitSet";
import { UnitSetPicker } from "./UnitSetPicker";
import { Heatmap, metricLabel } from "./Heatmap";
import { AnalysisContextControls, DEFAULT_ANALYSIS_CONTEXT, RunStatus, parseAnalysisContext, type AnalysisContext } from "./shared";
import { Field } from "../ui";
import { t } from "../../i18n";

interface MatrixOptions {
  metric: MatrixMetric;
  context: AnalysisContext;
}

const DEFAULT_OPTIONS: MatrixOptions = { metric: "damage", context: DEFAULT_ANALYSIS_CONTEXT };

function parseOptions(raw: unknown): MatrixOptions | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Partial<Record<keyof MatrixOptions, unknown>>;
  const metric = MATRIX_METRICS.find((m) => m === r.metric) ?? "damage";
  return { metric, context: parseAnalysisContext(r.context) };
}

const runMatrix = (attackers: ScenarioUnit[], defenders: ScenarioUnit[], context: AnalysisContext, snapshot: Snapshot | undefined) => simClient().matrix(attackers, defenders, context, [], snapshot);

const fingerprint = (a: UnitEntry[], d: UnitEntry[], ctx: AnalysisContext) => JSON.stringify([a.map((e) => e.id), d.map((e) => e.id), ctx]);

export function MatrixTab() {
  const { snapshot, scenario, activeSnapshotId, replaceScenario, notify } = useApp();
  const attackers = useUnitSet("analyses.matrix.attackers");
  const defenders = useUnitSet("analyses.matrix.defenders");
  const [opts, setOpts] = usePersistedSetting<MatrixOptions>("analyses.matrix.options", DEFAULT_OPTIONS, parseOptions);
  const task = useWorkerTask(runMatrix);
  const [ran, setRan] = useState<{ attackers: UnitEntry[]; defenders: UnitEntry[]; fp: string } | undefined>(undefined);

  const canRun = attackers.entries.length > 0 && defenders.entries.length > 0;
  const dirty = !!ran && ran.fp !== fingerprint(attackers.entries, defenders.entries, opts.context);
  const cells = attackers.entries.length * defenders.entries.length;

  const run = () => {
    if (!canRun) return;
    setRan({ attackers: attackers.entries, defenders: defenders.entries, fp: fingerprint(attackers.entries, defenders.entries, opts.context) });
    task.run(
      attackers.entries.map((e) => e.unit),
      defenders.entries.map((e) => e.unit),
      opts.context,
      snapshot,
    );
  };

  const openPair = async (a: number, d: number) => {
    const A = ran?.attackers[a];
    const D = ran?.defenders[d];
    if (!A || !D) return;
    await replaceScenario({ ...scenario, name: `${A.unit.name} vs ${D.unit.name}`, attacker: cloneUnit(A.unit), defender: cloneUnit(D.unit), context: { ...scenario.context, ...opts.context } }, activeSnapshotId);
    notify(t("analyses.matrix.opened", { a: A.unit.name, d: D.unit.name }), "success");
    navigate("calculator");
  };

  const exportCsv = () => {
    if (!task.result) return;
    download(`grimstat-matrix-${new Date().toISOString().slice(0, 10)}.csv`, matrixToCsv(task.result), "text/csv");
  };

  const attackerPoints = useMemo(() => ran?.attackers.map((e) => e.unit.points), [ran]);
  const defenderPoints = useMemo(() => ran?.defenders.map((e) => e.unit.points), [ran]);

  return (
    <div className="analysis">
      <aside className="analysis-controls stack">
        <section className="panel">
          <UnitSetPicker label={t("analyses.set.attackers")} entries={attackers.entries} onChange={attackers.setEntries} archetypeFilter="attackers" />
        </section>
        <section className="panel">
          <UnitSetPicker label={t("analyses.set.defenders")} entries={defenders.entries} onChange={defenders.setEntries} />
        </section>
        <section className="panel stack" aria-labelledby="matrix-ctx-h">
          <h3 id="matrix-ctx-h" style={{ margin: 0 }}>
            {t("ctx.title")}
          </h3>
          <AnalysisContextControls value={opts.context} onChange={(context) => setOpts((o) => ({ ...o, context }))} />
          <div className="row">
            <button type="button" className="primary" disabled={!canRun || task.running} onClick={run}>
              {t("analyses.run")}
            </button>
            <span className="small muted">{t("analyses.matrix.cells", { n: cells })}</span>
          </div>
        </section>
      </aside>
      <section className="analysis-results stack">
        <RunStatus task={task} extra={dirty ? t("analyses.stale") : undefined} />
        {task.result && ran ? (
          <>
            <div className="row between">
              <Field label={t("analyses.matrix.metric")} className="inline-field">
                <select value={opts.metric} onChange={(e) => setOpts((o) => ({ ...o, metric: (MATRIX_METRICS.find((m) => m === e.target.value) ?? "damage") as MatrixMetric }))}>
                  {MATRIX_METRICS.map((m) => (
                    <option key={m} value={m}>
                      {metricLabel(m)}
                    </option>
                  ))}
                </select>
              </Field>
              <button type="button" className="sm" onClick={exportCsv}>
                {t("analyses.matrix.exportCsv")}
              </button>
            </div>
            <Heatmap matrix={task.result} metric={opts.metric} attackerPoints={attackerPoints} defenderPoints={defenderPoints} onSelect={(a, d) => void openPair(a, d)} />
            <p className="small muted">{t("analyses.matrix.hint")}</p>
          </>
        ) : (
          <div className="empty">{canRun ? t("analyses.matrix.ready") : t("analyses.matrix.needBoth")}</div>
        )}
      </section>
    </div>
  );
}
