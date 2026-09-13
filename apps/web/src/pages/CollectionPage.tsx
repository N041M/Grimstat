import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Datasheet, Roster } from "@grimstat/schema";
import { db, notifyStoreChanged, type CollectionEntryRecord } from "../db";
import { useApp } from "../state/AppContext";
import { useStoreVersion } from "../hooks/useStoreVersion";
import { hrefFor } from "../router";
import { nowIso } from "../lib/ids";
import { compositionBounds } from "../lib/roster";
import { fmtInt, pct } from "../lib/format";
import { addModels, asCount, byFaction, canField, collectionTotals, commitCount, coverage, rosterNeeds, tidyEntry, type Shortfall } from "../lib/collection";
import { linesForFactions, modelsByDatasheet, type ResolvedBox } from "../lib/boxes";
import { BoxDialog } from "../components/collection/BoxDialog";
import { UnitArt } from "../components/UnitArt";
import { Badge, Dialog, Empty, Icon, useConfirm } from "../components/ui";
import { GridCell, GridHead, GridHeadCell, GridRow, GridTable, PanelHead, ProportionBar } from "../components/kit";
import { PageHeader, useContextNewAction } from "../components/shell";
import { t, tn } from "../i18n";

/** Name | Owned | Painted | Progress | Remove. */
const COLUMNS = "minmax(180px,2fr) 92px 92px minmax(80px,1fr) 40px";

/** How long "Added …" stays in the picker's live region after the last add. */
const ADDED_NOTE_MS = 4000;

/** Missing lines spelled out under an army before the rest are summed up. */
const MISSING_SHOWN = 3;

/** "1 model" / "12 models" — a count with its noun, for the sentences that read one out. */
const modelsWord = (n: number): string => tn(n, "collection.modelCount.one", "collection.modelCount.many", { n: fmtInt(n) });

/**
 * The player's collection: what is on the shelf, and what it can field.
 *
 * The rest of the app plans with armies that exist on paper. This is the other half of the
 * question — which of them could actually be put on a table this weekend — so the page is counts
 * first (models owned, models painted) and then a straight answer per stored army.
 *
 * Counting is per datasheet and per model. A collection does not record loadouts, because the same ten bodies are
 * ten bodies however they are armed, and a count that tried to follow wargear would be wrong the
 * first time a unit was rebuilt.
 */
