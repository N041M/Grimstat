import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import type { PublishedListRecord } from "../../db";
import { useApp } from "../../state/AppContext";
import { useStoreVersion } from "../../hooks/useStoreVersion";
import { clearPublishedLists, importPublishedFile, listPublishedLists, publishedSources } from "../../lib/publishedLists";
import { fmtInt } from "../../lib/format";
import { GridCell, GridHead, GridHeadCell, GridRow, GridTable, PanelHead } from "../kit";
import { t, tn } from "../../i18n";

/** Write-up | publication | lists | factions. */
const COLUMNS = "minmax(180px,2.4fr) minmax(110px,1fr) 60px minmax(140px,1.6fr)";

/**
 * Published tournament lists, imported onto this machine.
 *
 * Two kinds of file, one way in: the corpus the CLI writes, or a write-up page saved from the
 * browser — dropped here or chosen. The lists are other people's, so the table is arranged by where
 * they came from, and every write-up is a link back.
 */
export function PublishedLists() {
  const { notify } = useApp();
  const version = useStoreVersion("publishedLists");
  const [records, setRecords] = useState<PublishedListRecord[]>([]);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let alive = true;
    void listPublishedLists().then((rows) => {
      if (alive) setRecords(rows);
    });
    return () => {
      alive = false;
    };
  }, [version]);

  const sources = useMemo(() => publishedSources(records), [records]);

  const importFiles = async (files: FileList | File[] | null) => {
    if (!files || files.length === 0) return;
    setBusy(true);
    let added = 0;
    let found = 0;
    const problems: string[] = [];
    try {
      for (const file of Array.from(files)) {
        try {
          const result = await importPublishedFile(file.name, await file.text());
          added += result.added;
          found += result.found;
          for (const w of result.warnings) problems.push(`${file.name}: ${w}`);
        } catch (e) {
          problems.push(e instanceof Error ? e.message : String(e));
        }
      }
    } finally {
      setBusy(false);
    }
    const summary = t("data.published.imported", { added, found });
    if (found === 0 && problems.length) notify(t("data.published.nothing"), "error", problems.slice(0, 8));
    else notify(summary, problems.length ? "info" : "success", problems.slice(0, 8));
  };

  const onDrop = (e: DragEvent<HTMLElement>) => {
    e.preventDefault();
    setOver(false);
    void importFiles(e.dataTransfer.files);
  };

  return (
    <section
      aria-labelledby="data-published-h"
      className={`data-published ${over ? "is-over" : ""}`.trim()}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
    >
      <PanelHead
        id="data-published-h"
        title={t("data.published")}
        aside={
          <span className="data-published-actions">
            <span className="t-meta">{tn(records.length, "data.published.count.one", "data.published.count.many", { n: fmtInt(records.length) })}</span>
            <button type="button" className="sm" disabled={busy} onClick={() => input.current?.click()}>
              {t("data.published.import")}
            </button>
            {records.length ? (
              <button
                type="button"
                className="ghost sm danger"
                disabled={busy}
                onClick={() => {
                  if (window.confirm(t("data.published.confirmClear"))) void clearPublishedLists();
                }}
              >
                {t("data.published.clear")}
              </button>
            ) : null}
            <input
              ref={input}
              type="file"
              multiple
              accept=".json,.html,.htm,application/json,text/html"
              className="sr-only"
              aria-label={t("data.published.import")}
              onChange={(e) => {
                void importFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </span>
        }
      />
      {records.length === 0 ? (
        <p className="data-empty">{t("data.published.empty")}</p>
      ) : (
        <div className="data-table-card">
          <GridTable columns={COLUMNS} label={t("data.published")} className="published-table">
            <GridHead>
              <GridHeadCell>{t("data.published.col.writeUp")}</GridHeadCell>
              <GridHeadCell>{t("data.published.col.publication")}</GridHeadCell>
              <GridHeadCell align="end">{t("data.published.col.lists")}</GridHeadCell>
              <GridHeadCell>{t("data.published.col.factions")}</GridHeadCell>
            </GridHead>
            {sources.map((s) => (
              <GridRow key={s.key}>
                <GridCell>
                  {s.url ? (
                    <a href={s.url} target="_blank" rel="noreferrer">
                      {s.title}
                    </a>
                  ) : (
                    s.title
                  )}
                </GridCell>
                <GridCell tone="muted">{s.publication ?? "—"}</GridCell>
                <GridCell align="end" mono>
                  {fmtInt(s.lists)}
                </GridCell>
                <GridCell tone="muted">{s.factions.join(", ") || "—"}</GridCell>
              </GridRow>
            ))}
          </GridTable>
        </div>
      )}
      <p className="data-note">{t("data.published.note")}</p>
    </section>
  );
}
