import type { Diagnostic } from "@grimstat/schema";
import { unitIndexFromPath } from "../../lib/roster";
import { t } from "../../i18n";

/**
 * One diagnostic line: the message, then the suggested fix when the rule offers one. The rule's
 * internal code is never printed; it stays available as the tooltip. Rows that point at a unit
 * become a button when `onSelectUnit` is given.
 */
export function DiagnosticItem({ d, onSelectUnit }: { d: Diagnostic; onSelectUnit?: (index: number) => void }) {
  const idx = unitIndexFromPath(d.path);
  const bad = d.severity !== "info";
  const body = (
    <>
      <span className={`val-dot ${bad ? "bad" : ""}`.trim()} aria-hidden="true" />
      <span className="val-text">
        <span className="val-msg">{d.message}</span>
        {d.fix ? <span className="val-rule">{d.fix}</span> : null}
      </span>
    </>
  );
  return (
    <li className="val-item" title={d.code}>
      {idx !== undefined && onSelectUnit ? (
        <button type="button" className="val-row" onClick={() => onSelectUnit(idx)} title={`${t("roster.diagnostics.goTo")} · ${d.code}`}>
          {body}
        </button>
      ) : (
        <span className="val-row static">{body}</span>
      )}
    </li>
  );
}