export function CollectionPage() {
  const { snapshot, notify } = useApp();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const version = useStoreVersion("collection");
  const rostersVersion = useStoreVersion("rosters");
  const [entries, setEntries] = useState<CollectionEntryRecord[] | undefined>(undefined);
  const [rosters, setRosters] = useState<Roster[]>([]);
  const [query, setQuery] = useState("");
  const [dialog, setDialog] = useState<"add" | "fill" | "box" | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    void db.collection
      .toArray()
      .then((all) => {
        if (alive) setEntries(all);
      })
      .catch(() => {
        if (alive) setEntries([]);
      });
    return () => {
      alive = false;
    };
  }, [version]);

  useEffect(() => {
    let alive = true;
    void db.rosters
      .toArray()
      .then((all) => {
        if (alive) setRosters(all.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [rostersVersion]);

  /** The datasheets the active snapshot still has, for names and for what a unit looks like. */
  const sheets = useMemo(() => new Map((snapshot?.data.datasheets ?? []).map((d) => [d.id, d] as const)), [snapshot]);
  const factionName = useCallback((id: string) => snapshot?.data.factions.find((f) => f.id === id)?.name ?? id, [snapshot]);
  const sheetName = useCallback((id: string) => sheets.get(id)?.name, [sheets]);

  /** Write one entry and let every view of the store know. */
  const put = useCallback(async (entry: CollectionEntryRecord) => {
    const tidy = tidyEntry({ ...entry, updatedAt: nowIso() });
    setEntries((all) => (all ?? []).map((e) => (e.id === tidy.id ? tidy : e)));
    await db.collection.put(tidy);
    notifyStoreChanged("collection");
  }, []);

  const remove = useCallback(
    async (entry: CollectionEntryRecord) => {
      if (!(await confirm({ title: t("collection.removeTitle", { name: entry.name }), body: t("collection.removeBody"), confirmLabel: t("common.remove"), danger: true }))) return;
      await db.collection.delete(entry.id);
      notifyStoreChanged("collection");
    },
    [confirm],
  );

  /** Add a datasheet's models to the shelf; a second box adds to the first. */
  const add = useCallback(
    async (ds: Datasheet, models: number) => {
      const had = await db.collection.get(ds.id);
      await db.collection.put(addModels(had, ds, factionName(ds.factionId), models, nowIso()));
      notifyStoreChanged("collection");
    },
    [factionName],
  );

  /**
   * Put a box's models on the shelf, for the armies the reader ticked.
   *
   * The lines are summed per datasheet before anything is written. A box can name the same unit
   * twice, and writing each line against the count read before either landed would keep only the
   * last of them.
   */
  const addBox = useCallback(
    async (read: ResolvedBox, factionIds: readonly string[]) => {
      const now = nowIso();
      let added = 0;
      for (const { ds, models } of modelsByDatasheet(linesForFactions(read, factionIds)).values()) {
        const had = await db.collection.get(ds.id);
        await db.collection.put(addModels(had, ds, factionName(ds.factionId), models, now));
        added += models;
      }
      notifyStoreChanged("collection");
      setDialog(undefined);
      notify(t("collection.box.added", { models: added, name: read.box.name }), "success");
    },
    [factionName, notify],
  );

  /**
   * Top the collection up to what an army fields.
   *
   * Filling adds only what is missing: an army that fields ten of a squad you already own ten of
   * leaves the count alone, so filling from two armies that share a unit does not buy it twice.
   */
  const fillFrom = useCallback(
    async (roster: Roster) => {
      if (!snapshot) return;
      const needs = rosterNeeds(roster, sheetName);
      const now = nowIso();
      let added = 0;
      for (const need of needs) {
        const ds = snapshot.data.datasheets.find((d) => d.id === need.datasheetId);
        if (!ds) continue;
        const had = await db.collection.get(need.datasheetId);
        const owned = asCount(had?.owned ?? 0);
        if (owned >= need.models) continue;
        added += need.models - owned;
        await db.collection.put(addModels(had, ds, factionName(ds.factionId), need.models - owned, now));
      }
      notifyStoreChanged("collection");
      setDialog(undefined);
      notify(added > 0 ? t("collection.filled", { name: roster.name, models: modelsWord(added) }) : t("collection.filledNothing", { name: roster.name }), "success");
    },
    [snapshot, sheetName, factionName, notify],
  );

  useContextNewAction("collection", () => {
    if (snapshot) setDialog("add");
  });

  const totals = useMemo(() => collectionTotals(entries ?? []), [entries]);
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matching = q ? (entries ?? []).filter((e) => e.name.toLowerCase().includes(q) || e.factionName.toLowerCase().includes(q)) : (entries ?? []);
    return byFaction(matching);
  }, [entries, query]);
  const shown = groups.reduce((n, g) => n + g.entries.length, 0);

  const armies = useMemo(
    () =>
      rosters.map((r) => ({
        roster: r,
        cover: coverage(entries ?? [], rosterNeeds(r, sheetName)),
      })),
    [rosters, entries, sheetName],
  );

  return (
    <>
      <PageHeader
        title={t("collection.title")}
        subtitle={t("page.sub.collection", { sheets: fmtInt(totals.datasheets), models: fmtInt(totals.models), painted: pct(totals.paintedFraction, 0) })}
        actions={
          <>
            <button type="button" className="primary" data-tour="collection-add" disabled={!snapshot} onClick={() => setDialog("add")}>
              <Icon name="plus" />
              {t("collection.add")}
            </button>
            <button type="button" disabled={!snapshot} onClick={() => setDialog("box")}>
              <Icon name="plus" />
              {t("collection.box")}
            </button>
            <button type="button" disabled={!snapshot || rosters.length === 0} onClick={() => setDialog("fill")}>
              <Icon name="file" />
              {t("collection.fill")}
            </button>
          </>
        }
      />
      <div className="page-body stack">
        {!snapshot ? (
          <Empty>
            {t("collection.noSnapshot")} <a href={hrefFor("data")}>{t("nav.data")}</a>
          </Empty>
        ) : null}

        {entries === undefined ? (
          <p className="muted small">{t("collection.loading")}</p>
        ) : entries.length === 0 ? (
          <Empty>{t("collection.empty")}</Empty>
        ) : (
          <>
            <section className="coll-summary">
              <div className="coll-stat">
                <span className="coll-stat-value">{fmtInt(totals.models)}</span>
                <span className="coll-stat-label">{t("collection.stat.models")}</span>
              </div>
              <div className="coll-stat">
                <span className="coll-stat-value">{fmtInt(totals.datasheets)}</span>
                <span className="coll-stat-label">{t("collection.stat.datasheets")}</span>
              </div>
              <div className="coll-stat">
                <span className="coll-stat-value">{fmtInt(totals.factions)}</span>
                <span className="coll-stat-label">{t("collection.stat.factions")}</span>
              </div>
              <div className="coll-painted">
                <div className="coll-painted-top">
                  <span className="coll-stat-label">{t("collection.stat.painted")}</span>
                  <span className="mono small">{t("collection.paintedOf", { painted: fmtInt(totals.painted), models: fmtInt(totals.models) })}</span>
                </div>
                <ProportionBar value={totals.paintedFraction} height={8} tone="accent" title={t("collection.paintedAria", { pct: pct(totals.paintedFraction, 0) })} />
              </div>
            </section>

            <div className="coll-filter">
              <input type="search" value={query} placeholder={t("collection.filter")} aria-label={t("collection.filter")} onChange={(e) => setQuery(e.target.value)} />
              <span className="small muted">{t("collection.showing", { n: shown, total: entries.length })}</span>
            </div>

            {shown === 0 ? <Empty>{t("collection.noMatch", { q: query.trim() })}</Empty> : null}

            {groups.map((group) => (
              <section key={group.factionId} className="coll-group">
                <PanelHead title={group.factionName} aside={<span className="mono small muted">{modelsWord(group.entries.reduce((n, e) => n + e.owned, 0))}</span>} />
                <GridTable columns={COLUMNS} label={t("collection.tableLabel", { faction: group.factionName })} className="coll-table">
                  <GridHead>
                    <GridHeadCell>{t("collection.col.unit")}</GridHeadCell>
                    <GridHeadCell align="end">{t("collection.col.owned")}</GridHeadCell>
                    <GridHeadCell align="end">{t("collection.col.painted")}</GridHeadCell>
                    <GridHeadCell>{t("collection.col.progress")}</GridHeadCell>
                    <GridHeadCell align="end">
                      <span className="sr-only">{t("common.remove")}</span>
                    </GridHeadCell>
                  </GridHead>
                  {group.entries.map((e) => (
                    <EntryRow key={e.id} entry={e} sheet={sheets.get(e.id)} onChange={(next) => void put(next)} onRemove={() => void remove(e)} />
                  ))}
                </GridTable>
              </section>
            ))}

            <section className="coll-group">
              <PanelHead title={t("collection.armies")} aside={<span className="small muted">{t("collection.armiesHint")}</span>} />
              {armies.length === 0 ? (
                <Empty>
                  {t("collection.noArmies")} <a href={hrefFor("armies")}>{t("nav.armies")}</a>
                </Empty>
              ) : (
                <div className="coll-armies">
                  {armies.map(({ roster, cover }) => (
                    <ArmyRow key={roster.id} roster={roster} ok={canField(cover)} missing={cover.missing} owned={cover.owned} models={cover.models} />
                  ))}
                </div>
              )}
            </section>
          </>
        )}

        <BoxDialog open={dialog === "box" && !!snapshot} onClose={() => setDialog(undefined)} snapshot={snapshot} onAdd={(read, ids) => void addBox(read, ids)} />
        <AddDialog open={dialog === "add" && !!snapshot} onClose={() => setDialog(undefined)} datasheets={snapshot?.data.datasheets ?? []} factionName={factionName} owned={entries ?? []} onAdd={(ds, models) => void add(ds, models)} />

        <Dialog open={dialog === "fill" && !!snapshot} onClose={() => setDialog(undefined)} title={t("collection.fillTitle")}>
          <div className="stack">
            <p className="small muted" style={{ margin: 0 }}>
              {t("collection.fillHint")}
            </p>
            <div className="coll-fill-list">
              {rosters.map((r) => (
                <button key={r.id} type="button" className="coll-fill-row" onClick={() => void fillFrom(r)}>
                  <span className="coll-fill-name">{r.name}</span>
                  <span className="small muted">{tn(r.units.length, "armies.unitCount.one", "armies.unitCount.many")}</span>
                </button>
              ))}
            </div>
          </div>
        </Dialog>
        {confirmDialog}
      </div>
    </>
  );
}

/**
 * A count that can be cleared while it is being retyped.
 *
 * The field holds what was typed and hands a number back only when the user leaves it or presses
 * Enter, so clearing "10" to type "12" never passes through zero. `NumberBox` in the kit works the
 * same way; it cannot be used here because it draws its own visible label and this one sits in a
 * table cell under a column heading.
 */
function CountBox({ value, max, label, onCommit }: { value: number; max?: number; label: string; onCommit: (n: number) => void }) {
  const [text, setText] = useState(String(value));
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!editing) setText(String(value));
  }, [value, editing]);
  const commit = () => {
    const next = commitCount(text, value, max);
    setText(String(next));
    if (next !== value) onCommit(next);
  };
  return (
    <input
      className="coll-num"
      type="number"
      min={0}
      max={max}
      step={1}
      value={text}
      aria-label={label}
      onFocus={() => setEditing(true)}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        commit();
        setEditing(false);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
      }}
    />
  );
}

