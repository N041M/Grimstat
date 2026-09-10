import { useCallback, useEffect, useMemo, useState } from "react";
import type { BattleSize, Datasheet, Roster, RosterUnit } from "@grimstat/schema";
import { constraints11e, unitFromRosterUnit } from "@grimstat/game-40k-11e";
import { rosterSummary, validateRoster } from "@grimstat/resolver";
import { useApp } from "../state/AppContext";
import { useRosterEditor, useRosterSnapshot } from "../hooks/useRosterEditor";
import { NARROW_QUERY, useMediaQuery } from "../hooks/useMediaQuery";
import { hrefFor, navigate } from "../router";
import { detachmentPointsFor, diagnosticsForUnit, duplicateUnit, enhancementsFor, newRosterUnit, pointsLimitFor, sectionOf } from "../lib/roster";
import { pointsBarModel } from "../lib/pointsBar";
import { RosterHeader, type EditorMode } from "../components/roster/RosterHeader";
import { DetachmentStrip } from "../components/roster/DetachmentsBlock";
import { UnitTable, type CalcSide } from "../components/roster/UnitTable";
import { UnitInspector } from "../components/roster/UnitInspector";
import { RosterDock, type DockBudget } from "../components/roster/RosterDock";
import { ExportDrawer } from "../components/roster/ExportDrawer";
import { HistoryPanel } from "../components/roster/HistoryPanel";
import { Empty, Sheet } from "../components/ui";
import { t } from "../i18n";

