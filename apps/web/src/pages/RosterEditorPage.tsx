import { useCallback, useEffect, useMemo, useState } from "react";
import type { BattleSize, Datasheet, Roster, RosterUnit } from "@grimstat/schema";
import { constraints11e, unitFromRosterUnit } from "@grimstat/game-40k-11e";
import { rosterSummary, validateRoster } from "@grimstat/resolver";
import { useApp } from "../state/AppContext";
import { useRosterEditor, useRosterSnapshot } from "../hooks/useRosterEditor";
import { NARROW_QUERY, useMediaQuery } from "../hooks/useMediaQuery";
import { hrefFor, navigate } from "../router";
import { detachmentPointsFor, diagnosticsForUnit, duplicateUnit, newRosterUnit, pointsLimitFor } from "../lib/roster";
import { RosterHeader, type EditorMode } from "../components/roster/RosterHeader";
import { DetachmentStrip } from "../components/roster/DetachmentsBlock";
import { UnitsBlock, type CalcSide } from "../components/roster/UnitsBlock";
import { UnitInspector } from "../components/roster/UnitInspector";
import { DiagnosticsPanel } from "../components/roster/DiagnosticsPanel";
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

  const showIssues = () => {
    const el = document.getElementById("diagnostics");
    if (!el) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ block: "start", behavior: reduced ? "auto" : "smooth" });
    el.focus({ preventScroll: true });
  };

  if (status === "loading" || (roster && loading)) return <p className="muted">{t("armies.loading")}</p>;
  if (!roster || status === "missing") {
    return (
      <div className="stack">
        <a href={hrefFor("armies")}>← {t("armies.back")}</a>
        <Empty>{t("armies.notFound")}</Empty>
      </div>
    );
  }
  if (!snapshot) {
    return (
      <div className="stack">
        <a href={hrefFor("armies")}>← {t("armies.back")}</a>
        <Empty>
          {t("armies.noSnapshot")} <a href={hrefFor("data")}>{t("nav.data")}</a>
        </Empty>
      </div>
    );
  }

  const points = summary?.points ?? 0;
  const dpSpent = summary?.detachmentPoints ?? 0;
  const dpLimit = detachmentPointsFor(roster.battleSize);
  const errors = diagnostics.filter((d) => d.severity === "error").length;
  const warns = diagnostics.filter((d) => d.severity === "warn").length;

  const strip = <DetachmentStrip roster={roster} snapshot={snapshot} onChange={update} pickerOpen={detPicker} onPickerOpen={setDetPicker} />;
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
    ) : (
      <div className="empty insp-empty">{t("roster.inspector.empty")}</div>
    );
  const panelOpen = mode !== "unit" || !!selected;

  return (
    <div className={`roster-editor ${narrow ? "narrow" : ""}`.trim()}>
      <RosterHeader
        roster={roster}
        factionName={faction?.name ?? t("roster.factionMissing", { id: roster.factionId })}
        points={points}
        dpSpent={dpSpent}
        dpLimit={dpLimit}
        status={status}
        savedAt={savedAt}
        errors={errors}
        warns={warns}
        mode={mode}
        narrow={narrow}
        onMode={(m) => {
          setMode(m);
          if (m === "unit") setSelectedId(undefined);
        }}
        onRename={(name) => update((r) => ({ ...r, name }))}
        onBattleSize={setBattleSize}
        onPointsLimit={(limit) => update((r) => ({ ...r, pointsLimit: limit }))}
        onShowIssues={showIssues}
      >
        {narrow ? null : strip}
      </RosterHeader>
      {narrow ? strip : null}

      <div className="roster-body">
        <div className="roster-main stack">
          <UnitsBlock
            roster={roster}
            snapshot={snapshot}
            datasheets={datasheets}
            costById={costById}
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
          <DiagnosticsPanel
            diagnostics={diagnostics}
            onSelectUnit={(i) => {
              const u = roster.units[i];
              if (u) selectUnit(u.id);
            }}
          />
        </div>
        {narrow ? (
          <Sheet open={panelOpen} onClose={closePanel} label={panelLabel} className="roster-sheet">
            {panel}
          </Sheet>
        ) : (
          <aside className={`roster-inspector panel ${panelOpen ? "open" : "idle"}`} aria-label={panelLabel}>
            {panel}
          </aside>
        )}
      </div>
    </div>
  );
}
