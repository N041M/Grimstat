import { useCallback, useEffect, useReducer, useRef, useState, type ReactNode } from "react";
import { SOURCES } from "@grimstat/adapters";
import type { SourceRef } from "@grimstat/schema";
import { db } from "../../db";
import { useApp } from "../../state/AppContext";
import { usePersistedSetting } from "../../hooks/usePersistedSetting";
import { ImportCancelledError, importClient } from "../../worker/importClient";
import { BROWSER_SOURCES, IDLE_PROGRESS, classifyError, errorMessage, importRequestFor, isRunning, reduceProgress, type BrowserSourceId, type ImportErrorKind, type ImportSelection, type SourceProgress } from "../../lib/importProgress";
import { fmtDay, fmtInt } from "../../lib/format";
import { PillChip, ProportionBar } from "../kit";
import { t, type I18nKey } from "../../i18n";

export const CLI_IMPORT_COMMAND = "pnpm cli import --system wh40k-11e --out data/snapshots";
export const README_URL = "https://github.com/N041M/Grimstat#getting-started";
const SETTING_KEY = "data.fetch.selection";
const DEFAULT_SELECTION: ImportSelection = { sources: { "mfm-yaml": true, "bsdata-json": true }, factionFilter: "" };

/** The card deck: the two sources a browser can reach, then the CLI-only Wahapedia export. */
const CARD_SOURCES = [...BROWSER_SOURCES, "wahapedia-csv"] as const;
type CardSourceId = (typeof CARD_SOURCES)[number];

function parseSelection(raw: unknown): ImportSelection | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as { sources?: unknown; factionFilter?: unknown };
  const src = r.sources && typeof r.sources === "object" ? (r.sources as Record<string, unknown>) : {};
  return { sources: { "mfm-yaml": src["mfm-yaml"] !== false, "bsdata-json": src["bsdata-json"] !== false }, factionFilter: typeof r.factionFilter === "string" ? r.factionFilter : "" };
}

const NAME_KEY: Record<CardSourceId, I18nKey> = { "mfm-yaml": "data.fetch.source.mfm-yaml", "bsdata-json": "data.fetch.source.bsdata-json", "wahapedia-csv": "data.fetch.source.wahapedia-csv" };
const KIND_KEY: Record<CardSourceId, I18nKey> = { "mfm-yaml": "data.source.kind.mfm-yaml", "bsdata-json": "data.source.kind.bsdata-json", "wahapedia-csv": "data.source.kind.wahapedia-csv" };

