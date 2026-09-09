import type { Diagnostic } from "@grimstat/schema";
import { unitIndexFromPath } from "../../lib/roster";
import { t } from "../../i18n";

interface Props {
  diagnostics: Diagnostic[];
  onSelectUnit: (index: number) => void;
}

const GROUPS: Array<{ severity: Diagnostic["severity"]; key: "roster.diagnostics.error" | "roster.diagnostics.warn" | "roster.diagnostics.info"; tone: "danger" | "warn" | "" }> = [
  { severity: "error", key: "roster.diagnostics.error", tone: "danger" },
  { severity: "warn", key: "roster.diagnostics.warn", tone: "warn" },
  { severity: "info", key: "roster.diagnostics.info", tone: "" },
];

export function DiagnosticsPanel({ diagnostics, onSelectUnit }: Props) {
  const errors = diagnostics.filter((d) => d.severity === "error").length;
  const warns = diagnostics.filter((d) => d.severity === "warn").length;
  return (
    <section className="panel" aria-labelledby="diag-h">
      <div className="panel-head">
        <h2 id="diag-h">{t("roster.diagnostics")}</h2>
        <span className="row">
          {errors ? <span className="badge danger">{errors}</span> : null}
          {warns ? <span className="badge warn">{warns}</span> : null}
          {!errors && !warns ? <span className="badge ok">{t("roster.diagnostics.clean")}</span> : null}
        </span>
      </div>
      {GROUPS.map((g) => {
        const items = diagnostics.filter((d) => d.severity === g.severity);
        if (!items.length) return null;
        return (
          <div key={g.severity} className="diag-group">
            <h4 className="inspector-h">{t(g.key)}</h4>
            <ul className="diag-list">
              {items.map((d, i) => {
                const idx = unitIndexFromPath(d.path);
                const body = (
                  <>
                    <span className={`diag-dot ${g.tone}`} aria-hidden="true" />
                    <span className="grow">
                      <span>{d.message}</span>
                      {d.fix ? <span className="muted small"> — {d.fix}</span> : null}
                    </span>
                    <span className="mono muted small">{d.code}</span>
                  </>
                );
                return (
                  <li key={`${d.code}-${i}`} className={`diag-item ${g.tone}`}>
                    {idx !== undefined ? (
                      <button type="button" className="diag-btn" onClick={() => onSelectUnit(idx)} title={t("roster.diagnostics.goTo")}>
                        {body}
                      </button>
                    ) : (
                      <span className="diag-btn static">{body}</span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </section>
  );
}
