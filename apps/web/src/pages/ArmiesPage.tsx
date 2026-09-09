import { useCallback, useEffect, useMemo, useState } from "react";
import { Roster, type BattleSize, type Snapshot } from "@grimstat/schema";
import { importRosterText } from "@grimstat/adapters";
import { rosterSummary } from "@grimstat/resolver";
import { db, deleteRoster, saveRosterWithVersion } from "../db";
import { useApp } from "../state/AppContext";
import { hrefFor, navigate } from "../router";
import { BATTLE_SIZE_ORDER, cloneRoster, newRoster, pointsLimitFor } from "../lib/roster";
import { newId } from "../lib/ids";
import { fmtDate, fmtInt } from "../lib/format";
import { download } from "../lib/download";
import { Empty, Field } from "../components/ui";
import { t, type I18nKey } from "../i18n";

export const battleSizeKey = (s: BattleSize): I18nKey => `battleSize.${s}` as I18nKey;

export function ArmiesPage() {
  const { snapshot, activeSnapshotId, notify } = useApp();
  const [items, setItems] = useState<Roster[] | undefined>(undefined);
  const [others, setOthers] = useState<Map<string, Snapshot | null>>(new Map());
  const [panel, setPanel] = useState<"new" | "import" | undefined>(undefined);
  const [factionId, setFactionId] = useState("");
  const [battleSize, setBattleSize] = useState<BattleSize>("strike-force");
  const [name, setName] = useState("");
  const [customLimit, setCustomLimit] = useState(2000);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

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
    void Promise.all(missing.map(async (id) => [id, (await db.snapshots.get(id)) ?? null] as const)).then((pairs) => {
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
  }, [items, activeSnapshotId, others]);

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

  const create = () =>
    run(async () => {
      if (!snapshot || !factionId) return;
      const r = newRoster({ snapshot, factionId, battleSize, ...(name.trim() ? { name: name.trim() } : {}), ...(battleSize === "custom" ? { pointsLimit: Math.max(1, Math.floor(customLimit) || 2000) } : {}) });
      await saveRosterWithVersion(r);
      setPanel(undefined);
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
      if (result.warnings.length) notify(t("armies.importWarnings", { name: r.name, n: result.warnings.length }), "info", result.warnings);
      else notify(t("armies.imported", { name: r.name }), "success");
      setPanel(undefined);
      setText("");
      setName("");
      navigate("armies", false, r.id);
    });

  const exportAll = () => download(`grimstat-armies-${new Date().toISOString().slice(0, 10)}.json`, { format: "grimstat-rosters", version: 1, exportedAt: new Date().toISOString(), rosters: items ?? [] });

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>{t("nav.armies")}</h1>
          <p>{t("armies.intro")}</p>
        </div>
        <div className="row">
          <button type="button" className="primary" disabled={!snapshot || busy} onClick={() => setPanel(panel === "new" ? undefined : "new")} aria-expanded={panel === "new"}>
            {t("armies.new")}
          </button>
          <button type="button" disabled={!snapshot || busy} onClick={() => setPanel(panel === "import" ? undefined : "import")} aria-expanded={panel === "import"}>
            {t("armies.importText")}
          </button>
          <button type="button" className="ghost" disabled={!items?.length || busy} onClick={exportAll}>
            {t("armies.exportAll")}
          </button>
        </div>
      </div>

      {!snapshot ? (
        <Empty>
          {t("armies.noSnapshot")} <a href={hrefFor("data")}>{t("nav.data")}</a>
        </Empty>
      ) : null}

      {panel === "new" && snapshot ? (
        <section className="panel" aria-labelledby="new-army-h">
          <div className="panel-head">
            <h2 id="new-army-h">{t("armies.new")}</h2>
          </div>
          <form
            className="field-row"
            onSubmit={(e) => {
              e.preventDefault();
              void create();
            }}
          >
            <Field label={t("armies.faction")}>
              <select value={factionId} onChange={(e) => setFactionId(e.target.value)}>
                {factions.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t("armies.battleSize")}>
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
            <Field label={t("armies.nameOptional")} className="grow">
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <button type="submit" className="primary" disabled={!factionId || busy}>
              {t("armies.create")}
            </button>
            <button type="button" className="ghost" onClick={() => setPanel(undefined)}>
              {t("armies.cancel")}
            </button>
          </form>
        </section>
      ) : null}

      {panel === "import" && snapshot ? (
        <section className="panel" aria-labelledby="import-army-h">
          <div className="panel-head">
            <h2 id="import-army-h">{t("armies.importText")}</h2>
          </div>
          <p className="small muted">{t("armies.importTextHint")}</p>
          <div className="stack">
            <Field label={t("armies.nameOptional")}>
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} style={{ maxWidth: 320 }} />
            </Field>
            <Field label={t("armies.importText")}>
              <textarea rows={12} className="mono" value={text} placeholder={t("armies.importPlaceholder")} onChange={(e) => setText(e.target.value)} />
            </Field>
            <div className="row">
              <button type="button" className="primary" disabled={!text.trim() || busy} onClick={() => void importText()}>
                {t("armies.import")}
              </button>
              <button type="button" className="ghost" onClick={() => setPanel(undefined)}>
                {t("armies.cancel")}
              </button>
            </div>
          </div>
        </section>
      ) : null}

      {items === undefined ? null : items.length === 0 ? (
        snapshot ? <Empty>{t("armies.empty")}</Empty> : null
      ) : (
        <div className="list">
          {rows.map(({ r, faction, points, otherSnapshot }) => (
            <div key={r.id} className="list-item">
              <div className="grow">
                <div className="row">
                  <a href={hrefFor("armies", r.id)}>
                    <strong>{r.name}</strong>
                  </a>
                  <span className="badge">{faction}</span>
                  <span className="badge">{t(battleSizeKey(r.battleSize))}</span>
                  {points !== undefined ? <span className={`badge ${points > r.pointsLimit ? "danger" : "accent"}`}>{t("armies.pointsOf", { points: fmtInt(points), limit: fmtInt(r.pointsLimit) })}</span> : null}
                </div>
                <div className="small muted">
                  {t("armies.unitsCount", { n: r.units.length })} · {t("armies.updated", { date: fmtDate(r.updatedAt) })}
                  {otherSnapshot ? ` · ${t("armies.snapshotOther", { id: r.snapshotId })}` : ""}
                </div>
              </div>
              <div className="actions">
                <button type="button" className="sm primary" onClick={() => navigate("armies", false, r.id)}>
                  {t("armies.open")}
                </button>
                <button type="button" className="sm" disabled={busy} onClick={() => void duplicate(r)}>
                  {t("armies.duplicate")}
                </button>
                <button type="button" className="sm danger" disabled={busy} onClick={() => void remove(r)}>
                  {t("armies.delete")}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
