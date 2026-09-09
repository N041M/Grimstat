import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BattleSize, Datasheet, Roster, RosterUnit } from "@grimstat/schema";
import { constraints11e, unitFromRosterUnit } from "@grimstat/game-40k-11e";
import { rosterSummary, validateRoster } from "@grimstat/resolver";
import { useApp } from "../state/AppContext";
import { useRosterEditor, useRosterSnapshot, type SaveStatus } from "../hooks/useRosterEditor";
import { hrefFor, navigate } from "../router";
import { BATTLE_SIZE_ORDER, detachmentPointsFor, duplicateUnit, newRosterUnit, pointsLimitFor } from "../lib/roster";
import { fmtInt } from "../lib/format";
import { DetachmentsBlock } from "../components/roster/DetachmentsBlock";
import { UnitsBlock } from "../components/roster/UnitsBlock";
import { UnitInspector } from "../components/roster/UnitInspector";
import { DiagnosticsPanel } from "../components/roster/DiagnosticsPanel";
import { ExportDrawer } from "../components/roster/ExportDrawer";
import { HistoryPanel } from "../components/roster/HistoryPanel";
import { Empty } from "../components/ui";
import { battleSizeKey } from "./ArmiesPage";
import { t } from "../i18n";

type Mode = "unit" | "export" | "history";

function statusLabel(status: SaveStatus, savedAt: string | undefined): string {
  switch (status) {
    case "dirty":
      return t("roster.status.dirty");
    case "saving":
      return t("roster.status.saving");
    case "error":
      return t("roster.status.error");
    default:
      return savedAt ? t("roster.status.savedAt", { time: new Date(savedAt).toLocaleTimeString() }) : t("roster.status.saved");
  }
}

