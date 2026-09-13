import { forwardRef, useCallback, useEffect, useImperativeHandle, useReducer, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { SOURCES } from "@grimstat/adapters";
import type { SourceRef } from "@grimstat/schema";
import { db } from "../../db";
import { useApp } from "../../state/AppContext";
import { usePersistedSetting } from "../../hooks/usePersistedSetting";
import { ImportCancelledError, importClient } from "../../worker/importClient";
import { BROWSER_GAME_SYSTEM_ID, BROWSER_SOURCES, DEFAULT_WAHAPEDIA_MIRROR, IDLE_PROGRESS, MIRRORED_SOURCE, WAHAPEDIA_MIRROR_SETTING, classifyError, errorMessage, hasMirror, importRequestFor, isRunning, reduceProgress, refreshRequestFor, wahapediaMirrorBase, type BrowserSourceId, type ImportErrorKind, type ImportRequest, type ImportSelection, type SourceProgress } from "../../lib/importProgress";
import { freshnessOf, knownAfterFetch, latestRefFor, type Freshness } from "../../lib/sourceFreshness";
import { fmtDay, fmtInt } from "../../lib/format";
import { PanelHead, PillChip, ProportionBar } from "../kit";
import { t, type I18nKey } from "../../i18n";

export const CLI_IMPORT_COMMAND = "pnpm cli import --system wh40k-11e --out data/snapshots";
export const README_URL = "https://github.com/N041M/Grimstat#getting-started";
const SETTING_KEY = "data.fetch.selection";
const FRESHNESS_KEY = "data.fetch.freshness";
/** A check older than this is made again when the panel opens; a fetch refreshes it for free. */
const RECHECK_AFTER_MS = 6 * 60 * 60 * 1000;
const DEFAULT_SELECTION: ImportSelection = { sources: { "mfm-yaml": true, "bsdata-json": true, "wahapedia-csv": true }, factionFilter: "" };

/** The card deck: every source a browser can reach, Wahapedia through its mirror. */
const CARD_SOURCES = BROWSER_SOURCES;
type CardSourceId = BrowserSourceId;

function parseSelection(raw: unknown): ImportSelection | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as { sources?: unknown; factionFilter?: unknown };
  const src = r.sources && typeof r.sources === "object" ? (r.sources as Record<string, unknown>) : {};
  return { sources: { "mfm-yaml": src["mfm-yaml"] !== false, "bsdata-json": src["bsdata-json"] !== false, "wahapedia-csv": src["wahapedia-csv"] !== false }, factionFilter: typeof r.factionFilter === "string" ? r.factionFilter : "" };
}

/** What upstream said its sources were at, the last time anything asked. */
interface FreshnessRecord {
  checkedAt?: string;
  latest: Partial<Record<CardSourceId, string>>;
}

const NO_FRESHNESS: FreshnessRecord = { latest: {} };

function parseFreshness(raw: unknown): FreshnessRecord | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as { checkedAt?: unknown; latest?: unknown };
  const src = r.latest && typeof r.latest === "object" ? (r.latest as Record<string, unknown>) : {};
  const latest: Partial<Record<CardSourceId, string>> = {};
  for (const id of BROWSER_SOURCES) if (typeof src[id] === "string") latest[id] = src[id] as string;
  return { ...(typeof r.checkedAt === "string" ? { checkedAt: r.checkedAt } : {}), latest };
}

const NAME_KEY: Record<CardSourceId, I18nKey> = { "mfm-yaml": "data.fetch.source.mfm-yaml", "bsdata-json": "data.fetch.source.bsdata-json", "wahapedia-csv": "data.fetch.source.wahapedia-csv" };
const KIND_KEY: Record<CardSourceId, I18nKey> = { "mfm-yaml": "data.source.kind.mfm-yaml", "bsdata-json": "data.source.kind.bsdata-json", "wahapedia-csv": "data.source.kind.wahapedia-csv" };

