import type { ScenarioContext } from "@grimstat/schema";
import type { TaskState } from "../../hooks/useWorkerTask";
import { Badge, Field, Spinner } from "../ui";
import { fmtInt } from "../../lib/format";
import { t } from "../../i18n";

/** Status line shared by every analysis: running indicator, elapsed time, error. */
export function RunStatus({ task, extra }: { task: TaskState<unknown>; extra?: string }) {
  return (
    <div className="results-bar" aria-live="polite">
      {task.running ? <Spinner label={t("results.running")} /> : task.error ? <Badge tone="danger">{t("results.error")}</Badge> : task.result !== undefined ? <Badge tone="ok">{t("results.upToDate")}</Badge> : <Badge>{t("results.idle")}</Badge>}
      {task.elapsedMs !== undefined && !task.running ? <span className="small muted">{t("results.elapsed", { ms: fmtInt(task.elapsedMs) })}</span> : null}
      {extra ? <span className="small muted">{extra}</span> : null}
      {task.error ? (
        <span className="small" style={{ color: "var(--danger)" }}>
          {task.error}
        </span>
      ) : null}
    </div>
  );
}

/** The subset of the scenario context the analyses expose. */
export type AnalysisContext = Pick<ScenarioContext, "rangeBand" | "phase" | "inCover" | "charged">;
export const DEFAULT_ANALYSIS_CONTEXT: AnalysisContext = { rangeBand: "half", phase: "shooting", inCover: false, charged: false };

export function parseAnalysisContext(raw: unknown): AnalysisContext {
  const r = (raw ?? {}) as Partial<Record<keyof AnalysisContext, unknown>>;
  return {
    rangeBand: r.rangeBand === "full" ? "full" : "half",
    phase: r.phase === "fight" ? "fight" : "shooting",
    inCover: r.inCover === true,
    charged: r.charged === true,
  };
}

export function AnalysisContextControls({ value, onChange, fields = ["rangeBand", "phase", "inCover", "charged"] }: { value: AnalysisContext; onChange: (next: AnalysisContext) => void; fields?: Array<keyof AnalysisContext> }) {
  const has = (k: keyof AnalysisContext) => fields.includes(k);
  return (
    <div className="row" style={{ gap: "0.75rem", alignItems: "flex-end" }}>
      {has("rangeBand") ? (
        <Field label={t("ctx.rangeBand")}>
          <select value={value.rangeBand} onChange={(e) => onChange({ ...value, rangeBand: e.target.value === "full" ? "full" : "half" })}>
            <option value="full">{t("ctx.rangeBand.full")}</option>
            <option value="half">{t("ctx.rangeBand.half")}</option>
          </select>
        </Field>
      ) : null}
      {has("phase") ? (
        <Field label={t("ctx.phase")}>
          <select value={value.phase} onChange={(e) => onChange({ ...value, phase: e.target.value === "fight" ? "fight" : "shooting" })}>
            <option value="shooting">{t("ctx.phase.shooting")}</option>
            <option value="fight">{t("ctx.phase.fight")}</option>
          </select>
        </Field>
      ) : null}
      {has("inCover") ? (
        <label className="inline">
          <input type="checkbox" checked={value.inCover} onChange={(e) => onChange({ ...value, inCover: e.target.checked })} />
          <span>{t("ctx.inCover")}</span>
        </label>
      ) : null}
      {has("charged") ? (
        <label className="inline">
          <input type="checkbox" checked={value.charged} onChange={(e) => onChange({ ...value, charged: e.target.checked })} />
          <span>{t("ctx.charged")}</span>
        </label>
      ) : null}
    </div>
  );
}

export function WarningList({ warnings, tone = "warn" }: { warnings: string[]; tone?: "warn" | "danger" }) {
  if (!warnings.length) return null;
  return (
    <div className={`notice ${tone === "danger" ? "error" : "info"}`} role="status" style={{ marginBottom: 0 }}>
      <ul className="small" style={{ margin: 0, paddingLeft: "1.2rem" }}>
        {warnings.map((w, i) => (
          <li key={i}>{w}</li>
        ))}
      </ul>
    </div>
  );
}

/** Sortable column header button for the ranking tables. */
export function SortHeader<K extends string>({ col, label, sort, onSort, num }: { col: K; label: string; sort: { col: K; dir: "asc" | "desc" }; onSort: (col: K) => void; num?: boolean }) {
  const active = sort.col === col;
  return (
    <th className={num ? "num" : undefined} aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
      <button type="button" className="ghost sm sort-btn" onClick={() => onSort(col)}>
        {label}
        {active ? <span aria-hidden="true">{sort.dir === "asc" ? " ▲" : " ▼"}</span> : null}
      </button>
    </th>
  );
}
