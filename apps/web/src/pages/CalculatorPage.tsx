import { useMemo, useState } from "react";
import type { ScenarioUnit } from "@grimstat/schema";
import { useApp } from "../state/AppContext";
import { useSimulation } from "../hooks/useSimulation";
import { UnitPicker } from "../components/UnitPicker";
import { ContextControls } from "../components/ContextControls";
import { TogglesPanel } from "../components/TogglesPanel";
import { ResultsBar } from "../components/ResultsBar";
import { Dashboard } from "../components/Dashboard";
import { db } from "../db";
import { forStorage, newScenario, touch } from "../lib/scenario";
import { permalinkUrl } from "../lib/permalink";
import { relay } from "../services";
import { t } from "../i18n";

export function CalculatorPage() {
  const { scenario, snapshot, activeSnapshotId, updateScenario, replaceScenario, scenarioLoadKey, notify } = useApp();
  const sim = useSimulation(scenario, snapshot);
  const [link, setLink] = useState<string | undefined>(undefined);

  const setUnit = (side: "attacker" | "defender") => (unit: ScenarioUnit) =>
    updateScenario((s) => ({ ...s, [side]: unit, ...(unit.ref ? { snapshotId: unit.ref.snapshotId } : {}) }));

  const save = async () => {
    const rec = forStorage(touch({ ...scenario, ...(activeSnapshotId ? { snapshotId: activeSnapshotId } : {}) }));
    await db.scenarios.put(rec);
    updateScenario(() => rec);
    notify(t("scenario.saved", { name: rec.name }), "success");
  };

  const share = async () => {
    const payload = activeSnapshotId ? { scenario: forStorage(scenario), snapshotId: activeSnapshotId } : { scenario: forStorage(scenario) };
    const url = permalinkUrl(payload);
    const short = relay().available ? await relay().shorten(url) : null;
    setLink(short ?? url);
  };

  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      notify(t("scenario.linkCopied"), "success");
    } catch {
      notify(t("scenario.linkCopyFailed"), "info");
    }
  };

  const reset = () => void replaceScenario(newScenario());

  const inputs = useMemo(() => ({ scenario, result: sim.result, snapshot, running: sim.running, error: sim.error }), [scenario, sim.result, snapshot, sim.running, sim.error]);

  return (
    <div className="stack">
      <div className="page-head">
        <div className="row">
          <label className="field">
            <span>{t("scenario.name")}</span>
            <input type="text" value={scenario.name} style={{ minWidth: 260 }} onChange={(e) => updateScenario((s) => ({ ...s, name: e.target.value }))} />
          </label>
        </div>
        <div className="row">
          <button type="button" className="primary" onClick={() => void save()}>
            {t("scenario.save")}
          </button>
          <button type="button" onClick={() => void share()}>
            {t("scenario.share")}
          </button>
          <button type="button" className="ghost" onClick={reset}>
            {t("scenario.new")}
          </button>
        </div>
      </div>
      {link ? (
        <div className="link-box">
          <input type="text" readOnly value={link} aria-label={t("scenario.permalink")} onFocus={(e) => e.currentTarget.select()} />
          <button type="button" onClick={() => void copy()}>
            {t("scenario.copy")}
          </button>
          <button type="button" className="ghost" onClick={() => setLink(undefined)} aria-label={t("common.close")}>
            ×
          </button>
        </div>
      ) : null}

      <div className="calc">
        <section className="panel" aria-labelledby="attacker-h">
          <div className="panel-head">
            <h2 id="attacker-h">{t("side.attacker")}</h2>
            <span className="unit-summary">{scenario.attacker.name}</span>
          </div>
          <UnitPicker side="attacker" unit={scenario.attacker} snapshot={snapshot} loadKey={scenarioLoadKey} onChange={setUnit("attacker")} />
        </section>
        <section className="panel" aria-labelledby="defender-h">
          <div className="panel-head">
            <h2 id="defender-h">{t("side.defender")}</h2>
            <span className="unit-summary">{scenario.defender.name}</span>
          </div>
          <UnitPicker side="defender" unit={scenario.defender} snapshot={snapshot} loadKey={scenarioLoadKey} onChange={setUnit("defender")} />
        </section>
        <section className="panel" aria-labelledby="context-h">
          <div className="panel-head">
            <h2 id="context-h">{t("ctx.title")}</h2>
          </div>
          <ContextControls context={scenario.context} onChange={(patch) => updateScenario((s) => ({ ...s, context: { ...s.context, ...patch } }))} />
        </section>
        <section className="panel" aria-labelledby="toggles-h">
          <div className="panel-head">
            <h2 id="toggles-h">{t("toggles.title")}</h2>
            <span className="small muted">{t("toggles.hint")}</span>
          </div>
          <TogglesPanel scenario={scenario} snapshot={snapshot} onChange={(enabledToggles) => updateScenario((s) => ({ ...s, enabledToggles }))} />
        </section>
        <div className="span-2">
          <ResultsBar sim={sim} />
        </div>
        <div className="span-2">
          <Dashboard id="calculator" inputs={inputs} />
        </div>
      </div>
    </div>
  );
}
