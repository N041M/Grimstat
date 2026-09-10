import type { Diagnostic } from "@grimstat/schema";
import { unitIndexFromPath } from "../../lib/roster";
import { Icon } from "../ui";
import { t } from "../../i18n";

interface Props {
  diagnostics: Diagnostic[];
  onSelectUnit: (index: number) => void;
}

const TONE: Record<Diagnostic["severity"], "danger" | "warn" | ""> = { error: "danger", warn: "warn", info: "" };

/** One diagnostic line; the internal code stays available as a tooltip. */
export function DiagnosticItem({ d, onSelectUnit }: { d: Diagnostic; onSelectUnit?: (index: number) => void }) {
  const idx = unitIndexFromPath(d.path);
  const tone = TONE[d.severity];
  const body = (
    <>
      <span className={`diag-dot ${tone}`} aria-hidden="true" />
      <span className="grow">
        <span>{d.message}</span>
        {d.fix ? <span className="muted small"> — {d.fix}</span> : null}
      </span>
    </>
  );
  return (
    <li className={`diag-item ${tone}`.trim()} title={d.code}>
      {idx !== undefined && onSelectUnit ? (
        <button type="button" className="diag-btn" onClick={() => onSelectUnit(idx)} title={t("roster.diagnostics.goTo")}>
          {body}
        </button>
      ) : (
        <span className="diag-btn static">{body}</span>
      )}
    </li>
  );
}

/** Errors first, then warnings; info collapsed; a green "No issues" state when nothing is wrong. */
export function DiagnosticsPanel({ diagnostics, onSelectUnit }: Props) {
  const errors = diagnostics.filter((d) => d.severity === "error");
  const warns = diagnostics.filter((d) => d.severity === "warn");
  const info = diagnostics.filter((d) => d.severity === "info");
  const clean = !errors.length && !warns.length;
  return (
    <section className="panel diag-panel" id="diagnostics" aria-labelledby="diag-h" tabIndex={-1}>
      <div className="panel-head">
        <h2 id="diag-h">{t("roster.diagnostics")}</h2>
        <span className="row">
          {errors.length ? <span className="badge danger">{errors.length}</span> : null}
          {warns.length ? <span className="badge warn">{warns.length}</span> : null}
        </span>
      </div>
      {clean ? (
        <div className="diag-clean" role="status">
          <Icon name="check" />
          {t("roster.diagnostics.clean")}
        </div>
      ) : null}
      {errors.length ? (
        <div className="diag-group">
          <h4 className="inspector-h">{t("roster.diagnostics.error")}</h4>
          <ul className="diag-list">
            {errors.map((d, i) => (
              <DiagnosticItem key={`${d.code}-${i}`} d={d} onSelectUnit={onSelectUnit} />
            ))}
          </ul>
        </div>
      ) : null}
      {warns.length ? (
        <div className="diag-group">
          <h4 className="inspector-h">{t("roster.diagnostics.warn")}</h4>
          <ul className="diag-list">
            {warns.map((d, i) => (
              <DiagnosticItem key={`${d.code}-${i}`} d={d} onSelectUnit={onSelectUnit} />
            ))}
          </ul>
        </div>
      ) : null}
      {info.length ? (
        <details className="diag-info">
          <summary className="inspector-h">{t("roster.diagnostics.infoCount", { n: info.length })}</summary>
          <ul className="diag-list">
            {info.map((d, i) => (
              <DiagnosticItem key={`${d.code}-${i}`} d={d} onSelectUnit={onSelectUnit} />
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}