function sourceName(id: CardSourceId): string {
  return t(NAME_KEY[id]);
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

function errorHint(kind: ImportErrorKind): string {
  return kind === "rate-limit" ? t("data.fetch.hint.rate-limit") : kind === "network" ? t("data.fetch.hint.network") : t("data.fetch.hint.other");
}

/** What one card shows: a status pill, a 5px bar and a detail/timestamp row. */
interface CardModel {
  status: string;
  /** Accent-tinted pill + bar while something is in flight or wrong; neutral otherwise. */
  live: boolean;
  fraction: number;
  detail: string;
  when: string;
}

/**
 * Reconcile a source's live fetch progress with what the active snapshot already carries. A run in
 * progress always wins; otherwise a snapshot that lists the adapter is "current", and anything else
 * has simply never been fetched onto this device.
 */
export function cardModel(id: CardSourceId, progress: SourceProgress | undefined, stored: SourceRef | undefined, storedCount: number | undefined): CardModel {
  if (progress && progress.stage !== "pending") {
    switch (progress.stage) {
      case "downloading":
        return { status: stageLabel(progress.stage), live: true, fraction: progress.total > 0 ? progress.index / progress.total : 0, detail: t("data.fetch.files", { index: progress.index, total: progress.total }), when: t("data.source.inProgress") };
      case "parsing":
        return { status: stageLabel(progress.stage), live: true, fraction: 1, detail: t("data.fetch.parsingFiles", { files: progress.files }), when: t("data.source.inProgress") };
      case "parsed":
        return { status: t("data.source.current"), live: false, fraction: 1, detail: progress.counts ? t("data.source.datasheets", { n: fmtInt(progress.counts.datasheets) }) : t("data.fetch.stage.parsed"), when: progress.ref ?? t("data.source.justNow") };
      case "failed":
        return { status: stageLabel(progress.stage), live: true, fraction: 0, detail: progress.message ?? t("data.fetch.stage.failed"), when: t("data.source.failed") };
    }
  }
  if (stored) return { status: t("data.source.current"), live: false, fraction: 1, detail: storedCount === undefined ? (stored.ref ?? t("data.source.stored")) : t("data.source.datasheets", { n: fmtInt(storedCount) }), when: fmtDay(stored.fetchedAt) };
  return { status: t("data.source.notFetched"), live: false, fraction: 0, detail: SOURCES[id].role, when: "–" };
}

function SourceCard({ id, model, selectable, selected, disabled, onSelect, footer }: { id: CardSourceId; model: CardModel; selectable: boolean; selected?: boolean; disabled?: boolean; onSelect?: (on: boolean) => void; footer?: ReactNode }) {
  return (
    <article className="src-card">
      <div className="src-card-top">
        <div className="src-card-id">
          <div className="src-card-name">{sourceName(id)}</div>
          <div className="src-card-kind">{t(KIND_KEY[id])}</div>
        </div>
        <span className={`src-pill ${model.live ? "live" : ""}`.trim()}>{model.status}</span>
      </div>
      <ProportionBar value={model.fraction} height={5} tone={model.live ? "accent" : "ink"} />
      <div className="src-card-foot">
        <span title={model.detail}>{model.detail}</span>
        <span>{model.when}</span>
      </div>
      {selectable ? (
        <div className="src-card-select">
          <PillChip label={selected ? t("data.source.included") : t("data.source.excluded")} on={!!selected} title={disabled ? t("data.fetch.busy") : SOURCES[id].attribution} onChange={(on) => !disabled && onSelect?.(on)} />
          <span className="src-card-size">{selectable && id !== "wahapedia-csv" ? sourceSize(id as BrowserSourceId) : ""}</span>
        </div>
      ) : null}
      {footer}
    </article>
  );
}

/**
 * Data page: the three source cards plus the in-browser fetch (MFM points + BSData catalogues) that
 * fills them — selection, faction filter, progress, cancel and the errors the run can end with.
 */
export function FetchSources() {
  const { refreshSnapshots, setActiveSnapshot, notify, rawSnapshot } = useApp();
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
  const datasheetCount = rawSnapshot?.data.datasheets.length;

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
    <section className="src-block" aria-labelledby="data-fetch-h">
      <h2 className="sr-only" id="data-fetch-h">
        {t("data.fetch.title")}
      </h2>
      <div className="src-cards">
        {CARD_SOURCES.map((id) => {
          const stored = rawSnapshot?.sources.find((s) => s.adapter === id);
          const model = cardModel(id, progress.sources.find((s) => s.id === id), stored, id === "bsdata-json" ? datasheetCount : undefined);
          const browser = id !== "wahapedia-csv";
          return (
            <SourceCard
              key={id}
              id={id}
              model={model}
              selectable={browser}
              selected={browser ? selection.sources[id as BrowserSourceId] : false}
              disabled={running}
              onSelect={(on) => toggle(id as BrowserSourceId, on)}
              footer={browser ? undefined : <div className="src-card-note">{t("data.fetch.wahapedia")}</div>}
            />
          );
        })}
      </div>

      <div className="src-run">
        <label className="src-filter" htmlFor={filterId}>
          <span>{t("data.fetch.filter")}</span>
          <input id={filterId} type="text" value={selection.factionFilter} placeholder={t("data.fetch.filterPlaceholder")} disabled={running || !selection.sources["bsdata-json"]} onChange={(e) => setSelection((s) => ({ ...s, factionFilter: e.target.value }))} />
        </label>
        <button type="button" className="primary" disabled={running || background || request.sources.length === 0} onClick={() => void start()}>
          {t("data.fetch.run")}
        </button>
        {running || background ? (
          <button type="button" onClick={cancel}>
            {t("data.fetch.cancel")}
          </button>
        ) : null}
        <span className="src-run-status" role="status" aria-live="polite">
          {running ? (progress.stage === "merging" ? t("data.fetch.merging") : progress.stage === "building" ? t("data.fetch.building") : t("data.fetch.stage.downloading")) : background ? t("data.fetch.background") : pointsOnly ? t("data.fetch.pointsOnly") : t("data.fetch.filterHint")}
        </span>
      </div>

      {progress.merge ? <p className="src-note">{t("data.fetch.merged", { conflicts: fmtInt(progress.merge.conflicts), unmatched: fmtInt(progress.merge.unmatched), warnings: fmtInt(progress.merge.warnings) })}</p> : null}

      {progress.stage === "done" && progress.summary ? (
        <p className="src-note" role="status">
          {t("data.fetch.done", { label: progress.summary.label ?? progress.summary.snapshotId, s: (progress.summary.elapsedMs / 1000).toFixed(1) })}
        </p>
      ) : null}

      {progress.stage === "cancelled" ? (
        <p className="src-note" role="status">
          {t("data.fetch.cancelled")}
        </p>
      ) : null}

      {progress.stage === "error" && progress.error ? (
        <div className="src-error" role="alert">
          <strong>{t("data.fetch.failed", { msg: progress.error.message })}</strong>
          <p>{errorHint(progress.error.kind)}</p>
          <p className="mono">{CLI_IMPORT_COMMAND}</p>
          <div className="src-error-actions">
            <button type="button" className="primary" onClick={() => void start()}>
              {t("data.fetch.retry")}
            </button>
            <button type="button" onClick={() => dispatch({ type: "reset" })}>
              {t("common.close")}
            </button>
            <a href={README_URL} target="_blank" rel="noreferrer">
              {t("data.fetch.readme")}
            </a>
          </div>
        </div>
      ) : null}
    </section>
  );
}
