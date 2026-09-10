import { useCallback, useEffect, useMemo, useState } from "react";
import type { Scenario, ScenarioContext, ScenarioUnit } from "@grimstat/schema";
import { useApp, useReportSolveState } from "../state/AppContext";
import { useSimulation } from "../hooks/useSimulation";
import { UnitPicker } from "../components/UnitPicker";
import { Dashboard } from "../components/Dashboard";
import { ContextDock } from "../components/calc/ContextDock";
import { ScenarioCards } from "../components/calc/ScenarioCards";
import { Dialog } from "../components/ui";
import { db } from "../db";
import { forStorage, newScenario, touch } from "../lib/scenario";
import { permalinkUrl } from "../lib/permalink";
import { relay } from "../services";
import { ContextSlot } from "../components/shell";
import { t } from "../i18n";

/** Same scenario, byte for byte? Decides the saved / unsaved flag in the context column. */
function sameAsStored(stored: Scenario | undefined, current: Scenario): boolean {
  if (!stored) return false;
  try {
    return JSON.stringify(forStorage(stored)) === JSON.stringify(forStorage(current));
  } catch {
    return false;
  }
}

export function CalculatorPage() {
  const { scenario, snapshot, activeSnapshotId, updateScenario, replaceScenario, scenarioLoadKey, notify } = useApp();
  const sim = useSimulation(scenario, snapshot);
  // Publishes the solve state to the shell's brand-mark dot. `stale` covers every control, flag and
  // toggle change: the dot goes accent from the first edit until the worker's answer lands.
  useReportSolveState(sim.stale);
  const [link, setLink] = useState<string | undefined>(undefined);
  const [editing, setEditing] = useState<"attacker" | "defender" | undefined>(undefined);
  const [stored, setStored] = useState<Scenario | undefined | null>(null);
  const [storedTick, setStoredTick] = useState(0);

  // The stored copy backs the saved / unsaved status; re-read after a save and on scenario changes.
  useEffect(() => {
    let alive = true;
    void db.scenarios
      .get(scenario.id)
      .then((rec) => {
        if (alive) setStored(rec ?? undefined);
      })
      .catch(() => {
        if (alive) setStored(undefined);
      });
    return () => {
      alive = false;
    };
  }, [scenario.id, scenarioLoadKey, storedTick]);

  const saved = useMemo(() => (stored === null ? undefined : sameAsStored(stored, scenario)), [stored, scenario]);

  const setUnit = (side: "attacker" | "defender") => (unit: ScenarioUnit) =>
    updateScenario((s) => ({ ...s, [side]: unit, ...(unit.ref ? { snapshotId: unit.ref.snapshotId } : {}) }));

  const save = useCallback(async () => {
    const rec = forStorage(touch({ ...scenario, ...(activeSnapshotId ? { snapshotId: activeSnapshotId } : {}) }));
    await db.scenarios.put(rec);
    updateScenario(() => rec);
    setStoredTick((n) => n + 1);
    notify(t("scenario.saved", { name: rec.name }), "success");
  }, [scenario, activeSnapshotId, updateScenario, notify]);

  const share = useCallback(async () => {
    const payload = activeSnapshotId ? { scenario: forStorage(scenario), snapshotId: activeSnapshotId } : { scenario: forStorage(scenario) };
    const url = permalinkUrl(payload);
    const short = relay().available ? await relay().shorten(url) : null;
    setLink(short ?? url);
  }, [scenario, activeSnapshotId]);

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
  const onContext = (patch: Partial<ScenarioContext>) => updateScenario((s) => ({ ...s, context: { ...s.context, ...patch } }));

  const inputs = useMemo(() => ({ scenario, result: sim.result, snapshot, running: sim.running, error: sim.error }), [scenario, sim.result, snapshot, sim.running, sim.error]);

  return (
    <>
      <ContextSlot>
        <ScenarioCards
          name={scenario.name}
          updatedAt={scenario.updatedAt}
          saved={saved}
          attacker={scenario.attacker}
          defender={scenario.defender}
          fightPhase={scenario.context.phase === "fight"}
          onRename={(name) => updateScenario((s) => ({ ...s, name }))}
          onEdit={setEditing}
          onSave={() => void save()}
          onShare={() => void share()}
          onNew={reset}
        />
      </ContextSlot>

      <div className="calc-screen">
        <div className="calc-results">
          {link ? (
            <div className="calc-link">
              <input type="text" readOnly value={link} aria-label={t("scenario.permalink")} onFocus={(e) => e.currentTarget.select()} />
              <button type="button" onClick={() => void copy()}>
                {t("scenario.copy")}
              </button>
              <button type="button" className="ghost" onClick={() => setLink(undefined)} aria-label={t("common.close")}>
                ×
              </button>
            </div>
          ) : null}
          {/* The id carries a version: the redesign changed the widget set and the default packing, so
              layouts stored against the old composition are not reconciled onto the new one. */}
          <Dashboard id="calculator.v2" inputs={inputs} />
        </div>
        <ContextDock scenario={scenario} snapshot={snapshot} sim={sim} onContext={onContext} onToggles={(enabledToggles) => updateScenario((s) => ({ ...s, enabledToggles }))} />
      </div>

      {/* The unit pickers (From data / Archetype / Custom) live behind each card's Edit affordance. */}
      <Dialog open={editing !== undefined} onClose={() => setEditing(undefined)} wide className="unit-dialog" title={editing === "defender" ? t("calc.editDefender") : t("calc.editAttacker")}>
        {editing ? <UnitPicker side={editing} unit={scenario[editing]} snapshot={snapshot} loadKey={scenarioLoadKey} onChange={setUnit(editing)} /> : null}
      </Dialog>
    </>
  );
}
