import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { Roster, type BattleSize, type Snapshot } from "@grimstat/schema";
import { importRosterText } from "@grimstat/adapters";
import { rosterSummary } from "@grimstat/resolver";
import { db, deleteRoster, saveRosterWithVersion } from "../db";
import { useApp } from "../state/AppContext";
import { hrefFor, navigate } from "../router";
import { BATTLE_SIZE_ORDER, cloneRoster, newRoster, pointsLimitFor, pointsTone } from "../lib/roster";
import { newId } from "../lib/ids";
import { fmtDay, fmtInt } from "../lib/format";
import { download } from "../lib/download";
import { Dialog, Empty, Field, Icon, Popover } from "../components/ui";
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
  const [over, setOver] = useState(false);
  const [imported, setImported] = useState<{ id: string; name: string; warnings: string[] } | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    const all = await db.rosters.toArray();
    setItems(all.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)));
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
      await saveRosterWithVersion(cloneRoster(r, t("armies.copyName", { name: r.name })));
      await refresh();
    });

  const remove = (r: Roster) =>
    run(async () => {
      if (!window.confirm(t("armies.confirmDelete", { name: r.name }))) return;
      await deleteRoster(r.id);
      await refresh();
    });

  const importText = () =>
    run(async () => {
      if (!snapshot || !text.trim()) return;
      let result: ReturnType<typeof importRosterText>;
      try {
        result = importRosterText(text, snapshot, name.trim() ? { name: name.trim() } : {});
      } catch (e) {
        notify(t("armies.importFailed"), "error", [e instanceof Error ? e.message : String(e)]);
        return;
      }
      const r = Roster.parse({ ...result.roster, id: newId("roster"), snapshotId: snapshot.id, gameSystemId: snapshot.gameSystemId });
      await saveRosterWithVersion(r);
      setText("");
      setName("");
      setFileName(undefined);
      if (result.warnings.length) {
        // Keep the dialog open so the warnings can be read; "Open army" navigates.
        setImported({ id: r.id, name: r.name, warnings: result.warnings });
        return;
      }
      notify(t("armies.imported", { name: r.name }), "success");
      closeDialog();
      navigate("armies", false, r.id);
    });

  const readFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      setText(await file.text());
      setFileName(file.name);
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
              <input ref={fileInput} type="file" accept=".txt,text/plain" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={(e) => void readFile(e.target.files?.[0])} />
              {fileName ? <div className="small ok-text">{t("armies.fileLoaded", { name: fileName })}</div> : null}
            </div>
            <Field label={t("armies.importText")}>
              <textarea rows={12} className="mono" value={text} placeholder={t("armies.importPlaceholder")} autoFocus onChange={(e) => setText(e.target.value)} />
            </Field>
            <Field label={t("armies.nameOptional")}>
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} style={{ maxWidth: 320 }} />
            </Field>
            <div>
              <span className="small muted">{t("armies.importFormats")}</span>
              <ul className="format-list">
                <li>{t("armies.format.gw")}</li>
                <li>{t("armies.format.nr")}</li>
                <li>{t("armies.format.grimstat")}</li>
              </ul>
            </div>
            <div className="dialog-actions">
              <button type="button" className="ghost" onClick={closeDialog}>
                {t("common.cancel")}
              </button>
              <button type="button" className="primary" disabled={!text.trim() || busy} onClick={() => void importText()}>
                {t("armies.import")}
              </button>
            </div>
          </div>
        )}
      </Dialog>

      {items === undefined ? null : items.length === 0 ? (
        snapshot ? <Empty>{t("armies.empty")}</Empty> : null
      ) : (
        <div className="army-cards">
          {rows.map(({ r, faction, points, otherSnapshot }) => (
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
      )}
      </div>
    </>
  );
}