/** One datasheet on the shelf: what is owned, what is painted, and how far along that is. */
function EntryRow({ entry, sheet, onChange, onRemove }: { entry: CollectionEntryRecord; sheet: Datasheet | undefined; onChange: (next: CollectionEntryRecord) => void; onRemove: () => void }) {
  const done = entry.owned > 0 ? entry.painted / entry.owned : 0;
  return (
    <GridRow className="coll-row">
      <GridCell>
        <span className="coll-name">
          <UnitArt of={sheet ?? { keywords: [] }} />
          {entry.name}
        </span>
      </GridCell>
      <GridCell align="end">
        <CountBox value={entry.owned} label={t("collection.ownedAria", { name: entry.name })} onCommit={(owned) => onChange({ ...entry, owned })} />
      </GridCell>
      <GridCell align="end">
        <CountBox value={entry.painted} max={entry.owned} label={t("collection.paintedField", { name: entry.name })} onCommit={(painted) => onChange({ ...entry, painted })} />
      </GridCell>
      <GridCell>
        <ProportionBar value={done} height={6} tone="accent" title={t("collection.rowPainted", { painted: fmtInt(entry.painted), models: fmtInt(entry.owned) })} />
      </GridCell>
      <GridCell align="end">
        <button type="button" className="ghost sm icon-btn" aria-label={t("collection.removeAria", { name: entry.name })} title={t("common.remove")} onClick={onRemove}>
          <Icon name="trash" />
        </button>
      </GridCell>
    </GridRow>
  );
}

