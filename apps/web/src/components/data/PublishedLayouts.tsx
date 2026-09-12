import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { FORTYKDC } from "@grimstat/adapters";
import { useApp } from "../../state/AppContext";
import { useStoreVersion } from "../../hooks/useStoreVersion";
import { LAYOUT_FILE_COUNT, fetchPublishedLayouts, publishedIn } from "../../lib/layoutFetch";
import { listLayouts } from "../../lib/layoutStore";
import { fmtInt } from "../../lib/format";
import { PanelHead } from "../kit";
import { t, tn } from "../../i18n";

/** What the Data page's "Fetch everything" button drives: the same fetch as the panel's own button. */
export interface PublishedLayoutsHandle {
  fetch: () => Promise<void>;
}

/**
 * The published terrain layouts, fetched onto this machine.
 *
 * The Battle table only reads the layout library. Fetching the Event Companion cards from the
 * community dataset happens here, with the other community sources, and the table picks them up
 * through the store's change event like any other saved layout.
 */
export const PublishedLayouts = forwardRef<PublishedLayoutsHandle>(function PublishedLayouts(_props, ref) {
  const { notify } = useApp();
  const version = useStoreVersion("terrainLayouts");
  const [published, setPublished] = useState(0);
  const [fetching, setFetching] = useState(false);
  /** Files read of the files the fetch will read, while one is running. */
  const [progress, setProgress] = useState<{ done: number; total: number } | undefined>(undefined);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    let alive = true;
    void listLayouts().then((rows) => {
      if (alive) setPublished(publishedIn(rows));
    });
    return () => {
      alive = false;
    };
  }, [version]);

  const fetchLayouts = async () => {
    const controller = new AbortController();
    abort.current = controller;
    setFetching(true);
    setProgress(undefined);
    try {
      const result = await fetchPublishedLayouts({ signal: controller.signal, onProgress: (done, total) => setProgress({ done, total }) });
      notify(t("data.layouts.fetched", { n: result.stored, ref: result.ref ?? "main" }), "success", result.warnings.slice(0, 8));
    } catch (e) {
      if (controller.signal.aborted) notify(t("data.layouts.cancelled"), "info");
      else notify(t("data.layouts.failed"), "error", [e instanceof Error ? e.message : String(e)]);
    } finally {
      abort.current = null;
      setFetching(false);
      setProgress(undefined);
    }
  };

  useImperativeHandle(ref, () => ({ fetch: fetchLayouts }));

  return (
    <section aria-labelledby="data-layouts-h">
      <PanelHead
        id="data-layouts-h"
        title={t("data.layouts")}
        aside={
          <span className="data-published-actions">
            <span className="t-meta">{published ? tn(published, "data.layouts.count.one", "data.layouts.count.many", { n: fmtInt(published) }) : t("data.layouts.none")}</span>
            <button type="button" className={`sm ${published ? "" : "primary"}`.trim()} disabled={fetching} onClick={() => void fetchLayouts()}>
              {fetching ? t("data.layouts.fetching") : published ? t("data.layouts.refresh") : t("data.layouts.fetch")}
            </button>
            {fetching ? (
              <>
                <span className="t-meta fetch-progress" role="status" aria-live="polite">
                  {t("data.layouts.progress", { done: progress?.done ?? 0, total: progress?.total ?? LAYOUT_FILE_COUNT })}
                </span>
                <button type="button" className="sm" onClick={() => abort.current?.abort()}>
                  {t("common.cancel")}
                </button>
              </>
            ) : null}
          </span>
        }
      />
      <p className="data-note">
        {t("data.layouts.hint")}{" "}
        <a href={FORTYKDC.repo} target="_blank" rel="noreferrer">
          {FORTYKDC.name}
        </a>
        {", "}
        <a href={FORTYKDC.licenceUrl} target="_blank" rel="noreferrer">
          {FORTYKDC.licence}
        </a>
        {". "}
        {t("data.layouts.where")}
      </p>
    </section>
  );
});