/** The shared import client's `running`, read through React so a panel re-renders when it changes. */
const subscribeToImport = (listener: () => void) => importClient().subscribe(listener);
const importIsRunning = () => importClient().running;

function sourceName(id: CardSourceId): string {
  return t(NAME_KEY[id]);
}

function sourceSize(id: BrowserSourceId): string {
  if (id === "mfm-yaml") return t("data.fetch.size.mfm-yaml");
  return id === "bsdata-json" ? t("data.fetch.size.bsdata-json") : t("data.fetch.size.wahapedia-csv");
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
  /** Upstream has moved on, so the pill asks for attention without claiming a run is under way. */
  stale?: boolean;
  /** Accent-tinted pill + bar while something is in flight or wrong; neutral otherwise. */
  live: boolean;
  fraction: number;
  detail: string;
  when: string;
}

/**
 * Reconcile a source's live fetch progress with what the active snapshot already carries. A run in
 * progress always wins. Otherwise the card says one thing about the stored copy: current when it
 * matches what upstream serves, outdated when it does not, not checked when nobody has asked, and
 * not fetched when there is no copy at all.
 */
export function cardModel(id: CardSourceId, progress: SourceProgress | undefined, stored: SourceRef | undefined, storedCount: number | undefined, freshness: Freshness = "unknown"): CardModel {
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
  if (stored) {
    const status = freshness === "current" ? t("data.source.current") : freshness === "stale" ? t("data.source.outdated") : t("data.source.notChecked");
    return { status, live: false, stale: freshness === "stale", fraction: 1, detail: storedCount === undefined ? (stored.ref ?? t("data.source.stored")) : t("data.source.datasheets", { n: fmtInt(storedCount) }), when: fmtDay(stored.fetchedAt) };
  }
  return { status: t("data.source.notFetched"), live: false, fraction: 0, detail: SOURCES[id].role, when: "–" };
}

function SourceCard({ id, model, selectable, selected, disabled, onSelect, onRefresh, footer }: { id: CardSourceId; model: CardModel; selectable: boolean; selected?: boolean; disabled?: boolean; onSelect?: (on: boolean) => void; onRefresh?: () => void; footer?: ReactNode }) {
  return (
    <article className="src-card">
      <div className="src-card-top">
        <div className="src-card-id">
          <div className="src-card-name">{sourceName(id)}</div>
          <div className="src-card-kind">{t(KIND_KEY[id])}</div>
        </div>
        <span className={`src-pill ${model.live ? "live" : model.stale ? "stale" : ""}`.trim()}>{model.status}</span>
      </div>
      <ProportionBar value={model.fraction} height={5} tone={model.live ? "accent" : "ink"} />
      <div className="src-card-foot">
        <span title={model.detail}>{model.detail}</span>
        <span>{model.when}</span>
      </div>
      {selectable ? (
        <div className="src-card-select">
          <PillChip label={t("data.source.include")} on={!!selected} title={disabled ? t("data.fetch.busy") : SOURCES[id].attribution} onChange={(on) => !disabled && onSelect?.(on)} />
          {onRefresh ? (
            <button type="button" className="sm src-card-fetch" disabled={disabled} onClick={onRefresh} title={t("data.fetch.oneHint")}>
              {t("data.fetch.one")}
            </button>
          ) : null}
          <span className="src-card-size">{selectable && id !== "wahapedia-csv" ? sourceSize(id as BrowserSourceId) : ""}</span>
        </div>
      ) : null}
      {footer}
    </article>
  );
}

/** What the Data page's "Fetch everything" button drives: the same run as the panel's own button. */
export interface FetchSourcesHandle {
  run: () => Promise<void>;
}

/**
 * Data page: the three source cards plus the in-browser fetch (MFM points + BSData catalogues) that
 * fills them — selection, faction filter, progress, cancel and the errors the run can end with.
 */