export function RosterEditorPage({ id }: { id: string }) {
  const { scenario, replaceScenario, notify } = useApp();
  const editor = useRosterEditor(id);
  const { roster, status, savedAt, update } = editor;
  const { snapshot, fallback, loading } = useRosterSnapshot(roster);
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  const [mode, setMode] = useState<Mode>("unit");
  const inspectorRef = useRef<HTMLElement>(null);
  const warnedFallback = useRef(false);

  useEffect(() => {
    if (fallback && roster && !warnedFallback.current) {
      warnedFallback.current = true;
      notify(t("armies.snapshotMissing", { id: roster.snapshotId }), "info");
    }
  }, [fallback, roster, notify]);

  const datasheets = useMemo(() => new Map((snapshot?.data.datasheets ?? []).map((d) => [d.id, d] as const)), [snapshot]);
  const summary = useMemo(() => (roster && snapshot ? rosterSummary(roster, snapshot) : undefined), [roster, snapshot]);
  const costById = useMemo(() => new Map((summary?.units ?? []).map((u) => [u.id, u.cost] as const)), [summary]);
  const diagnostics = useMemo(() => (roster && snapshot ? validateRoster(roster, snapshot, [constraints11e]) : []), [roster, snapshot]);
  const faction = snapshot?.data.factions.find((f) => f.id === roster?.factionId);

  const selectUnit = useCallback((unitId: string) => {
    setSelectedId(unitId);
    setMode("unit");
    if (window.matchMedia("(max-width: 899px)").matches) window.setTimeout(() => inspectorRef.current?.scrollIntoView({ block: "start", behavior: "smooth" }), 0);
  }, []);

  const selected = roster?.units.find((u) => u.id === selectedId);

  const addUnit = (ds: Datasheet) => {
    const u = newRosterUnit(ds);
    update((r) => ({ ...r, units: [...r.units, u] }));
    selectUnit(u.id);
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

  const openInCalculator = async (unit: RosterUnit, side: "attacker" | "defender") => {
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
  const over = points > roster.pointsLimit;
  const dpSpent = summary?.detachmentPoints ?? 0;
  const dpLimit = detachmentPointsFor(roster.battleSize);
  const toggleMode = (m: Mode) => setMode((cur) => (cur === m ? "unit" : m));

  return (
    <div className="roster-editor">
      <header className="roster-head">
        <div className="roster-head-main">
          <a href={hrefFor("armies")} className="small">
            ← {t("armies.back")}
          </a>
          <input type="text" className="roster-name" value={roster.name} aria-label={t("roster.nameAria")} onChange={(e) => update((r) => ({ ...r, name: e.target.value }))} />
          <span className="badge" title={roster.factionId}>
            {faction?.name ?? t("roster.factionMissing", { id: roster.factionId })}
          </span>
          <label className="field inline-field">
            <span>{t("armies.battleSize")}</span>
            <select value={roster.battleSize} onChange={(e) => setBattleSize(e.target.value as BattleSize)}>
              {BATTLE_SIZE_ORDER.map((s) => (
                <option key={s} value={s}>
                  {t(battleSizeKey(s))}
                </option>
              ))}
            </select>
          </label>
          {roster.battleSize === "custom" ? (
            <label className="field inline-field">
              <span>{t("roster.pointsLimit")}</span>
              <input type="number" min={1} step={5} value={roster.pointsLimit} onChange={(e) => update((r) => ({ ...r, pointsLimit: Math.max(1, Math.floor(Number(e.target.value)) || 1) }))} />
            </label>
          ) : null}
        </div>
        <div className="roster-head-stats">
          <span className={`stat ${over ? "over" : ""}`.trim()} title={over ? t("roster.overLimit") : t("roster.points")} aria-label={`${t("roster.points")}: ${fmtInt(points)} / ${fmtInt(roster.pointsLimit)}`}>
            <span className="k">{t("roster.points")}</span>
            <span className="v">
              {fmtInt(points)} / {fmtInt(roster.pointsLimit)}
            </span>
          </span>
          <span className={`stat ${dpSpent > dpLimit ? "over" : ""}`.trim()} aria-label={`${t("roster.dp")}: ${dpSpent} / ${dpLimit}`}>
            <span className="k">{t("roster.dp")}</span>
            <span className="v">
              {dpSpent} / {dpLimit}
            </span>
          </span>
          <span className={`save-status ${status}`} role="status" aria-live="polite">
            {statusLabel(status, savedAt)}
          </span>
          <span className="row">
            <button type="button" className="sm" aria-pressed={mode === "export"} onClick={() => toggleMode("export")}>
              {t("roster.export")}
            </button>
            <button type="button" className="sm" aria-pressed={mode === "history"} onClick={() => toggleMode("history")}>
              {t("roster.history")}
            </button>
          </span>
        </div>
      </header>

      <div className="roster-body">
        <div className="roster-main stack">
          <DetachmentsBlock roster={roster} snapshot={snapshot} onChange={update} />
          <UnitsBlock roster={roster} snapshot={snapshot} datasheets={datasheets} costById={costById} selectedId={selectedId} onSelect={selectUnit} onAdd={addUnit} onDuplicate={duplicate} onRemove={remove} />
          <DiagnosticsPanel
            diagnostics={diagnostics}
            onSelectUnit={(i) => {
              const u = roster.units[i];
              if (u) selectUnit(u.id);
            }}
          />
        </div>
        <aside className="roster-inspector panel" ref={inspectorRef} aria-label={mode === "unit" ? t("roster.units") : mode === "export" ? t("roster.export.title") : t("roster.history.title")}>
          {mode === "export" ? (
            <ExportDrawer roster={roster} snapshot={snapshot} onClose={() => setMode("unit")} />
          ) : mode === "history" ? (
            <HistoryPanel roster={roster} snapshot={snapshot} onRestore={restore} onClose={() => setMode("unit")} />
          ) : selected ? (
            <UnitInspector key={selected.id} unit={selected} roster={roster} snapshot={snapshot} datasheets={datasheets} cost={costById.get(selected.id)} onChange={changeUnit} onOpenInCalculator={(side) => void openInCalculator(selected, side)} />
          ) : (
            <div className="empty">{t("roster.inspector.empty")}</div>
          )}
        </aside>
      </div>
    </div>
  );
}