export function RosterEditorPage({ id }: { id: string }) {
  const { scenario, replaceScenario, notify } = useApp();
  const editor = useRosterEditor(id);
  const { roster, status, savedAt, update } = editor;
  const { snapshot, fallback, loading } = useRosterSnapshot(roster);
  const narrow = useMediaQuery(NARROW_QUERY);
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  const [mode, setMode] = useState<EditorMode>("unit");
  const [adding, setAdding] = useState(false);
  const [detPicker, setDetPicker] = useState(false);
  const [warnedFallback, setWarnedFallback] = useState(false);

  useEffect(() => {
    if (fallback && roster && !warnedFallback) {
      setWarnedFallback(true);
      notify(t("armies.snapshotMissing", { id: roster.snapshotId }), "info");
    }
  }, [fallback, roster, notify, warnedFallback]);

  const datasheets = useMemo(() => new Map((snapshot?.data.datasheets ?? []).map((d) => [d.id, d] as const)), [snapshot]);
  const summary = useMemo(() => (roster && snapshot ? rosterSummary(roster, snapshot) : undefined), [roster, snapshot]);
  const costById = useMemo(() => new Map((summary?.units ?? []).map((u) => [u.id, u.cost] as const)), [summary]);
  const diagnostics = useMemo(() => (roster && snapshot ? validateRoster(roster, snapshot, [constraints11e]) : []), [roster, snapshot]);
  const faction = snapshot?.data.factions.find((f) => f.id === roster?.factionId);

  // Points by role for the header bar; attached characters count under their own role.
  const points = useMemo(() => (roster ? pointsBarModel(roster.units.map((u) => ({ section: sectionOf(datasheets.get(u.datasheetId), roster), points: costById.get(u.id)?.total ?? 0 })), roster.pointsLimit) : undefined), [roster, datasheets, costById]);

  // Escape closes the inspector / export / history panel (the phone sheet handles its own).
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setMode("unit");
      setSelectedId(undefined);
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, []);

  const selectUnit = useCallback((unitId: string) => {
    setSelectedId(unitId);
    setMode("unit");
  }, []);
  const closePanel = useCallback(() => {
    setMode("unit");
    setSelectedId(undefined);
  }, []);

  const selected = roster?.units.find((u) => u.id === selectedId);
  const selectedIndex = roster && selected ? roster.units.indexOf(selected) : -1;
  const selectedIssues = useMemo(() => (selectedIndex >= 0 ? diagnosticsForUnit(diagnostics, selectedIndex) : []), [diagnostics, selectedIndex]);

  const addUnit = (ds: Datasheet, edit: boolean) => {
    const u = newRosterUnit(ds);
    update((r) => ({ ...r, units: [...r.units, u] }));
    if (edit) {
      setAdding(false);
      selectUnit(u.id);
    }
  };
  const changeUnit = (unit: RosterUnit) => update((r) => ({ ...r, units: r.units.map((u) => (u.id === unit.id ? unit : u)) }));
  const duplicate = (unit: RosterUnit) => {
    const copy = duplicateUnit(unit);
    update((r) => {
      const i = r.units.findIndex((u) => u.id === unit.id);
      const units = [...r.units];
      units.splice(i < 0 ? units.length : i + 1, 0, copy);
      return { ...r, units };
    });
    selectUnit(copy.id);
  };
  const remove = (unit: RosterUnit) => {
    update((r) => ({
      ...r,
      units: r.units
        .filter((u) => u.id !== unit.id)
        .map((u) => {
          if (u.attachedTo?.unitId !== unit.id) return u;
          const { attachedTo: _a, ...rest } = u;
          return rest;
        }),
    }));
    if (selectedId === unit.id) setSelectedId(undefined);
  };

  const setBattleSize = (size: BattleSize) => update((r) => ({ ...r, battleSize: size, pointsLimit: pointsLimitFor(size, r.pointsLimit) }));

  const openInCalculator = async (unit: RosterUnit, side: CalcSide) => {
    if (!roster || !snapshot) return;
    try {
      const su = unitFromRosterUnit(unit, roster, snapshot);
      await replaceScenario({ ...scenario, [side]: su, snapshotId: snapshot.id }, snapshot.id);
      notify(t("roster.inspector.opened", { name: su.name, side: t(side === "attacker" ? "side.attacker" : "side.defender").toLowerCase() }), "success");
      navigate("calculator");
    } catch (e) {
      notify(t("roster.inspector.openFailed"), "error", [e instanceof Error ? e.message : String(e)]);
    }
  };

  const restore = (r: Roster, revision: number) => {
    editor.replace(r);
    setSelectedId(undefined);
    notify(t("roster.history.restored", { n: revision }), "success");
  };

  if (status === "loading" || (roster && loading)) return <p className="muted roster-loading">{t("armies.loading")}</p>;
  if (!roster || status === "missing") {
    return (
      <div className="stack roster-loading">
        <a href={hrefFor("armies")}>← {t("armies.back")}</a>
        <Empty>{t("armies.notFound")}</Empty>
      </div>
    );
  }
  if (!snapshot || !points) {
    return (
      <div className="stack roster-loading">
        <a href={hrefFor("armies")}>← {t("armies.back")}</a>
        <Empty>
          {t("armies.noSnapshot")} <a href={hrefFor("data")}>{t("nav.data")}</a>
        </Empty>
      </div>
    );
  }

  const dpSpent = summary?.detachmentPoints ?? 0;
  const errors = diagnostics.filter((d) => d.severity === "error").length;
  const warns = diagnostics.filter((d) => d.severity === "warn").length;
  const budgets: DockBudget[] = [
    { label: t("roster.budget.points"), used: points.total, limit: points.limit },
    { label: t("roster.budget.dp"), used: dpSpent, limit: detachmentPointsFor(roster.battleSize) },
    { label: t("roster.budget.enhancements"), used: roster.units.filter((u) => u.enhancementId).length, limit: enhancementsFor(roster.battleSize) },
  ];

  const panelLabel = mode === "export" ? t("roster.export.title") : mode === "history" ? t("roster.history.title") : t("roster.inspector.aria");
  const panel =
    mode === "export" ? (
      <ExportDrawer roster={roster} snapshot={snapshot} onClose={closePanel} />
    ) : mode === "history" ? (
      <HistoryPanel roster={roster} snapshot={snapshot} onRestore={restore} onClose={closePanel} />
    ) : selected ? (
      <UnitInspector
        key={selected.id}
        unit={selected}
        roster={roster}
        snapshot={snapshot}
        datasheets={datasheets}
        cost={costById.get(selected.id)}
        issues={selectedIssues}
        onChange={changeUnit}
        onOpenInCalculator={(side) => void openInCalculator(selected, side)}
        onDuplicate={() => duplicate(selected)}
        onRemove={() => remove(selected)}
        onClose={closePanel}
      />
    ) : null;
  const panelOpen = mode !== "unit" || !!selected;

  return (
    <div className={`roster-editor ${narrow ? "narrow" : ""}`.trim()}>
      <div className="roster-main">
        <RosterHeader
          roster={roster}
          factionName={faction?.name ?? t("roster.factionMissing", { id: roster.factionId })}
          points={points}
          status={status}
          savedAt={savedAt}
          errors={errors}
          warns={warns}
          mode={mode}
          onMode={(m) => {
            setMode(m);
            if (m === "unit") setSelectedId(undefined);
          }}
          onRename={(name) => update((r) => ({ ...r, name }))}
          onBattleSize={setBattleSize}
          onPointsLimit={(limit) => update((r) => ({ ...r, pointsLimit: limit }))}
          onAddUnit={() => setAdding((v) => !v)}
        >
          <DetachmentStrip roster={roster} snapshot={snapshot} onChange={update} pickerOpen={detPicker} onPickerOpen={setDetPicker} />
        </RosterHeader>

        <UnitTable
          roster={roster}
          snapshot={snapshot}
          datasheets={datasheets}
          costById={costById}
          diagnostics={diagnostics}
          selectedId={selectedId}
          adding={adding}
          onAdding={setAdding}
          onSelect={selectUnit}
          onAdd={addUnit}
          onDuplicate={duplicate}
          onRemove={remove}
          onOpenInCalculator={(u, side) => void openInCalculator(u, side)}
          onOpenDetachmentPicker={() => setDetPicker(true)}
          onExport={() => setMode("export")}
        />
      </div>

      <RosterDock
        roster={roster}
        snapshot={snapshot}
        diagnostics={diagnostics}
        budgets={budgets}
        onSelectUnit={(i) => {
          const u = roster.units[i];
          if (u) selectUnit(u.id);
        }}
        onOpenHistory={() => setMode("history")}
      />

      {narrow ? (
        <Sheet open={panelOpen} onClose={closePanel} label={panelLabel} className="roster-sheet">
          {panel}
        </Sheet>
      ) : panelOpen ? (
        <aside className="roster-inspector" aria-label={panelLabel}>
          {panel}
        </aside>
      ) : null}
    </div>
  );
}