export const FetchSources = forwardRef<FetchSourcesHandle>(function FetchSources(_props, ref) {
  const { refreshSnapshots, setActiveSnapshot, notify, rawSnapshot } = useApp();
  const [selection, setSelection] = usePersistedSetting<ImportSelection>(SETTING_KEY, DEFAULT_SELECTION, parseSelection);
  const [mirror, setMirror] = usePersistedSetting<string>(WAHAPEDIA_MIRROR_SETTING, DEFAULT_WAHAPEDIA_MIRROR, (raw) => (typeof raw === "string" ? raw : undefined));
  const [freshness, setFreshness, freshnessLoaded] = usePersistedSetting<FreshnessRecord>(FRESHNESS_KEY, NO_FRESHNESS, parseFreshness);
  const [checking, setChecking] = useState(false);
  const [progress, dispatch] = useReducer(reduceProgress, IDLE_PROGRESS);
  const clientRunning = useSyncExternalStore(subscribeToImport, importIsRunning);
  const alive = useRef(true);
  const filterId = "data-fetch-filter";

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const running = isRunning(progress);
  // A run started before this mount (the user navigated away and back) keeps going in the worker,
  // and it ends without this panel's own code hearing about it, so the client is asked each render
  // rather than remembered from mount time.
  const background = clientRunning && !running;
  const mirrored = hasMirror(mirror);
  const request = importRequestFor(selection, undefined, mirror);
  const pointsOnly = selection.sources["mfm-yaml"] && !selection.sources["bsdata-json"];
  const datasheetCount = rawSnapshot?.data.datasheets.length;

  /**
   * The one path both buttons take: run, store, activate, and record what each source came back at
   * so the freshness badges are right without asking upstream again.
   */
  const runRequest = useCallback(async (req: ImportRequest) => {
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
      setFreshness((f) => ({ ...f, latest: knownAfterFetch(f.latest, req.sources, snapshot.sources) }));
      if (alive.current) dispatch({ type: "done", summary });
    } catch (e) {
      if (!alive.current) return;
      if (e instanceof ImportCancelledError || classifyError(e) === "cancelled") {
        dispatch({ type: "cancelled" });
        return;
      }
      dispatch({ type: "error", message: errorMessage(e), kind: classifyError(e) });
    }
  }, [notify, refreshSnapshots, setActiveSnapshot, setFreshness]);

  const start = useCallback(async () => {
    const req = importRequestFor(selection, undefined, mirror);
    if (!req.sources.length) {
      notify(t("data.fetch.select"), "error");
      return;
    }
    await runRequest(req);
  }, [selection, mirror, notify, runRequest]);

  /** One card's own button: fetch that source and rebuild the snapshot already in hand around it. */
  const refreshOne = useCallback(
    async (id: BrowserSourceId) => {
      if (!rawSnapshot) {
        notify(t("data.fetch.oneNeedsSnapshot"), "error");
        return;
      }
      await runRequest(refreshRequestFor(id, selection, rawSnapshot.sources, undefined, mirror));
    },
    [rawSnapshot, selection, mirror, notify, runRequest],
  );

  /** Ask each source what version it is serving. One small request each, none of them the source itself. */
  const checkUpdates = useCallback(async () => {
    setChecking(true);
    const latest: Partial<Record<BrowserSourceId, string>> = {};
    await Promise.all(
      CARD_SOURCES.map(async (id) => {
        try {
          const ref = await latestRefFor(id, { fetch: (url) => fetch(url), ...(id === MIRRORED_SOURCE && hasMirror(mirror) ? { mirror: wahapediaMirrorBase(mirror, BROWSER_GAME_SYSTEM_ID) } : {}) });
          if (ref) latest[id] = ref;
        } catch {
          // A source that will not say stays unknown rather than failing the check for the others.
        }
      }),
    );
    if (!alive.current) return;
    setFreshness({ checkedAt: new Date().toISOString(), latest });
    setChecking(false);
  }, [mirror, setFreshness]);

  // Opening the page on a snapshot nobody has checked in a while is the moment the answer matters.
  const autoChecked = useRef(false);
  useEffect(() => {
    if (autoChecked.current || !freshnessLoaded || !rawSnapshot || checking) return;
    const last = freshness.checkedAt ? Date.parse(freshness.checkedAt) : 0;
    if (Number.isFinite(last) && Date.now() - last < RECHECK_AFTER_MS) return;
    autoChecked.current = true;
    void checkUpdates();
  }, [freshnessLoaded, rawSnapshot, freshness.checkedAt, checking, checkUpdates]);

  const cancel = useCallback(() => {
    importClient().cancel();
  }, []);

  useImperativeHandle(ref, () => ({ run: start }), [start]);

  const toggle = (id: BrowserSourceId, on: boolean) => setSelection((s) => ({ ...s, sources: { ...s.sources, [id]: on } }));
  const mirrorId = `${filterId}-mirror`;

  return (
    <section className="src-block" aria-labelledby="data-fetch-h">
      <PanelHead id="data-fetch-h" title={t("data.fetch.title")} />
      <div className="src-check">
        <button type="button" className="sm" disabled={checking || running} onClick={() => void checkUpdates()}>
          {checking ? t("data.fetch.checking") : t("data.fetch.check")}
        </button>
        {freshness.checkedAt ? <span className="small muted">{t("data.fetch.checkedAt", { when: fmtDay(freshness.checkedAt) })}</span> : null}
      </div>
      <div className="src-cards">
        {CARD_SOURCES.map((id) => {
          const stored = rawSnapshot?.sources.find((s) => s.adapter === id);
          const model = cardModel(id, progress.sources.find((s) => s.id === id), stored, id === "bsdata-json" ? datasheetCount : undefined, freshnessOf(id, stored?.ref, freshness.latest[id]));
          const needsMirror = id === MIRRORED_SOURCE && !mirrored;
          return (
            <SourceCard
              key={id}
              id={id}
              model={model}
              onRefresh={rawSnapshot && !needsMirror ? () => void refreshOne(id) : undefined}
              selectable={!needsMirror}
              selected={!needsMirror && selection.sources[id]}
              disabled={running}
              onSelect={(on) => toggle(id, on)}
              footer={id === MIRRORED_SOURCE ? <div className="src-card-note">{needsMirror ? t("data.fetch.wahapedia") : t("data.fetch.wahapediaMirrored")}</div> : undefined}
            />
          );
        })}
      </div>

      <div className="src-run">
        <label className="src-filter" htmlFor={filterId}>
          <span>{t("data.fetch.filter")}</span>
          <input id={filterId} type="text" value={selection.factionFilter} placeholder={t("data.fetch.filterPlaceholder")} disabled={running || !selection.sources["bsdata-json"]} onChange={(e) => setSelection((s) => ({ ...s, factionFilter: e.target.value }))} />
        </label>
        <label className="src-filter" htmlFor={mirrorId}>
          <span>{t("data.fetch.mirror")}</span>
          <input id={mirrorId} type="url" value={mirror} spellCheck={false} placeholder={DEFAULT_WAHAPEDIA_MIRROR} disabled={running} onChange={(e) => setMirror(e.target.value)} />
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
        <>
          <p className="src-note" role="status">
            {t("data.fetch.done", { label: progress.summary.label ?? progress.summary.snapshotId, s: (progress.summary.elapsedMs / 1000).toFixed(1) })}
          </p>
          {/* Said here rather than three screens later, where an empty Stratagems tab was the first sign of it. */}
          {progress.summary.counts.stratagems === 0 ? <p className="src-note warn-text">{t("data.fetch.noStratagems")}</p> : null}
        </>
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
          <details className="cli-details">
            <summary>{t("data.cli")}</summary>
            <p>{t("data.fetch.hint.cli")}</p>
            <p className="mono">{CLI_IMPORT_COMMAND}</p>
          </details>
        </div>
      ) : null}
    </section>
  );
});
