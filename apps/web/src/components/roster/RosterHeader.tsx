import { useState, type ReactNode } from "react";
import type { BattleSize, Diagnostic, Roster } from "@grimstat/schema";
import type { SaveStatus } from "../../hooks/useRosterEditor";
import type { PointsBarModel } from "../../lib/pointsBar";
import { hrefFor } from "../../router";
import { BATTLE_SIZE_ORDER } from "../../lib/roster";
import { PageHeader } from "../shell";
import { PointsBar } from "./PointsBar";
import { battleSizeKey } from "../../pages/ArmiesPage";
import { Icon, Popover } from "../ui";
import { DiagnosticItem } from "./DiagnosticItem";
import { t, tn, type I18nKey } from "../../i18n";

export type EditorMode = "unit" | "export" | "history";

/** The editor's three views, covering the list itself, the description of what was built, and its output. */
export type EditorTab = "units" | "stats" | "arsenal" | "strats" | "meta";
export const EDITOR_TABS: EditorTab[] = ["units", "stats", "arsenal", "strats", "meta"];
const TAB_LABEL: Record<EditorTab, I18nKey> = { units: "roster.tab.units", stats: "roster.tab.stats", arsenal: "roster.tab.arsenal", strats: "roster.tab.strats", meta: "roster.tab.meta" };

/** Reject anything but a known tab id when reading the remembered value back. */
export function parseEditorTab(raw: unknown): EditorTab | undefined {
  return EDITOR_TABS.find((x) => x === raw);
}

interface Props {
  roster: Roster;
  factionName: string;
  points: PointsBarModel;
  status: SaveStatus;
  savedAt: string | undefined;
  errors: number;
  warns: number;
  /** Every check the army failed, listed under the count in the header.  */
  diagnostics: Diagnostic[];
  /** Jump to the unit a diagnostic points at. */
  onSelectUnit: (index: number) => void;
  mode: EditorMode;
  onMode: (m: EditorMode) => void;
  onRename: (name: string) => void;
  onBattleSize: (size: BattleSize) => void;
  onPointsLimit: (limit: number) => void;
  onAddUnit: () => void;
  tab: EditorTab;
  onTab: (tab: EditorTab) => void;
  /** Detachment chips, hung under the points bar. */
  children?: ReactNode;
}

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

/**
 * The header's "1 error · 1 warning". Reading a count and then hunting for what it refers to is a
 * step nobody wants, so the count opens the list of checks it is counting, and a check that names a
 * unit selects it.
 */
function IssueCount({ text, bad, diagnostics, onSelectUnit }: { text: string; bad: boolean; diagnostics: Diagnostic[]; onSelectUnit: (index: number) => void }) {
  const [open, setOpen] = useState(false);
  if (!diagnostics.length) return <span className="roster-issues">{text}</span>;
  return (
    <Popover
      open={open}
      onClose={() => setOpen(false)}
      label={t("roster.issues.listTitle")}
      className="roster-issues-pop"
      trigger={
        <button type="button" className={`roster-issues as-button ${bad ? "bad" : ""}`.trim()} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          {text}
        </button>
      }
    >
      <div className="stack">
        <strong>{t("roster.issues.listTitle")}</strong>
        <ul className="val-list" role="list">
          {diagnostics.map((d, i) => (
            <DiagnosticItem
              key={`${d.code}:${d.path ?? i}`}
              d={d}
              onSelectUnit={(index) => {
                setOpen(false);
                onSelectUnit(index);
              }}
            />
          ))}
        </ul>
      </div>
    </Popover>
  );
}

/** Editor header: editable name, the army's context line, the points bar, the detachment chips and the view tabs. */
export function RosterHeader({ roster, factionName, points, status, savedAt, errors, warns, diagnostics, onSelectUnit, mode, onMode, onRename, onBattleSize, onPointsLimit, onAddUnit, tab, onTab, children }: Props) {
  const issueText = errors || warns ? [errors ? tn(errors, "roster.issues.error.one", "roster.issues.error.many") : "", warns ? tn(warns, "roster.issues.warn.one", "roster.issues.warn.many") : ""].filter(Boolean).join(" · ") : t("roster.issues.none");
  const toggle = (m: EditorMode) => onMode(mode === m ? "unit" : m);

  const title = (
    <div className="roster-title-row">
      <a href={hrefFor("armies")} className="roster-back" aria-label={t("armies.back")} title={t("armies.back")}>
        <Icon name="back" />
      </a>
      <label className="page-title-field">
        <span className="sr-only">{t("roster.nameAria")}</span>
        <input type="text" value={roster.name} placeholder={t("roster.namePlaceholder")} onChange={(e) => onRename(e.target.value)} />
      </label>
    </div>
  );

  const subtitle = (
    <span className="roster-sub">
      <span title={roster.factionId}>{factionName}</span>
      <span aria-hidden="true">·</span>
      <select className="roster-sub-select" value={roster.battleSize} aria-label={t("armies.battleSize")} onChange={(e) => onBattleSize(e.target.value as BattleSize)}>
        {BATTLE_SIZE_ORDER.map((s) => (
          <option key={s} value={s}>
            {t(battleSizeKey(s))}
          </option>
        ))}
      </select>
      {roster.battleSize === "custom" ? <input className="roster-sub-limit" type="number" min={1} step={5} value={roster.pointsLimit} aria-label={t("roster.pointsLimit")} onChange={(e) => onPointsLimit(Math.max(1, Math.floor(Number(e.target.value)) || 1))} /> : null}
      <span aria-hidden="true">·</span>
      <span className={`roster-save ${status}`} role="status" aria-live="polite">
        {statusLabel(status, savedAt)}
      </span>
      <span aria-hidden="true">·</span>
      <IssueCount text={issueText} bad={errors > 0} diagnostics={diagnostics} onSelectUnit={onSelectUnit} />
    </span>
  );

  return (
    <PageHeader
      className="roster-header tabbed"
      title={title}
      subtitle={subtitle}
      actions={
        <>
          <button type="button" aria-pressed={mode === "export"} onClick={() => toggle("export")}>
            {t("roster.export")}
          </button>
          <button type="button" aria-pressed={mode === "history"} onClick={() => toggle("history")}>
            {t("roster.history")}
          </button>
          <button type="button" className="primary" onClick={onAddUnit}>
            {t("roster.units.add")}
          </button>
        </>
      }
    >
      <PointsBar model={points} />
      {children}
      <div className="tabbar" role="tablist" aria-label={t("roster.tabs")}>
        {EDITOR_TABS.map((id) => (
          <button key={id} type="button" role="tab" id={`roster-tab-${id}`} aria-selected={id === tab} aria-controls="roster-panel" className={`tabbar-tab ${id === tab ? "on" : ""}`.trim()} onClick={() => onTab(id)}>
            {t(TAB_LABEL[id])}
          </button>
        ))}
      </div>
    </PageHeader>
  );
}
