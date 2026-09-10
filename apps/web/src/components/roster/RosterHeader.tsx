import { useState, type ReactNode } from "react";
import type { BattleSize, Roster } from "@grimstat/schema";
import type { SaveStatus } from "../../hooks/useRosterEditor";
import { hrefFor } from "../../router";
import { BATTLE_SIZE_ORDER, pointsTone } from "../../lib/roster";
import { fmtInt } from "../../lib/format";
import { battleSizeKey } from "../../pages/ArmiesPage";
import { DpPips, Icon, PointsMeter } from "../ui";
import { t, tn } from "../../i18n";

export type EditorMode = "unit" | "export" | "history";

interface Props {
  roster: Roster;
  factionName: string;
  points: number;
  dpSpent: number;
  dpLimit: number;
  status: SaveStatus;
  savedAt: string | undefined;
  errors: number;
  warns: number;
  mode: EditorMode;
  /** Narrow viewport: the bar collapses to name + points meter with a disclosure for the rest. */
  narrow: boolean;
  onMode: (m: EditorMode) => void;
  onRename: (name: string) => void;
  onBattleSize: (size: BattleSize) => void;
  onPointsLimit: (limit: number) => void;
  onShowIssues: () => void;
  /** Detachment strip (rendered inside the sticky header on desktop). */
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

/** Sticky editor header: title, faction, size, points meter, DP pips, save status, issues summary, Export / History. */
export function RosterHeader({ roster, factionName, points, dpSpent, dpLimit, status, savedAt, errors, warns, mode, narrow, onMode, onRename, onBattleSize, onPointsLimit, onShowIssues, children }: Props) {
  const [expanded, setExpanded] = useState(false);
  const tone = pointsTone(points, roster.pointsLimit);
  const issueTone = errors ? "danger" : warns ? "warn" : "ok";
  const issueText = errors || warns ? [errors ? tn(errors, "roster.issues.error.one", "roster.issues.error.many") : "", warns ? tn(warns, "roster.issues.warn.one", "roster.issues.warn.many") : ""].filter(Boolean).join(" · ") : t("roster.issues.none");
  const toggle = (m: EditorMode) => onMode(mode === m ? "unit" : m);

  return (
    <header className={`roster-head ${narrow ? "narrow" : ""} ${expanded ? "expanded" : ""}`.trim()}>
      <div className="roster-head-row">
        <a href={hrefFor("armies")} className="roster-back" aria-label={t("armies.back")} title={t("armies.back")}>
          <Icon name="back" />
        </a>
        <div className="roster-title-wrap">
          <input type="text" className="roster-title" value={roster.name} placeholder={t("roster.namePlaceholder")} aria-label={t("roster.nameAria")} onChange={(e) => onRename(e.target.value)} />
          <div className="roster-subtitle head-detail">
            <span className="badge" title={roster.factionId}>
              {factionName}
            </span>
            <select className="quiet-select" value={roster.battleSize} aria-label={t("armies.battleSize")} onChange={(e) => onBattleSize(e.target.value as BattleSize)}>
              {BATTLE_SIZE_ORDER.map((s) => (
                <option key={s} value={s}>
                  {t(battleSizeKey(s))}
                </option>
              ))}
            </select>
            {roster.battleSize === "custom" ? (
              <label className="inline-limit">
                <span className="small muted">{t("roster.pointsLimit")}</span>
                <input type="number" min={1} step={5} value={roster.pointsLimit} aria-label={t("roster.pointsLimit")} onChange={(e) => onPointsLimit(Math.max(1, Math.floor(Number(e.target.value)) || 1))} />
              </label>
            ) : null}
          </div>
        </div>
        <div className="roster-head-meter">
          <PointsMeter points={fmtInt(points)} limit={fmtInt(roster.pointsLimit)} tone={tone} label={t("roster.meter.aria", { points: fmtInt(points), limit: fmtInt(roster.pointsLimit) })} />
          <span className="head-detail">
            <DpPips spent={dpSpent} limit={dpLimit} label={t("roster.dpOf", { spent: dpSpent, limit: dpLimit })} />
          </span>
        </div>
        <div className="roster-head-tools head-detail">
          <span className={`save-status ${status}`} role="status" aria-live="polite">
            {statusLabel(status, savedAt)}
          </span>
          <button type="button" className={`ghost sm issues-btn ${issueTone}`} onClick={onShowIssues} title={t("roster.issues.goTo")}>
            <Icon name={errors || warns ? "warn" : "check"} />
            {issueText}
          </button>
          <button type="button" className="sm" aria-pressed={mode === "export"} onClick={() => toggle("export")}>
            <Icon name="export" />
            {t("roster.export")}
          </button>
          <button type="button" className="sm" aria-pressed={mode === "history"} onClick={() => toggle("history")}>
            <Icon name="history" />
            {t("roster.history")}
          </button>
        </div>
        {narrow ? (
          <button type="button" className="ghost sm icon-btn head-toggle" aria-expanded={expanded} aria-label={expanded ? t("roster.head.less") : t("roster.head.more")} onClick={() => setExpanded((v) => !v)}>
            <Icon name="chevron" />
          </button>
        ) : null}
      </div>
      {children}
    </header>
  );
}
