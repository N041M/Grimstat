import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { guessListHeader } from "@grimstat/adapters";
import type { PublishedListRecord } from "../../db";
import { useApp } from "../../state/AppContext";
import { useStoreVersion } from "../../hooks/useStoreVersion";
import { usePersistedSetting } from "../../hooks/usePersistedSetting";
import { classifyPublishedText, clearPublishedLists, feedChecklist, importPastedList, importPublishedFile, listPublishedLists, parsePublishedFeed, publishedSources, readPublishedFeed, type PublishedFeed } from "../../lib/publishedLists";
import { CORPUS_SETTING, CORPUS_URL_SETTING, DEFAULT_CORPUS_URL, fetchPublishedCorpus, parseCorpusRecord, type CorpusRecord } from "../../lib/corpusFetch";
import { fmtDay, fmtInt } from "../../lib/format";
import { GridCell, GridHead, GridHeadCell, GridRow, GridTable, PanelHead } from "../kit";
import { Dialog, Field } from "../ui";
import { t, tn } from "../../i18n";

/** Write-up | publication | lists | factions. */
const COLUMNS = "minmax(180px,2.4fr) minmax(110px,1fr) 60px minmax(140px,1.6fr)";
/** Published | write-up | lists stored. */
const FEED_COLUMNS = "90px minmax(200px,3fr) 100px";
const FEED_SETTING = "data.published.feed";
/** The CLI's way of reading the feed, shown because a browser has none. */
export const CLI_FEED_COMMAND = "pnpm cli competitive --feed https://<publication>/tag/competitive-innovations/feed/";

/** The paste form as typed. Values stay strings until Add turns them into a list. */
interface PasteForm {
  text: string;
  player: string;
  faction: string;
  detachments: string;
  disposition: string;
  placing: string;
  source: string;
  url: string;
}
const EMPTY_FORM: PasteForm = { text: "", player: "", faction: "", detachments: "", disposition: "", placing: "", source: "", url: "" };

/** The fields the list's own header can fill. */
type GuessedField = "faction" | "detachments" | "disposition";
type Guessed = Record<GuessedField, boolean>;
const ALL_GUESSED: Guessed = { faction: true, detachments: true, disposition: true };

/**
 * Published tournament lists, imported onto this machine.
 *
 * The panel fetches nothing itself. A write-up page saved from the browser, or the corpus the CLI
 * writes, can be dropped or chosen; a single list can be pasted along with where it was seen; and a
 * saved copy of the write-ups feed becomes a checklist of what exists against what is stored. The
 * table is arranged by source, and every write-up links back to where it was published.
 */
