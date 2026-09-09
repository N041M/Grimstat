import type { SimulationState } from "../hooks/useSimulation";
import { Badge, Spinner } from "./ui";
import { fmt, fmtInt } from "../lib/format";
import { t } from "../i18n";

export function ResultsBar({ sim }: { sim: SimulationState }) {
  const r = sim.result;
  return (
    <div className="results-bar" aria-live="polite">
      {sim.running ? <Spinner label={t("results.running")} /> : sim.error ? <Badge tone="danger">{t("results.error")}</Badge> : r ? <Badge tone="ok">{t("results.upToDate")}</Badge> : <Badge>{t("results.idle")}</Badge>}
      {r ? (
        <>
          <span className="small">
            {t("results.backendLabel")}: <strong>{r.backend === "exact" ? t("results.backend.exact") : t("results.backend.mcShort")}</strong>
          </span>
          {r.iterations !== undefined ? <span className="small">{t("results.iterations", { n: fmtInt(r.iterations) })}</span> : null}
          {r.ciHalfWidth !== undefined ? <span className="small">{t("results.ci", { v: fmt(r.ciHalfWidth, 3) })}</span> : null}
          {sim.elapsedMs !== undefined ? <span className="small muted">{t("results.elapsed", { ms: fmtInt(sim.elapsedMs) })}</span> : null}
        </>
      ) : null}
      {sim.error ? <span className="small" style={{ color: "var(--danger)" }}>{sim.error}</span> : null}
    </div>
  );
}
