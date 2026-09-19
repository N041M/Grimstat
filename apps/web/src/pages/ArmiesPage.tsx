import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { Roster, type BattleSize, type Snapshot } from "@grimstat/schema";
import { importRosterText, importRosz, importRosterXml } from "@grimstat/adapters";
import { rosterSummary } from "@grimstat/resolver";
import { db, deleteRoster, saveRosterWithVersion } from "../db";
import { useApp } from "../state/AppContext";
import { hrefFor, navigate } from "../router";
import { BATTLE_SIZE_ORDER, cloneRoster, newRoster, pointsLimitFor, pointsTone, touchRoster } from "../lib/roster";
import { useAuthUser } from "../hooks/useAccount";
import { newId } from "../lib/ids";
import { looksLikeJson, looksLikeRosterXml, rosterFileKind, rostersFromJson } from "../lib/rosterFile";
import { fmtDay, fmtInt } from "../lib/format";
import { download } from "../lib/download";
import { Dialog, Empty, Field, Icon, Popover, useConfirm } from "../components/ui";
import { ProportionBar } from "../components/kit";
import { PageHeader, useContextNewAction } from "../components/shell";
import { PictureImport } from "../components/roster/PictureImport";
import { ImportArmyButton } from "../components/roster/ImportArmyButton";
import { storeImportedArmies } from "../lib/savedArmies";
import { t, tn, type I18nKey } from "../i18n";

export const battleSizeKey = (s: BattleSize): I18nKey => `battleSize.${s}` as I18nKey;

/**
 * A points limit as typed into the Custom field: whole points, at least one. Nothing while the
 * field is empty or holds something that is not a limit, so an unfinished field cannot be read as
 * a number the army is then built to.
 */
export function typedPointsLimit(text: string): number | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return undefined;
  const points = Math.floor(n);
  return points >= 1 ? points : undefined;
}