/** One stored army, answered: can it be fielded from the shelf, and if not, what is missing. */
function ArmyRow({ roster, ok, missing, owned, models }: { roster: Roster; ok: boolean; missing: readonly Shortfall[]; owned: number; models: number }) {
  const rest = missing.length - MISSING_SHOWN;
  // An army nobody has put units in yet is not short of anything and is not ready either.
  const empty = models === 0;
  return (
    <article className={`coll-army ${ok ? "is-ready" : ""}`.trim()}>
      <div className="coll-army-top">
        <a className="coll-army-name" href={hrefFor("armies", roster.id)}>
          {roster.name}
        </a>
        {empty ? <Badge>{t("collection.armyEmpty")}</Badge> : ok ? <Badge tone="ok">{t("collection.ready")}</Badge> : <Badge tone="warn">{t("collection.short", { models: modelsWord(models - owned) })}</Badge>}
      </div>
      {empty ? null : <ProportionBar value={owned / models} height={5} tone={ok ? "accent" : "dim"} title={t("collection.armyBar", { owned: fmtInt(owned), models: fmtInt(models) })} />}
      {empty ? (
        <p className="coll-army-note small muted">{t("collection.armyEmptyNote")}</p>
      ) : ok ? (
        <p className="coll-army-note small muted">{t("collection.readyNote", { models: modelsWord(models) })}</p>
      ) : (
        <ul className="coll-army-missing">
          {missing.slice(0, MISSING_SHOWN).map((m) => (
            <li key={m.datasheetId}>
              <span className="coll-army-missing-name">{m.name}</span>
              <span className="mono small">{t("collection.shortOf", { short: fmtInt(m.short), owned: fmtInt(m.owned), models: fmtInt(m.models) })}</span>
            </li>
          ))}
          {rest > 0 ? <li className="small muted">{t("collection.andMore", { n: rest })}</li> : null}
        </ul>
      )}
    </article>
  );
}

