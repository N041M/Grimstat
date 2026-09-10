import type { ReactNode } from "react";
import type { BattleSize, Roster } from "@grimstat/schema";
import type { SaveStatus } from "../../hooks/useRosterEditor";
import type { PointsBarModel } from "../../lib/pointsBar";
import { hrefFor } from "../../router";
import { BATTLE_SIZE_ORDER } from "../../lib/roster";
import { PageHeader } from "../shell";
import { PointsBar } from "./PointsBar";
import { battleSizeKey } from "../../pages/ArmiesPage";
import { Icon } from "../ui";
import { t, tn } from "../../i18n";

export type EditorMode = "unit" | "export" | "history";

interface Props {
  roster: Roster;
  factionName: string;
  points: PointsBarModel;
  status: SaveStatus;
  savedAt: string | undefined;
  errors: number;
  warns: number;
  mode: EditorMode;
  onMode: (m: EditorMode) => void;
  onRename: (name: string) => void;
  onBattleSize: (size: BattleSize) => void;
  onPointsLimit: (limit: number) => void;
  onAddUnit: () => void;
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

/** Editor header: editable name, the army's context line, the points bar and the detachment chips. */
export function RosterHeader({ roster, factionName, points, status, savedAt, errors, warns, mode, onMode, onRename, onBattleSize, onPointsLimit, onAddUnit, children }: Props) {
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
      <span className={errors ? "roster-issues bad" : "roster-issues"}>{issueText}</span>
    </span>
  );

  return (
    <PageHeader
      className="roster-header"
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
    </PageHeader>
  );
}