export function PublishedLists() {
  const { notify } = useApp();
  const version = useStoreVersion("publishedLists");
  const [records, setRecords] = useState<PublishedListRecord[]>([]);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const [feed, setFeed] = usePersistedSetting<PublishedFeed | null>(FEED_SETTING, null, parsePublishedFeed);
  const [corpus, setCorpus] = usePersistedSetting<CorpusRecord | null>(CORPUS_SETTING, null, parseCorpusRecord);
  const [corpusUrl, setCorpusUrl] = usePersistedSetting<string>(CORPUS_URL_SETTING, DEFAULT_CORPUS_URL, (raw) => (typeof raw === "string" && raw.trim() ? raw : undefined));
  const [fetching, setFetching] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [form, setForm] = useState<PasteForm>(EMPTY_FORM);
  /** Whether each prefilled field still holds a guess. Guessed fields follow the text as it changes; a field the user typed in keeps their value. */
  const [guessed, setGuessed] = useState<Guessed>(ALL_GUESSED);
  const filesInput = useRef<HTMLInputElement>(null);
  const feedInput = useRef<HTMLInputElement>(null);

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
  const checklist = useMemo(() => (feed ? feedChecklist(feed, records) : []), [feed, records]);
  const otherGames = feed ? feed.entries.filter((e) => !e.isWarhammer40k).length : 0;

  const importFiles = async (files: FileList | File[] | null) => {
    if (!files || files.length === 0) return;
    setBusy(true);
    let added = 0;
    let found = 0;
    let loadedFeed: PublishedFeed | undefined;
    const problems: string[] = [];
    try {
      for (const file of Array.from(files)) {
        try {
          const text = await file.text();
          if (classifyPublishedText(text) === "feed") {
            loadedFeed = readPublishedFeed(text);
            continue;
          }
          const result = await importPublishedFile(file.name, text);
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
    if (loadedFeed) {
      setFeed(loadedFeed);
      const rows = feedChecklist(loadedFeed, records);
      notify(tn(rows.length, "data.published.feed.read.one", "data.published.feed.read.many", { pending: rows.filter((r) => r.lists === 0).length }), "success");
    }
    if (found === 0 && !loadedFeed && problems.length) notify(t("data.published.nothing"), "error", problems.slice(0, 8));
    else if (found || problems.length) notify(t("data.published.imported", { added, found }), problems.length ? "info" : "success", problems.slice(0, 8));
  };

  const fetchCorpus = async () => {
    setFetching(true);
    try {
      const result = await fetchPublishedCorpus(corpusUrl);
      setCorpus(result.record);
      notify(t("data.published.corpus.fetched", { added: result.added, found: result.found }), result.warnings.length ? "info" : "success", result.warnings.slice(0, 8));
    } catch (e) {
      notify(t("data.published.corpus.failed"), "error", [e instanceof Error ? e.message : String(e)]);
    } finally {
      setFetching(false);
    }
  };

  const onDrop = (e: DragEvent<HTMLElement>) => {
    e.preventDefault();
    setOver(false);
    void importFiles(e.dataTransfer.files);
  };

  // The list's own header fills in the fields the user has not typed in. The guess can be corrected by hand.
  const onText = (text: string) => {
    const guess = guessListHeader(text);
    setForm((f) => ({ ...f, text, faction: guessed.faction ? (guess.faction ?? "") : f.faction, detachments: guessed.detachments ? (guess.detachment ?? "") : f.detachments, disposition: guessed.disposition ? (guess.forceDisposition ?? "") : f.disposition }));
  };
  const typed = (field: GuessedField, value: string) => {
    setForm((f) => ({ ...f, [field]: value }));
    setGuessed((g) => ({ ...g, [field]: false }));
  };
  const closePaste = () => {
    setPasteOpen(false);
    setForm(EMPTY_FORM);
    setGuessed(ALL_GUESSED);
  };
  const addPasted = async () => {
    const placing = Number.parseInt(form.placing, 10);
    setBusy(true);
    try {
      const result = await importPastedList({
        listText: form.text,
        player: form.player,
        faction: form.faction,
        detachments: form.detachments,
        forceDisposition: form.disposition,
        ...(Number.isFinite(placing) && placing > 0 ? { placing } : {}),
        sourceTitle: form.source,
        sourceUrl: form.url,
      });
      if (!result) {
        notify(t("data.published.paste.none"), "error");
        return;
      }
      notify(t(result.added ? "data.published.paste.added" : "data.published.paste.duplicate", { heading: result.list.heading }), result.added ? "success" : "info");
      closePaste();
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setBusy(false);
    }
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
            <button type="button" className="primary sm" disabled={busy || fetching} onClick={() => void fetchCorpus()}>
              {fetching ? t("data.published.corpus.fetching") : corpus ? t("data.published.corpus.refresh") : t("data.published.corpus")}
            </button>
            <button type="button" className="sm" disabled={busy} onClick={() => setPasteOpen(true)}>
              {t("data.published.paste")}
            </button>
            <button type="button" className="sm" disabled={busy} onClick={() => filesInput.current?.click()}>
              {t("data.published.import")}
            </button>
            <button type="button" className="sm" disabled={busy} onClick={() => feedInput.current?.click()}>
              {t("data.published.feed")}
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
              ref={filesInput}
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
            <input
              ref={feedInput}
              type="file"
              accept=".xml,.rss,.atom,application/rss+xml,application/atom+xml,application/xml,text/xml"
              className="sr-only"
              aria-label={t("data.published.feed")}
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

      <div className="data-table-card published-corpus">
        <div className="published-feed-head">
          <span className="published-feed-title" id="data-published-corpus-h">
            {corpus?.sourceUrl ? (
              <a href={corpus.sourceUrl} target="_blank" rel="noreferrer">
                {corpus.sourceName || t("data.published.corpus.title")}
              </a>
            ) : (
              t("data.published.corpus.title")
            )}
            <span className="t-meta">{corpus ? t("data.published.corpus.meta", { lists: fmtInt(corpus.lists), tournaments: fmtInt(corpus.tournaments), generated: fmtDay(corpus.generatedAt), fetched: fmtDay(corpus.fetchedAt) }) : t("data.published.corpus.none")}</span>
          </span>
          <label className="published-corpus-url">
            <span className="t-meta">{t("data.published.corpus.url")}</span>
            <input type="url" value={corpusUrl} spellCheck={false} onChange={(e) => setCorpusUrl(e.target.value)} />
          </label>
        </div>
        <p className="data-note published-feed-note">
          {t("data.published.corpus.hint")}
          {corpus?.attribution ? ` ${corpus.attribution}.` : ""}
        </p>
      </div>

      {feed ? (
        <div className="data-table-card published-feed" aria-labelledby="data-published-feed-h">
          <div className="published-feed-head">
            <span className="published-feed-title" id="data-published-feed-h">
              {feed.url ? (
                <a href={feed.url} target="_blank" rel="noreferrer">
                  {feed.title ?? t("data.published.feed.title")}
                </a>
              ) : (
                (feed.title ?? t("data.published.feed.title"))
              )}
              <span className="t-meta">{t("data.published.feed.loaded", { day: fmtDay(feed.loadedAt) })}</span>
            </span>
            <span className="data-published-actions">
              {feed.url ? (
                <a className="data-link" href={feed.url} target="_blank" rel="noreferrer">
                  {t("data.published.feed.open")}
                </a>
              ) : null}
              <button type="button" className="ghost sm" disabled={busy} onClick={() => setFeed(null)}>
                {t("data.published.feed.forget")}
              </button>
            </span>
          </div>
          {checklist.length === 0 ? (
            <p className="data-empty published-feed-note">{t("data.published.feed.none")}</p>
          ) : (
            <GridTable columns={FEED_COLUMNS} label={t("data.published.feed.title")} className="published-feed-table">
              <GridHead>
                <GridHeadCell>{t("data.published.feed.col.date")}</GridHeadCell>
                <GridHeadCell>{t("data.published.feed.col.writeUp")}</GridHeadCell>
                <GridHeadCell align="end">{t("data.published.feed.col.stored")}</GridHeadCell>
              </GridHead>
              {checklist.map(({ entry, lists }) => (
                <GridRow key={entry.url}>
                  <GridCell tone="muted" mono>
                    {fmtDay(entry.published)}
                  </GridCell>
                  <GridCell>
                    <a href={entry.url} target="_blank" rel="noreferrer">
                      {entry.title}
                    </a>
                  </GridCell>
                  <GridCell align="end" tone={lists ? "ink" : "faint"} mono>
                    {lists ? tn(lists, "data.published.feed.stored.one", "data.published.feed.stored.many", { n: fmtInt(lists) }) : t("data.published.feed.notYet")}
                  </GridCell>
                </GridRow>
              ))}
            </GridTable>
          )}
          {otherGames ? <p className="data-note published-feed-note">{tn(otherGames, "data.published.feed.others.one", "data.published.feed.others.many", { n: fmtInt(otherGames) })}</p> : null}
        </div>
      ) : null}

      <p className="data-note">{t("data.published.note")}</p>
      <p className="data-note">{t("data.published.feed.how")}</p>
      <p className="data-note mono">{CLI_FEED_COMMAND}</p>

      <Dialog open={pasteOpen} onClose={closePaste} title={t("data.published.paste.title")} wide>
        <div className="stack">
          <p className="small muted" style={{ margin: 0 }}>
            {t("data.published.paste.hint")}
          </p>
          <Field label={t("data.published.paste.text")}>
            <textarea rows={12} className="mono" value={form.text} placeholder={t("data.published.paste.placeholder")} autoFocus onChange={(e) => onText(e.target.value)} />
          </Field>
          <div className="field-row">
            <Field label={t("data.published.paste.player")} className="grow">
              <input type="text" value={form.player} onChange={(e) => setForm((f) => ({ ...f, player: e.target.value }))} />
            </Field>
            <Field label={t("data.published.paste.faction")} className="grow">
              <input type="text" value={form.faction} onChange={(e) => typed("faction", e.target.value)} />
            </Field>
            <Field label={t("data.published.paste.placing")}>
              <input type="number" min={1} step={1} value={form.placing} style={{ width: 90 }} onChange={(e) => setForm((f) => ({ ...f, placing: e.target.value }))} />
            </Field>
          </div>
          <div className="field-row">
            <Field label={t("data.published.paste.detachments")} hint={t("data.published.paste.detachmentsHint")} className="grow">
              <input type="text" value={form.detachments} onChange={(e) => typed("detachments", e.target.value)} />
            </Field>
            <Field label={t("data.published.paste.disposition")} className="grow">
              <input type="text" value={form.disposition} onChange={(e) => typed("disposition", e.target.value)} />
            </Field>
          </div>
          <div className="field-row">
            <Field label={t("data.published.paste.source")} className="grow">
              <input type="text" value={form.source} onChange={(e) => setForm((f) => ({ ...f, source: e.target.value }))} />
            </Field>
            <Field label={t("data.published.paste.url")} className="grow">
              <input type="url" value={form.url} placeholder="https://" onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))} />
            </Field>
          </div>
          <div className="dialog-actions">
            <button type="button" className="ghost" onClick={closePaste}>
              {t("common.cancel")}
            </button>
            <button type="button" className="primary" disabled={!form.text.trim() || busy} onClick={() => void addPasted()}>
              {t("data.published.paste.add")}
            </button>
          </div>
        </div>
      </Dialog>
    </section>
  );
}