function CardMenu({ name, busy, shared, onBattle, onDuplicate, onDelete, onShare }: { name: string; busy: boolean; shared?: boolean; onBattle: (side: "attacker" | "defender") => void; onDuplicate: () => void; onDelete: () => void; onShare?: (shared: boolean) => void }) {
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
        {(["attacker", "defender"] as const).map((side) => (
          <button key={side} type="button" role="menuitem" onClick={run(() => onBattle(side))}>
            <Icon name="cube" />
            {t(side === "attacker" ? "roster.battle.attacker" : "roster.battle.defender")}
          </button>
        ))}
        <button type="button" role="menuitem" onClick={run(onDuplicate)}>
          <Icon name="copy" />
          {t("armies.duplicate")}
        </button>
        {onShare ? (
          <button type="button" role="menuitem" onClick={run(() => onShare(!shared))}>
            <Icon name="export" />
            {shared ? t("armies.unshare") : t("armies.share")}
          </button>
        ) : null}
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
  const me = useAuthUser();
  const [items, setItems] = useState<Roster[] | undefined>(undefined);
  const [others, setOthers] = useState<Map<string, Snapshot | null>>(new Map());
  const [dialog, setDialog] = useState<"new" | "import" | undefined>(undefined);
  const [factionId, setFactionId] = useState("");
  const [battleSize, setBattleSize] = useState<BattleSize>("strike-force");
  const [name, setName] = useState("");
  const [customLimit, setCustomLimit] = useState("2000");
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState<string | undefined>(undefined);
  /** A BattleScribe/New Recruit file is a zip rather than text, so the bytes are kept until the import runs. */
  const [bytes, setBytes] = useState<Uint8Array | undefined>(undefined);
  /** Pictures of a list, which go to the reader rather than to the text importer. */
  const [pictures, setPictures] = useState<File[] | undefined>(undefined);
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
      setItems(all.sort((a, b) => (a.updatedAt === b.updatedAt ? 0 : a.updatedAt < b.updatedAt ? 1 : -1)));
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

  // The active snapshot can change while this page is open, and a faction it does not have would
  // otherwise be stored on a new army and read back as an id.
  useEffect(() => {
    if (factions.some((f) => f.id === factionId)) return;
    setFactionId(factions[0]?.id ?? "");
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
    setPictures(undefined);
    setOver(false);
  };

  /** The Custom field's value, and what the Create button waits for while that size is chosen. */
  const customPoints = typedPointsLimit(customLimit);

  const create = () =>
    run(async () => {
      if (!snapshot || !factionId) return;
      if (battleSize === "custom" && customPoints === undefined) return;
      const r = newRoster({ snapshot, factionId, battleSize, ...(name.trim() ? { name: name.trim() } : {}), ...(customPoints !== undefined && battleSize === "custom" ? { pointsLimit: customPoints } : {}) });
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

  /** On or off the owner's public page. A page needs a handle first, and the Profile page is where one is chosen. */
  const share = (r: Roster, shared: boolean) =>
    run(async () => {
      if (shared && !me.handle) {
        notify(t("armies.needHandle"), "info", undefined, { label: t("nav.profile"), run: () => navigate("profile") });
        return;
      }
      await saveRosterWithVersion(touchRoster({ ...r, shared }));
      await refresh();
      notify(shared ? t("armies.sharedOn", { name: r.name }) : t("armies.sharedOff", { name: r.name }), "success");
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
    const { saved, present } = await storeImportedArmies(parsed.rosters, (name) => t("armies.copyName", { name }));
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
    if (file.type.startsWith("image/")) {
      setPictures([file]);
      setFileName(file.name);
      return;
    }
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
  /** Several pictures at once are one list across more than one shot, so they are read together. */
  const takeFiles = (files: FileList | null | undefined) => {
    const all = [...(files ?? [])];
    const images = all.filter((f) => f.type.startsWith("image/"));
    if (images.length > 1) {
      setPictures(images);
      setFileName(t("armies.picturesLoaded", { n: images.length }));
      return;
    }
    void readFile(all[0]);
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    takeFiles(e.dataTransfer.files);
  };

  /*
   * A screenshot taken from a video goes to the clipboard and never becomes a file, so pasting one
   * into the dialog has to work.
   *
   * The listener is on the document rather than on the drop zone. A paste event is delivered to
   * whatever holds the focus, and the drop zone is a div that never does, so a reader who opened the
   * dialog and pressed paste would have had nothing happen at all unless they had first clicked into
   * the text field. Only a paste carrying a picture is taken; pasting a list as text still goes to
   * the field below, which is where a reader expects it.
   */
  useEffect(() => {
    if (dialog !== "import" || pictures) return;
    const onPaste = (e: ClipboardEvent) => {
      const images = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith("image/"));
      if (!images.length) return;
      e.preventDefault();
      setPictures(images);
      setFileName(images.length > 1 ? t("armies.picturesLoaded", { n: images.length }) : (images[0]?.name ?? ""));
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [dialog, pictures]);

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
            <button type="button" className="primary" data-tour="armies-new" disabled={!snapshot || busy} onClick={() => setDialog("new")}>
              <Icon name="plus" />
              {t("armies.new")}
            </button>
            <button type="button" disabled={!snapshot || busy} onClick={() => setDialog("import")}>
              <Icon name="file" />
              {t("armies.importText")}
            </button>
            <ImportArmyButton
              disabled={busy}
              onImported={(saved) => {
                void refresh();
                const only = saved.length === 1 ? saved[0] : undefined;
                if (only) navigate("armies", false, only.id);
              }}
            />
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
                {/* The step is a point because the field accepts any whole number of them. At five the browser refused 2,000. */}
                <input type="number" min={1} step={1} value={customLimit} onChange={(e) => setCustomLimit(e.target.value)} />
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
            <button type="submit" className="primary" disabled={!factionId || busy || (battleSize === "custom" && customPoints === undefined)}>
              {t("armies.create")}
            </button>
          </div>
        </form>
      </Dialog>

      <Dialog open={dialog === "import" && !!snapshot} onClose={closeDialog} title={t("armies.importTitle")} wide>
        {pictures && snapshot ? (
          <PictureImport
            snapshot={snapshot}
            pictures={pictures}
            onCancel={() => {
              setPictures(undefined);
              setFileName(undefined);
            }}
            onSave={(drafted) =>
              void run(async () => {
                const r = Roster.parse({ ...drafted, id: newId("roster"), snapshotId: snapshot.id, gameSystemId: snapshot.gameSystemId });
                await saveRosterWithVersion(r);
                notify(t("armies.imported", { name: r.name }), "success");
                closeDialog();
                navigate("armies", false, r.id);
              })
            }
          />
        ) : imported ? (
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
              <input ref={fileInput} type="file" accept=".txt,.rosz,.ros,.xml,.json,.png,.jpg,.jpeg,.webp,text/plain,application/json,application/zip,image/png,image/jpeg,image/webp" className="sr-only" tabIndex={-1} aria-hidden="true" multiple
              onChange={(e) => takeFiles(e.target.files)} />
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
                <CardMenu
                  name={r.name}
                  busy={busy}
                  shared={r.shared}
                  // The same address the editor's Battle table menu uses: the battle screen takes the army from it.
                  onBattle={(side) => {
                    location.hash = `#/battle?${side}=${encodeURIComponent(r.id)}`;
                  }}
                  onDuplicate={() => void duplicate(r)}
                  onDelete={() => void remove(r)}
                  onShare={me.anonymous ? undefined : (shared) => void share(r, shared)}
                />
              </div>
              <div className="army-card-kind">
                {faction} · {t(battleSizeKey(r.battleSize))}
                {r.shared ? <span className="badge">{t("armies.public")}</span> : null}
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
