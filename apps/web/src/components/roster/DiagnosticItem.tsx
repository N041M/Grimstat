import type { Diagnostic } from "@grimstat/schema";
import { unitIndexFromPath } from "../../lib/roster";
import { t } from "../../i18n";

/** One diagnostic line; the internal code stays available as a tooltip. */
export function DiagnosticItem({ d, onSelectUnit }: { d: Diagnostic; onSelectUnit?: (index: number) => void }) {
  const idx = unitIndexFromPath(d.path);
  const bad = d.severity !== "info";
  const body = (
    <>
      <span className={`val-dot ${bad ? "bad" : ""}`.trim()} aria-hidden="true" />
      <span className="val-text">
        <span className="val-msg">{d.message}</span>
        <span className="val-rule">{d.fix ?? d.code}</span>
      </span>
    </>
  );
  return (
    <li className="val-item" title={d.code}>
      {idx !== undefined && onSelectUnit ? (
        <button type="button" className="val-row" onClick={() => onSelectUnit(idx)} title={t("roster.diagnostics.goTo")}>
          {body}
        </button>
      ) : (
        <span className="val-row static">{body}</span>
      )}
    </li>
  );
}
