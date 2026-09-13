import { useCallback, useEffect, useMemo, useState } from "react";
import { NARROW_QUERY, useMediaQuery } from "../hooks/useMediaQuery";
import type { Scenario, ScenarioContext, ScenarioUnit } from "@grimstat/schema";
import { useApp, useReportSolveState } from "../state/AppContext";
import { useSimulation } from "../hooks/useSimulation";
import { UnitPicker } from "../components/UnitPicker";
import { Dashboard } from "../components/Dashboard";
import { ContextDock } from "../components/calc/ContextDock";
import { ScenarioCards } from "../components/calc/ScenarioCards";
import { Dialog, useConfirm } from "../components/ui";
import { db } from "../db";
import { cloneUnit, forStorage, hasUnsavedEdits, newScenario, phaseForUnit, sameScenario, touch } from "../lib/scenario";
import { permalinkUrl } from "../lib/permalink";
import { headlineOf, type Headline } from "../lib/headline";
import { csvFileName, resultToCsv } from "../lib/resultCsv";
import { download } from "../lib/download";
import { relay } from "../services";
import { BarSlot, ContextSlot } from "../components/shell";
import { t } from "../i18n";

type Side = "attacker" | "defender";

/** The unit as it was when its picker opened, so Cancel can put it back. */
interface EditBackup {
  side: Side;
  unit: ScenarioUnit;
  snapshotId: string | undefined;
}

/** Panels a fresh calculator layout starts without: coverage is already in the context column. */
const DEFAULT_HIDDEN = ["core.coverage"];

/**
 * Where the Situation panel goes once the screen is one column. Beside the results it is a column
 * of its own, always in view; stacked, it followed every widget, which put the phase and the range
 * band about five thousand pixels down a page whose first answer is at the top. It sits under the
 * damage distribution instead, so the chart and the controls that change it are on the same screen.
 */
const DOCK_AFTER_WIDGET = "core.damage-distribution";

