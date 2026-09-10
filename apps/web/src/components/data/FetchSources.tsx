import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { SOURCES } from "@grimstat/adapters";
import { db } from "../../db";
import { useApp } from "../../state/AppContext";
import { usePersistedSetting } from "../../hooks/usePersistedSetting";
import { ImportCancelledError, importClient } from "../../worker/importClient";
import { BROWSER_SOURCES, IDLE_PROGRESS, classifyError, errorMessage, importRequestFor, isRunning, reduceProgress, type BrowserSourceId, type ImportErrorKind, type ImportSelection, type SourceCounts, type SourceProgress } from "../../lib/importProgress";
import { fmtInt } from "../../lib/format";
import { Field, Spinner } from "../ui";
import { t } from "../../i18n";

export const CLI_IMPORT_COMMAND = "pnpm cli import --system wh40k-11e --out data/snapshots";
export const README_URL = "https://github.com/N041M/Grimstat#getting-started";
const SETTING_KEY = "data.fetch.selection";
const DEFAULT_SELECTION: ImportSelection = { sources: { "mfm-yaml": true, "bsdata-json": true }, factionFilter: "" };

function parseSelection(raw: unknown): ImportSelection | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as { sources?: unknown; factionFilter?: unknown };
  const src = r.sources && typeof r.sources === "object" ? (r.sources as Record<string, unknown>) : {};
  return { sources: { "mfm-yaml": src["mfm-yaml"] !== false, "bsdata-json": src["bsdata-json"] !== false }, factionFilter: typeof r.factionFilter === "string" ? r.factionFilter : "" };
}

function sourceName(id: BrowserSourceId): string {
  return id === "mfm-yaml" ? t("data.fetch.source.mfm-yaml") : t("data.fetch.source.bsdata-json");
}

function sourceSize(id: BrowserSourceId): string {
  return id === "mfm-yaml" ? t("data.fetch.size.mfm-yaml") : t("data.fetch.size.bsdata-json");
}

function stageLabel(stage: SourceProgress["stage"]): string {
  switch (stage) {
    case "pending":
      return t("data.fetch.stage.pending");
    case "downloading":
      return t("data.fetch.stage.downloading");
    case "parsing":
      return t("data.fetch.stage.parsing");
    case "parsed":
      return t("data.fetch.stage.parsed");
    case "failed":
      return t("data.fetch.stage.failed");
  }
}

function stageTone(stage: SourceProgress["stage"]): string {
  return stage === "parsed" ? "ok" : stage === "failed" ? "danger" : stage === "pending" ? "" : "accent";
}

function errorHint(kind: ImportErrorKind): string {
  return kind === "rate-limit" ? t("data.fetch.hint.rate-limit") : kind === "network" ? t("data.fetch.hint.network") : t("data.fetch.hint.other");
}

function countsLine(c: SourceCounts): string {
  return t("data.fetch.sourceCounts", { datasheets: fmtInt(c.datasheets), abilities: fmtInt(c.abilities), detachments: fmtInt(c.detachments), enhancements: fmtInt(c.enhancements), priceRules: fmtInt(c.priceRules) });
}