/**
 * The picker: every datasheet in the snapshot, searchable, adding a unit's worth at a time.
 *
 * It stays open after an add and says what it added, because a collection is entered in a sitting —
 * a shelf at a time — and closing after each box would make that ten dialogs.
 */
function AddDialog({ open, onClose, datasheets, factionName, owned, onAdd }: { open: boolean; onClose: () => void; datasheets: readonly Datasheet[]; factionName: (id: string) => string; owned: readonly CollectionEntryRecord[]; onAdd: (ds: Datasheet, models: number) => void }) {
  const [search, setSearch] = useState("");
  const [added, setAdded] = useState<{ name: string; models: number; at: number } | undefined>(undefined);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) input.current?.focus();
    else {
      setSearch("");
      setAdded(undefined);
    }
  }, [open]);

  useEffect(() => {
    if (!added) return;
    const timer = window.setTimeout(() => setAdded(undefined), ADDED_NOTE_MS);
    return () => window.clearTimeout(timer);
  }, [added]);

  const have = useMemo(() => new Map(owned.map((e) => [e.id, e.owned] as const)), [owned]);
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return datasheets
      .filter((d) => !q || d.name.toLowerCase().includes(q) || factionName(d.factionId).toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, 200)
      .map((ds) => ({ ds, faction: factionName(ds.factionId), size: compositionBounds(ds).min, have: have.get(ds.id) ?? 0 }));
  }, [datasheets, search, factionName, have]);

  return (
    <Dialog open={open} onClose={onClose} title={t("collection.addTitle")} wide>
      <div className="stack">
        <p className="small muted" style={{ margin: 0 }}>
          {t("collection.addHint")}
        </p>
        <input ref={input} type="search" value={search} placeholder={t("collection.searchPlaceholder")} aria-label={t("collection.searchPlaceholder")} onChange={(e) => setSearch(e.target.value)} />
        <div className="coll-pick-list">
          {rows.length === 0 ? <Empty>{t("collection.noDatasheet", { q: search.trim() })}</Empty> : null}
          {rows.map(({ ds, faction, size, have: n }) => (
            <button
              key={ds.id}
              type="button"
              className="coll-pick-row"
              onClick={() => {
                onAdd(ds, size);
                setAdded({ name: ds.name, models: size, at: Date.now() });
              }}
            >
              <span className="coll-pick-name">
                <UnitArt of={ds} />
                {ds.name}
              </span>
              <span className="small muted">{faction}</span>
              <span className="mono small">{modelsWord(size)}</span>
              <span className="mono small coll-pick-have">{n > 0 ? t("collection.haveN", { n: fmtInt(n) }) : ""}</span>
            </button>
          ))}
        </div>
        <p className="small ok-text" aria-live="polite" style={{ margin: 0, minHeight: "1.2em" }}>
          {added ? t("collection.added", { name: added.name, models: modelsWord(added.models) }) : ""}
        </p>
        <div className="dialog-actions">
          <button type="button" className="ghost" onClick={onClose}>
            {t("common.close")}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
