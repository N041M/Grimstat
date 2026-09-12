import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { Roster, type BattleSize, type Snapshot } from "@grimstat/schema";
import { importRosterText, importRosz, importRosterXml } from "@grimstat/adapters";
import { rosterSummary } from "@grimstat/resolver";
import { db, deleteRoster, saveRosterWithVersion } from "../db";
import { useApp } from "../state/AppContext";
import { hrefFor, navigate } from "../router";
import { BATTLE_SIZE_ORDER, cloneRoster, newRoster, pointsLimitFor, pointsTone } from "../lib/roster";
import { newId } from "../lib/ids";
import { looksLikeJson, looksLikeRosterXml, rosterFileKind, rostersFromJson } from "../lib/rosterFile";
import { fmtDay, fmtInt } from "../lib/format";
import { download } from "../lib/download";
import { Dialog, Empty, Field, Icon, Popover, useConfirm } from "../components/ui";
import { ProportionBar } from "../components/kit";
import { PageHeader, useContextNewAction } from "../components/shell";
import { t, tn, type I18nKey } from "../i18n";

export const battleSizeKey = (s: BattleSize): I18nKey => `battleSize.${s}` as I18nKey;

function CardMenu({ name, busy, onDuplicate, onDelete }: { name: string; busy: boolean; onDuplicate: () => void; onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const run = (fn: () => void) => () => {
    close();
    fn();
  };
  return (
    <Popover
      open={open}
      onClose={close}
      align="end"
      label={t("armies.cardActions", { name })}
      trigger={
        <button type="button" className="ghost sm icon-btn" aria-haspopup="menu" aria-expanded={open} aria-label={t("armies.cardActions", { name })} disabled={busy} onClick={() => setOpen((v) => !v)}>
          <Icon name="more" />
        </button>
      }
    >
      <div className="menu" role="menu">
        <button type="button" role="menuitem" onClick={run(onDuplicate)}>
          <Icon name="copy" />
          {t("armies.duplicate")}
        </button>
        <button type="button" role="menuitem" className="danger" onClick={run(onDelete)}>
          <Icon name="trash" />
          {t("armies.delete")}
        </button>
      </div>
    </Popover>
  );
}

export function ArmiesPage() {
  const { snapshot, activeSnapshotId, notify, withOverrides } = useApp();
  const [items, setItems] = useState<Roster[] | undefined>(undefined);
  const [others, setOthers] = useState<Map<string, Snapshot | null>>(new Map());
  const [dialog, setDialog] = useState<"new" | "import" | undefined>(undefined);
  const [factionId, setFactionId] = useState("");
  const [battleSize, setBattleSize] = useState<BattleSize>("strike-force");
  const [name, setName] = useState("");
  const [customLimit, setCustomLimit] = useState(2000);
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState<string | undefined>(undefined);
  /** A BattleScribe/New Recruit file is a zip rather than text, so the bytes are kept until the import runs. */
  const [bytes, setBytes] = useState<Uint8Array | undefined>(undefined);
  const [over, setOver] = useState(false);
  const [imported, setImported] = useState<{ id: string; name: string; warnings: string[] } | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [loadError, setLoadError] = useState<string | undefined>(undefined);
  const fileInput = useRef<HTMLInputElement>(null);
  const { confirm, dialog: confirmDialog } = useConfirm();

  const refresh = useCallback(async () => {
    try {
      const all = await db.rosters.toArray();
      setItems(all.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)));
      setLoadError(undefined);
    } catch (e) {
      setItems([]);
      setLoadError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Snapshots referenced by rosters other than the active one (for faction names and points in the list).
  useEffect(() => {
    if (!items) return;
    const missing = [...new Set(items.map((r) => r.snapshotId))].filter((id) => id !== activeSnapshotId && !others.has(id));
    if (!missing.length) return;
    let alive = true;
    void Promise.all(missing.map(async (id) => [id, (await db.snapshots.get(id).then((s) => (s ? withOverrides(s) : undefined))) ?? null] as const)).then((pairs) => {
      if (!alive) return;
      setOthers((m) => {
        const next = new Map(m);
        for (const [id, s] of pairs) next.set(id, s);
        return next;
      });
    });
    return () => {
      alive = false;
    };
  }, [items, activeSnapshotId, others, withOverrides]);

  const factions = useMemo(() => {
    if (!snapshot) return [];
    if (snapshot.data.factions.length) return [...snapshot.data.factions].sort((a, b) => a.name.localeCompare(b.name));
    return [...new Set(snapshot.data.datasheets.map((d) => d.factionId))].map((id) => ({ id, name: id }));
  }, [snapshot]);

  useEffect(() => {
    if (!factionId && factions.length) setFactionId(factions[0]!.id);
  }, [factions, factionId]);

  const rows = useMemo(
    () =>
      (items ?? []).map((r) => {
        const s: Snapshot | undefined = r.snapshotId === activeSnapshotId ? snapshot : (others.get(r.snapshotId) ?? undefined);
        const faction = s?.data.factions.find((f) => f.id === r.factionId)?.name ?? r.factionId;
        let points: number | undefined;
        if (s) {
          try {
            points = rosterSummary(r, s).points;
          } catch {
            points = undefined;
          }
        }
        return { r, faction, points, otherSnapshot: r.snapshotId !== activeSnapshotId };
      }),
    [items, snapshot, others, activeSnapshotId],
  );

  // The filter reads the name and the faction, which is what people remember an army by.
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? rows.filter((row) => row.r.name.toLowerCase().includes(q) || row.faction.toLowerCase().includes(q)) : rows;
  }, [rows, query]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setBusy(false);
    }
  };

  const closeDialog = () => {
    setDialog(undefined);
    setImported(undefined);
    setFileName(undefined);
    setBytes(undefined);
    setOver(false);
  };

  const create = () =>
    run(async () => {
      if (!snapshot || !factionId) return;
      const r = newRoster({ snapshot, factionId, battleSize, ...(name.trim() ? { name: name.trim() } : {}), ...(battleSize === "custom" ? { pointsLimit: Math.max(1, Math.floor(customLimit) || 2000) } : {}) });
      await saveRosterWithVersion(r);
      closeDialog();
      setName("");
      navigate("armies", false, r.id);
    });

  const duplicate = (r: Roster) =>
    run(async () => {
      const copy = cloneRoster(r, t("armies.copyName", { name: r.name }));
      await saveRosterWithVersion(copy);
      await refresh();
      notify(t("armies.duplicated", { name: r.name, copy: copy.name }), "success");
    });

  /** Deleting drops the revision history with the army; only the list itself can be put back. */
  const remove = (r: Roster) =>
    run(async () => {
      if (!(await confirm({ title: t("armies.confirmDelete", { name: r.name }), body: t("armies.deleteBody"), confirmLabel: t("common.delete"), danger: true }))) return;
      await deleteRoster(r.id);
      await refresh();
      notify(t("armies.deleted", { name: r.name }), "info", undefined, {
        label: t("common.undo"),
        run: () => {
          void saveRosterWithVersion(r)
            .then(refresh)
            .then(() => notify(t("armies.restored", { name: r.name }), "success"));
        },
      });
    });

  /**
   * The app's own JSON: one saved army or the "Export all" envelope. Ids that are already on this
   * device are re-keyed so an import never overwrites the army it came from.
   */
  const importJson = async () => {
    const parsed = rostersFromJson(text);
    if (!parsed) {
      notify(t("armies.jsonUnreadable"), "error");
      return;
    }
    const existing = new Set((items ?? []).map((r) => r.id));
    let present = 0;
    const saved: Roster[] = [];
    for (const r of parsed.rosters) {
      const rec = existing.has(r.id) ? cloneRoster(r, t("armies.copyName", { name: r.name })) : r;
      if (rec !== r) present++;
      await saveRosterWithVersion(rec);
      saved.push(rec);
    }
    await refresh();
    setText("");
    setName("");
    setFileName(undefined);
    const details: string[] = [];
    if (parsed.skipped) details.push(tn(parsed.skipped, "armies.jsonSkipped.one", "armies.jsonSkipped.many"));
    if (present) details.push(tn(present, "armies.jsonPresent.one", "armies.jsonPresent.many"));
    notify(tn(saved.length, "armies.importedJson.one", "armies.importedJson.many"), "success", details.length ? details : undefined);
    closeDialog();
    const only = saved.length === 1 ? saved[0] : undefined;
    if (only) navigate("armies", false, only.id);
  };

  const importText = () =>
    run(async () => {
      if (!snapshot || (!text.trim() && !bytes)) return;
      if (!bytes && looksLikeJson(text)) {
        await importJson();
        return;
      }
      let result: ReturnType<typeof importRosterText>;
      const opts = name.trim() ? { name: name.trim() } : {};
      try {
        // Three shapes arrive through one dialog: a zipped BattleScribe roster, the raw XML inside
        // one, and a pasted list. The first two carry per-model wargear, leader links and sub-unit
        // splits that no text export preserves, so they are always preferred when present.
        result = bytes ? importRosz(bytes, snapshot, opts) : looksLikeRosterXml(text) ? importRosterXml(text, snapshot, opts) : importRosterText(text, snapshot, opts);
      } catch (e) {
        notify(t("armies.importFailed"), "error", [e instanceof Error ? e.message : String(e)]);
        return;
      }
      const r = Roster.parse({ ...result.roster, id: newId("roster"), snapshotId: snapshot.id, gameSystemId: snapshot.gameSystemId });
      await saveRosterWithVersion(r);
      setText("");
      setName("");
      setFileName(undefined);
      setBytes(undefined);
      if (result.warnings.length) {
        // Keep the dialog open so the warnings can be read; "Open army" navigates.
        setImported({ id: r.id, name: r.name, warnings: result.warnings });
        return;
      }
      notify(t("armies.imported", { name: r.name }), "success");
      closeDialog();
      navigate("armies", false, r.id);
    });

  /**
   * Read a dropped or chosen file.
   *
   * A `.rosz` is a zip and reading it as text produces mojibake, so the decision is made on the
   * file's first two bytes rather than its name — plenty of exports arrive renamed, and the zip
   * signature never lies.
   */
  const readFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const buffer = new Uint8Array(await file.arrayBuffer());
      setFileName(file.name);
      if (rosterFileKind(buffer) === "zip") {
        setBytes(buffer);
        setText("");
        return;
      }
      setBytes(undefined);
      setText(new TextDecoder().decode(buffer));
    } catch {
      notify(t("armies.fileReadFailed", { name: file.name }), "error");
    }
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    void readFile(e.dataTransfer.files[0]);
  };

  // The context column's "+ New army" affordance opens this page's dialog.
  useContextNewAction("armies", () => {
    if (snapshot) setDialog("new");
  });

  const exportAll = () => download(`grimstat-armies-${new Date().toISOString().slice(0, 10)}.json`, { format: "grimstat-rosters", version: 1, exportedAt: new Date().toISOString(), rosters: items ?? [] });

  return (
    <>
      <PageHeader
        title={t("armies.title")}
        subtitle={t("page.sub.armies", { n: items?.length ?? 0 })}
        actions={
          <>
            <button type="button" className="primary" disabled={!snapshot || busy} onClick={() => setDialog("new")}>
              <Icon name="plus" />
              {t("armies.new")}
            </button>
            <button type="button" disabled={!snapshot || busy} onClick={() => setDialog("import")}>
              <Icon name="file" />
              {t("armies.importText")}
            </button>
            <button type="button" className="ghost" disabled={!items?.length || busy} onClick={exportAll}>
              <Icon name="export" />
              {t("armies.exportAll")}
            </button>
          </>
        }
      />
      <div className="page-body stack">

      {!snapshot ? (
        <Empty>
          {t("armies.noSnapshot")} <a href={hrefFor("data")}>{t("nav.data")}</a>
        </Empty>
      ) : null}

      <Dialog open={dialog === "new" && !!snapshot} onClose={closeDialog} title={t("armies.newTitle")}>
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            void create();
          }}
        >
          <Field label={t("armies.faction")}>
            <select value={factionId} onChange={(e) => setFactionId(e.target.value)} autoFocus>
              {factions.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </Field>
          <div className="field-row">
            <Field label={t("armies.battleSize")} className="grow">
              <select value={battleSize} onChange={(e) => setBattleSize(e.target.value as BattleSize)}>
                {BATTLE_SIZE_ORDER.map((s) => (
                  <option key={s} value={s}>
                    {t(battleSizeKey(s))}
                    {s !== "custom" ? ` (${fmtInt(pointsLimitFor(s))})` : ""}
                  </option>
                ))}
              </select>
            </Field>
            {battleSize === "custom" ? (
              <Field label={t("roster.pointsLimit")}>
                <input type="number" min={1} step={5} value={customLimit} onChange={(e) => setCustomLimit(Number(e.target.value))} />
              </Field>
            ) : null}
          </div>
          <Field label={t("armies.nameOptional")}>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <div className="dialog-actions">
            <button type="button" className="ghost" onClick={closeDialog}>
              {t("common.cancel")}
            </button>
            <button type="submit" className="primary" disabled={!factionId || busy}>
              {t("armies.create")}
            </button>
          </div>
        </form>
      </Dialog>

      <Dialog open={dialog === "import" && !!snapshot} onClose={closeDialog} title={t("armies.importTitle")} wide>
        {imported ? (
          <div className="stack">
            <p style={{ margin: 0 }}>
              <strong>{t("armies.importWarningsTitle", { name: imported.name, n: imported.warnings.length })}</strong>
            </p>
            <p className="small muted" style={{ margin: 0 }}>
              {t("armies.importWarningsHint")}
            </p>
            <ul className="warn-list">
              {imported.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
            <div className="dialog-actions">
              <button
                type="button"
                className="ghost"
                onClick={() => {
                  closeDialog();
                  void refresh();
                }}
              >
                {t("common.close")}
              </button>
              <button
                type="button"
                className="primary"
                onClick={() => {
                  const id = imported.id;
                  closeDialog();
                  navigate("armies", false, id);
                }}
              >
                {t("armies.openArmy")}
              </button>
            </div>
          </div>
        ) : (
          <div className="stack">
            <p className="small muted" style={{ margin: 0 }}>
              {t("armies.importTextHint")}
            </p>
            <div
              className={`dropzone ${over ? "over" : ""}`.trim()}
              onDragOver={(e) => {
                e.preventDefault();
                setOver(true);
              }}
              onDragLeave={() => setOver(false)}
              onDrop={onDrop}
            >
              <Icon name="file" /> {t("armies.dropHint")}{" "}
              <button type="button" className="link-btn" onClick={() => fileInput.current?.click()}>
                {t("armies.chooseFile")}
              </button>
              <input ref={fileInput} type="file" accept=".txt,.rosz,.ros,.xml,.json,text/plain,application/json,application/zip" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={(e) => void readFile(e.target.files?.[0])} />
              {fileName ? <div className="small ok-text">{t("armies.fileLoaded", { name: fileName })}</div> : null}
            </div>
            <Field label={t("armies.importText")}>
              <textarea
                rows={12}
                className="mono"
                value={text}
                placeholder={t("armies.importPlaceholder")}
                autoFocus
                onChange={(e) => {
                  // Typing means the text is what to import: a zip loaded earlier would otherwise win silently.
                  setBytes(undefined);
                  setFileName(undefined);
                  setText(e.target.value);
                }}
              />
            </Field>
            <Field label={t("armies.nameOptional")}>
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} style={{ maxWidth: 320 }} />
            </Field>
            <div>
              <span className="small muted">{t("armies.importFormats")}</span>
              <ul className="format-list">
                <li>{t("armies.format.rosz")}</li>
                <li>{t("armies.format.gw")}</li>
                <li>{t("armies.format.nr")}</li>
                <li>{t("armies.format.grimstat")}</li>
                <li>{t("armies.format.json")}</li>
              </ul>
            </div>
            <div className="dialog-actions">
              <button type="button" className="ghost" onClick={closeDialog}>
                {t("common.cancel")}
              </button>
              <button type="button" className="primary" disabled={(!text.trim() && !bytes) || busy} onClick={() => void importText()}>
                {t("armies.import")}
              </button>
            </div>
          </div>
        )}
      </Dialog>

      {items === undefined ? (
        <p className="muted small">{t("armies.loading")}</p>
      ) : loadError ? (
        <div className="army-load-error">
          <p>{t("armies.loadFailed")}</p>
          <p className="small muted">{loadError}</p>
          <button type="button" onClick={() => void refresh()}>
            {t("common.retry")}
          </button>
        </div>
      ) : items.length === 0 ? (
        snapshot ? <Empty>{t("armies.empty")}</Empty> : null
      ) : (
        <>
        <div className="army-filter">
          <input type="search" value={query} placeholder={t("armies.filter")} aria-label={t("armies.filter")} onChange={(e) => setQuery(e.target.value)} />
          <span className="small muted">{t("armies.showing", { n: shown.length, total: rows.length })}</span>
        </div>
        {shown.length === 0 ? <Empty>{t("armies.noMatch", { q: query.trim() })}</Empty> : null}
        <div className="army-cards">
          {shown.map(({ r, faction, points, otherSnapshot }) => (
            <article key={r.id} className="army-card">
              <div className="army-card-top">
                <a href={hrefFor("armies", r.id)} className="army-card-title">
                  {r.name}
                </a>
                <CardMenu name={r.name} busy={busy} onDuplicate={() => void duplicate(r)} onDelete={() => void remove(r)} />
              </div>
              <div className="army-card-kind">
                {faction} · {t(battleSizeKey(r.battleSize))}
              </div>
              <ProportionBar value={points === undefined ? 0 : points / Math.max(1, r.pointsLimit)} height={5} tone={points !== undefined && pointsTone(points, r.pointsLimit) === "danger" ? "dim" : "ink"} title={t("roster.meter.aria", { points: fmtInt(points ?? 0), limit: fmtInt(r.pointsLimit) })} />
              <div className="army-card-foot">
                <span className="army-card-pts">
                  {points === undefined ? "–" : fmtInt(points)} / {fmtInt(r.pointsLimit)}
                </span>
                <span>{tn(r.units.length, "armies.unitCount.one", "armies.unitCount.many")}</span>
                <span className="army-card-when" title={otherSnapshot ? t("armies.snapshotOther", { id: r.snapshotId }) : undefined}>
                  {fmtDay(r.updatedAt)}
                </span>
              </div>
            </article>
          ))}
        </div>
        </>
      )}
      {confirmDialog}
      </div>
    </>
  );
}