export function CalculatorPage() {
  const { scenario, snapshot, activeSnapshotId, updateScenario, replaceScenario, scenarioLoadKey, notify } = useApp();
  const sim = useSimulation(scenario, snapshot);
  // Publishes the solve state to the shell's brand-mark dot. `stale` covers every control, flag and
  // toggle change: the dot goes accent from the first edit until the worker's answer lands.
  useReportSolveState(sim.stale);
  const { confirm, dialog } = useConfirm();
  const [link, setLink] = useState<string | undefined>(undefined);
  const [editing, setEditing] = useState<EditBackup | undefined>(undefined);
  const [stored, setStored] = useState<Scenario | undefined | null>(null);
  const [storedTick, setStoredTick] = useState(0);
  const [pinned, setPinned] = useState<Headline | undefined>(undefined);

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

  const saved = useMemo(() => (stored === null ? undefined : sameScenario(stored, scenario)), [stored, scenario]);

  /**
   * Put a unit on one side, and follow the attacker's loadout with the phase.
   *
   * A melee profile typed into the shooting phase produced a flat 0.0, because the engine resolves
   * only the weapons the phase uses. The phase moves with the unit the player just built, so the
   * screen answers the loadout in front of them. It moves on a unit change alone, never on a phase
   * change, so the control stays theirs once they set it.
   */
  const setUnit = (side: Side) => (unit: ScenarioUnit) => {
    const context = side === "attacker" ? phaseForUnit(scenario.context, unit) : scenario.context;
    const moved = context.phase !== scenario.context.phase;
    updateScenario((s) => ({ ...s, [side]: unit, ...(unit.ref ? { snapshotId: unit.ref.snapshotId } : {}), ...(moved ? { context: { ...s.context, phase: context.phase } } : {}) }));
    if (moved) notify(t(context.phase === "fight" ? "calc.phase.toFight" : "calc.phase.toShooting"), "info");
  };

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

  // A new scenario replaces the current one; edits that are not stored anywhere are asked about first.
  const reset = async () => {
    if (hasUnsavedEdits(scenario, stored ?? undefined)) {
      const ok = await confirm({ title: t("scenario.discardTitle"), body: t("scenario.discardBody", { name: scenario.name }), confirmLabel: t("scenario.discard"), danger: true });
      if (!ok) return;
    }
    await replaceScenario(newScenario({}, { snapshot }));
  };
  // Swapping hands the attacker's role to a different loadout, so the phase follows it the same way.
  const swap = () => {
    const context = phaseForUnit(scenario.context, scenario.defender);
    const moved = context.phase !== scenario.context.phase;
    updateScenario((s) => ({ ...s, attacker: s.defender, defender: s.attacker, ...(moved ? { context: { ...s.context, phase: context.phase } } : {}) }));
    if (moved) notify(t(context.phase === "fight" ? "calc.phase.toFight" : "calc.phase.toShooting"), "info");
  };
  const onContext = (patch: Partial<ScenarioContext>) => updateScenario((s) => ({ ...s, context: { ...s.context, ...patch } }));

  // The picker edits the live scenario as it goes; Cancel restores the snapshot taken here.
  const openEditor = (side: Side) => setEditing({ side, unit: cloneUnit(scenario[side]), snapshotId: scenario.snapshotId });
  const cancelEditor = () => {
    if (editing) {
      const { side, unit, snapshotId } = editing;
      updateScenario((s) => ({ ...s, [side]: unit, snapshotId }));
    }
    setEditing(undefined);
  };

  const togglePin = () => {
    if (pinned) {
      setPinned(undefined);
      notify(t("calc.unpinned"), "info");
    } else if (sim.result) {
      setPinned(headlineOf(sim.result));
      notify(t("calc.pinned"), "success");
    }
  };

  const exportCsv = () => {
    if (!sim.result) {
      notify(t("calc.exportNone"), "info");
      return;
    }
    const name = csvFileName(scenario.name);
    download(name, resultToCsv(sim.result), "text/csv");
    notify(t("calc.exported", { name }), "success");
  };

  const inputs = useMemo(() => ({ scenario, result: sim.result, snapshot, running: sim.running, error: sim.error, pinned, idle: sim.idle }), [scenario, sim.result, snapshot, sim.running, sim.error, pinned, sim.idle]);
  // The same panel, in the column beside the results or in the stack under the chart. It is built
  // once either way, so switching width moves it rather than mounting a second one.
  const stacked = useMediaQuery(NARROW_QUERY);
  const dock = <ContextDock scenario={scenario} snapshot={snapshot} sim={sim} onContext={onContext} onToggles={(enabledToggles) => updateScenario((s) => ({ ...s, enabledToggles }))} />;

  const dashActions = (
    <>
      <button type="button" className={`dash-btn ${pinned ? "on" : ""}`.trim()} onClick={togglePin} disabled={!pinned && !sim.result} title={t("calc.pin.title")} aria-pressed={pinned !== undefined}>
        {pinned ? t("calc.unpin") : t("calc.pin")}
      </button>
      <button type="button" className="dash-btn" onClick={exportCsv} disabled={!sim.result} title={t("calc.exportCsv.title")}>
        {t("calc.exportCsv")}
      </button>
    </>
  );

  return (
    <>
      {dialog}
      {/* This screen has no page header, so on phones its primary actions sit in the context bar.
          The slot has no host on a wide screen, where the same actions live in the column. */}
      <BarSlot>
        <button type="button" className="ctx-bar-action" onClick={() => void save()}>
          {t("calc.save")}
        </button>
        <button type="button" className="ctx-bar-action" onClick={() => void share()}>
          {t("calc.share")}
        </button>
        <button type="button" className="ctx-bar-action" onClick={() => void reset()} title={t("scenario.newScenario")}>
          {t("scenario.newScenario")}
        </button>
      </BarSlot>
      <ContextSlot>
        <ScenarioCards
          name={scenario.name}
          updatedAt={scenario.updatedAt}
          saved={saved}
          attacker={scenario.attacker}
          defender={scenario.defender}
          fightPhase={scenario.context.phase === "fight"}
          coverage={sim.result?.coverage}
          onRename={(name) => updateScenario((s) => ({ ...s, name }))}
          onEdit={openEditor}
          onSwap={swap}
          onSave={() => void save()}
          onShare={() => void share()}
          onNew={() => void reset()}
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
          <Dashboard id="calculator.v2" inputs={inputs} defaultHidden={DEFAULT_HIDDEN} actions={dashActions} stackAfter={stacked ? { widgetId: DOCK_AFTER_WIDGET, node: dock } : undefined} />
        </div>
        {stacked ? null : dock}
      </div>

      {/* The unit pickers (From data / Archetype / Custom) live behind each card's Edit affordance.
          Closing with Done or the × keeps the edits; Cancel puts the unit back as it was on opening. */}
      <Dialog open={editing !== undefined} onClose={() => setEditing(undefined)} wide className="unit-dialog" title={editing?.side === "defender" ? t("calc.editDefender") : t("calc.editAttacker")}>
        {editing ? <UnitPicker side={editing.side} unit={scenario[editing.side]} snapshot={snapshot} loadKey={scenarioLoadKey} onChange={setUnit(editing.side)} /> : null}
        <div className="dialog-actions unit-dialog-actions">
          <button type="button" onClick={cancelEditor}>
            {t("common.cancel")}
          </button>
          <button type="button" className="primary" onClick={() => setEditing(undefined)}>
            {t("common.done")}
          </button>
        </div>
      </Dialog>
    </>
  );
}