function SourceRow({ s }: { s: SourceProgress }) {
  const busy = s.stage === "downloading" || s.stage === "parsing";
  return (
    <li className={`progress-item ${s.stage}`}>
      <div className="row between">
        <span className="row">
          {busy ? <span className="spinner" aria-hidden="true" /> : null}
          <strong>{sourceName(s.id)}</strong>
          {s.ref ? <span className="mono small muted">{t("data.fetch.ref", { ref: s.ref })}</span> : null}
        </span>
        <span className={`badge ${stageTone(s.stage)}`.trim()}>{stageLabel(s.stage)}</span>
      </div>
      {s.stage === "downloading" && s.total > 0 ? <progress value={s.index} max={s.total} aria-label={`${sourceName(s.id)}: ${t("data.fetch.files", { index: s.index, total: s.total })}`} /> : null}
      <div className="small muted">
        {s.stage === "downloading" ? t("data.fetch.files", { index: s.index, total: s.total }) : null}
        {s.stage === "parsing" ? t("data.fetch.parsingFiles", { files: s.files }) : null}
        {s.stage === "parsed" && s.counts ? `${countsLine(s.counts)} · ${s.warnings ? t("data.fetch.warnings", { n: s.warnings }) : t("data.fetch.noWarnings")}` : null}
        {s.stage === "failed" ? <span className="mono">{s.message}</span> : null}
      </div>
      {s.sample.length ? (
        <details className="small">
          <summary>{t("data.fetch.warnings", { n: s.warnings })}</summary>
          <ul className="mono muted" style={{ margin: "0.3rem 0 0", paddingLeft: "1.1rem" }}>
            {s.sample.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
            {s.warnings > s.sample.length ? <li>{t("data.fetch.moreWarnings", { n: s.warnings - s.sample.length })}</li> : null}
          </ul>
        </details>
      ) : null}
    </li>
  );
}

/** Data page panel: fetch MFM points + BSData catalogues in a worker and store the built snapshot. */
export function FetchSources() {
  const { refreshSnapshots, setActiveSnapshot, notify } = useApp();
  const [selection, setSelection] = usePersistedSetting<ImportSelection>(SETTING_KEY, DEFAULT_SELECTION, parseSelection);
  const [progress, dispatch] = useReducer(reduceProgress, IDLE_PROGRESS);
  // A run started before this mount (the user navigated away and back) keeps going in the worker.
  const [background, setBackground] = useState(() => importClient().running);
  const alive = useRef(true);
  const filterId = "data-fetch-filter";

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const running = isRunning(progress);
  const request = importRequestFor(selection);
  const pointsOnly = selection.sources["mfm-yaml"] && !selection.sources["bsdata-json"];

  const start = useCallback(async () => {
    const req = importRequestFor(selection);
    if (!req.sources.length) {
      notify(t("data.fetch.select"), "error");
      return;
    }
    const client = importClient();
    if (client.running) {
      notify(t("data.fetch.busy"), "info");
      return;
    }
    dispatch({ type: "start", sources: req.sources });
    try {
      const { snapshot, summary } = await client.run(req, (e) => {
        if (alive.current) dispatch(e);
      });
      // Store even if the panel was unmounted meanwhile: the download already happened.
      await db.snapshots.put(snapshot);
      await refreshSnapshots();
      await setActiveSnapshot(snapshot.id);
      notify(t("data.fetch.doneNotice", { label: snapshot.label ?? snapshot.id }), "success");
      if (alive.current) dispatch({ type: "done", summary });
    } catch (e) {
      if (!alive.current) return;
      if (e instanceof ImportCancelledError || classifyError(e) === "cancelled") {
        dispatch({ type: "cancelled" });
        return;
      }
      dispatch({ type: "error", message: errorMessage(e), kind: classifyError(e) });
    } finally {
      if (alive.current) setBackground(false);
    }
  }, [selection, notify, refreshSnapshots, setActiveSnapshot]);

  const cancel = useCallback(() => {
    importClient().cancel();
    setBackground(false);
  }, []);

  const toggle = (id: BrowserSourceId, on: boolean) => setSelection((s) => ({ ...s, sources: { ...s.sources, [id]: on } }));

  return (
    <section className="panel" aria-labelledby="data-fetch-h">
      <div className="panel-head">
        <h2 id="data-fetch-h">{t("data.fetch.title")}</h2>
      </div>
      <p className="small muted">{t("data.fetch.intro")}</p>

      <fieldset className="source-options" disabled={running}>
        <legend className="small muted" style={{ textTransform: "uppercase", letterSpacing: "0.06em", fontSize: "0.7rem" }}>
          {t("data.fetch.sourcesLabel")}
        </legend>
        {BROWSER_SOURCES.map((id) => {
          const def = SOURCES[id];
          return (
            <label key={id} className="source-option">
              <input type="checkbox" checked={selection.sources[id]} onChange={(e) => toggle(id, e.target.checked)} />
              <span className="desc">
                <span>
                  <strong>{sourceName(id)}</strong> <span className="muted">— {def.role}</span>
                </span>
                <span className="small muted">{t("data.fetch.attribution", { attribution: def.attribution })}</span>
                <span className="small muted">{t("data.fetch.licence", { licence: def.licence })}</span>
                <span className="small muted">{sourceSize(id)}</span>
              </span>
            </label>
          );
        })}
      </fieldset>

      <div className="field-row" style={{ marginTop: "0.75rem" }}>
        <Field label={t("data.fetch.filter")} hint={t("data.fetch.filterHint")} className="grow">
          <input id={filterId} type="text" value={selection.factionFilter} placeholder={t("data.fetch.filterPlaceholder")} disabled={running || !selection.sources["bsdata-json"]} onChange={(e) => setSelection((s) => ({ ...s, factionFilter: e.target.value }))} />
        </Field>
      </div>
      {pointsOnly ? <p className="small muted">{t("data.fetch.pointsOnly")}</p> : null}

      <div className="row" style={{ marginTop: "0.75rem" }}>
        <button type="button" className="primary" disabled={running || background || request.sources.length === 0} onClick={() => void start()}>
          {t("data.fetch.run")}
        </button>
        {running || background ? (
          <button type="button" onClick={cancel}>
            {t("data.fetch.cancel")}
          </button>
        ) : null}
        {running ? <Spinner label={progress.stage === "merging" ? t("data.fetch.merging") : progress.stage === "building" ? t("data.fetch.building") : t("data.fetch.stage.downloading")} /> : null}
      </div>
      {background ? <p className="small muted">{t("data.fetch.background")}</p> : null}

      {progress.sources.length ? (
        <ol className="progress-list" aria-label={t("data.fetch.progress")} aria-live="polite">
          {progress.sources.map((s) => (
            <SourceRow key={s.id} s={s} />
          ))}
          {progress.merge ? <li className="progress-item parsed small">{t("data.fetch.merged", { conflicts: fmtInt(progress.merge.conflicts), unmatched: fmtInt(progress.merge.unmatched), warnings: fmtInt(progress.merge.warnings) })}</li> : progress.stage === "merging" ? <li className="progress-item small">{t("data.fetch.merging")}</li> : null}
          {progress.stage === "building" ? <li className="progress-item small">{t("data.fetch.building")}</li> : null}
        </ol>
      ) : null}

      {progress.stage === "done" && progress.summary ? (
        <div className="result-box" role="status" style={{ marginTop: "0.75rem" }}>
          <strong>{t("data.fetch.done", { label: progress.summary.label ?? progress.summary.snapshotId, s: (progress.summary.elapsedMs / 1000).toFixed(1) })}</strong>
          <dl className="kv" style={{ marginTop: 6 }}>
            <dt>{t("data.id")}</dt>
            <dd className="mono">{progress.summary.snapshotId}</dd>
            <dt>{t("data.counts")}</dt>
            <dd>
              {t("data.countsLine", { factions: progress.summary.counts.factions, datasheets: progress.summary.counts.datasheets, abilities: progress.summary.counts.abilities, detachments: progress.summary.counts.detachments, stratagems: progress.summary.counts.stratagems, priceRules: progress.summary.counts.priceRules })}
              {progress.summary.conflicts ? ` · ${t("data.conflicts", { n: progress.summary.conflicts })}` : ""}
            </dd>
            <dt>{t("data.fetch.refs")}</dt>
            <dd>
              {progress.summary.sources.map((s, i) => (
                <div key={i} className="mono">
                  {s.adapter}
                  {s.ref ? ` @ ${s.ref}` : ""}
                </div>
              ))}
            </dd>
          </dl>
        </div>
      ) : null}

      {progress.stage === "cancelled" ? (
        <p className="small muted" role="status">
          {t("data.fetch.cancelled")}
        </p>
      ) : null}

      {progress.stage === "error" && progress.error ? (
        <div className="error-box" role="alert" style={{ marginTop: "0.75rem" }}>
          <strong>{t("data.fetch.failed", { msg: progress.error.message })}</strong>
          <p className="small" style={{ margin: "0.4rem 0" }}>
            {errorHint(progress.error.kind)}
          </p>
          <p className="small muted" style={{ margin: "0.4rem 0" }}>
            {t("data.fetch.hint.cli")} <code className="cmd">{CLI_IMPORT_COMMAND}</code>
          </p>
          <div className="row">
            <button type="button" className="primary sm" onClick={() => void start()}>
              {t("data.fetch.retry")}
            </button>
            <button type="button" className="sm" onClick={() => dispatch({ type: "reset" })}>
              {t("common.close")}
            </button>
          </div>
        </div>
      ) : null}

      <p className="small muted" style={{ marginTop: "0.9rem" }}>
        {t("data.fetch.wahapedia")} <code className="cmd">{CLI_IMPORT_COMMAND}</code>{" "}
        <a href={README_URL} target="_blank" rel="noreferrer">
          {t("data.fetch.readme")}
        </a>
      </p>
    </section>
  );
}
