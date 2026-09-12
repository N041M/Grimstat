import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { Snapshot } from "@grimstat/schema";
import { diffSnapshots, type DiffEntity, type EntityChange, type EntityRef, type PointsChange, type SnapshotDiff } from "@grimstat/snapshot";
import { db, type SnapshotMeta } from "../../db";
import { fmtInt } from "../../lib/format";
import { entityLabel } from "../../lib/overrides";
import { Badge, Empty, Field, Spinner } from "../ui";
import { t } from "../../i18n";

const ENTITIES: DiffEntity[] = ["faction", "publication", "datasheet", "ability", "detachment", "enhancement", "stratagem", "wargearPrice"];
const LIST_CAP = 40;

/** Faction lookup across both snapshots: entity kind + id → faction id (undefined when unknown / faction-less). */
export function factionIndex(a: Snapshot, b: Snapshot): (entity: DiffEntity | "points", id: string) => string | undefined {
  const ds = new Map<string, string>();
  const abilityToDs = new Map<string, Set<string>>();
  const det = new Map<string, string>();
  const enh = new Map<string, string>();
  const strat = new Map<string, string>();
  const abil = new Map<string, string>();
  for (const s of [a, b]) {
    for (const d of s.data.datasheets) {
      ds.set(d.id, d.factionId);
      for (const id of d.abilityIds) abilityToDs.set(id, new Set([...(abilityToDs.get(id) ?? []), d.factionId]));
    }
    for (const d of s.data.detachments) {
      det.set(d.id, d.factionId);
      for (const id of d.ruleAbilityIds) abilityToDs.set(id, new Set([...(abilityToDs.get(id) ?? []), d.factionId]));
    }
    for (const e of s.data.enhancements) {
      const f = det.get(e.detachmentId);
      if (f) enh.set(e.id, f);
    }
    for (const x of s.data.stratagems) {
      const f = x.factionId ?? (x.detachmentId ? det.get(x.detachmentId) : undefined);
      if (f) strat.set(x.id, f);
    }
    for (const ab of s.data.abilities) if (ab.factionId) abil.set(ab.id, ab.factionId);
  }
  return (entity, id) => {
    switch (entity) {
      case "faction":
        return id;
      case "datasheet":
      case "points":
        return ds.get(id);
      case "ability": {
        const direct = abil.get(id);
        if (direct) return direct;
        const carriers = abilityToDs.get(id);
        return carriers && carriers.size === 1 ? [...carriers][0] : carriers ? "*" : undefined;
      }
      case "detachment":
        return det.get(id);
      case "enhancement":
        return enh.get(id);
      case "stratagem":
        return strat.get(id);
      case "wargearPrice":
        return ds.get(id.split("|")[0] ?? "");
      case "publication":
        return undefined;
    }
  };
}

function useStoredSnapshot(id: string | undefined): Snapshot | undefined | null {
  const [state, setState] = useState<{ id: string; snapshot: Snapshot | undefined } | undefined>(undefined);
  useEffect(() => {
    if (!id) return;
    let alive = true;
    void db.snapshots.get(id).then((s) => alive && setState({ id, snapshot: s }));
    return () => {
      alive = false;
    };
  }, [id]);
  if (!id) return null;
  return state?.id === id ? state.snapshot : undefined;
}

function CappedList<T>({ items, render, keyOf }: { items: T[]; render: (x: T) => ReactNode; keyOf: (x: T) => string }) {
  const [all, setAll] = useState(false);
  const shown = all ? items : items.slice(0, LIST_CAP);
  return (
    <>
      <ul className="diff-list">
        {shown.map((x) => (
          <li key={keyOf(x)}>{render(x)}</li>
        ))}
      </ul>
      {items.length > LIST_CAP && !all ? (
        <button type="button" className="ghost sm" onClick={() => setAll(true)}>
          {t("data.compare.more", { n: items.length - LIST_CAP })}
        </button>
      ) : null}
    </>
  );
}

export function SnapshotCompare({ snapshotList, activeSnapshotId }: { snapshotList: SnapshotMeta[]; activeSnapshotId: string | undefined }) {
  const [fromId, setFromId] = useState<string>("");
  const [toId, setToId] = useState<string>("");
  const [faction, setFaction] = useState<string>("");
  const [filter, setFilter] = useState("");

  // defaults: "to" = the active snapshot, "from" = the next most recent other one
  useEffect(() => {
    if (snapshotList.length < 2) return;
    setToId((cur) => (cur && snapshotList.some((m) => m.id === cur) ? cur : (activeSnapshotId ?? snapshotList[0]!.id)));
  }, [snapshotList, activeSnapshotId]);
  useEffect(() => {
    if (snapshotList.length < 2 || !toId) return;
    setFromId((cur) => (cur && cur !== toId && snapshotList.some((m) => m.id === cur) ? cur : (snapshotList.find((m) => m.id !== toId)?.id ?? "")));
  }, [snapshotList, toId]);

  const a = useStoredSnapshot(fromId || undefined);
  const b = useStoredSnapshot(toId || undefined);
  const diff: SnapshotDiff | undefined = useMemo(() => (a && b && a.id !== b.id ? diffSnapshots(a, b) : undefined), [a, b]);
  const factionOf = useMemo(() => (a && b ? factionIndex(a, b) : undefined), [a, b]);
  const factions = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of [a, b]) for (const f of s?.data.factions ?? []) m.set(f.id, f.name);
    for (const s of [a, b]) for (const d of s?.data.datasheets ?? []) if (!m.has(d.factionId)) m.set(d.factionId, d.factionId);
    return [...m.entries()].sort((x, y) => x[1].localeCompare(y[1]));
  }, [a, b]);

  const q = filter.trim().toLowerCase();
  const keep = (entity: DiffEntity | "points", id: string, name: string): boolean => {
    if (q && !name.toLowerCase().includes(q)) return false;
    if (!faction || !factionOf) return true;
    const f = factionOf(entity, id);
    return f === faction || f === "*";
  };
  const view = useMemo(() => {
    if (!diff) return undefined;
    const added = diff.added.filter((r) => keep(r.entity, r.id, r.name));
    const removed = diff.removed.filter((r) => keep(r.entity, r.id, r.name));
    const changed = diff.changed.filter((r) => keep(r.entity, r.id, r.name));
    const points = diff.points.filter((p) => keep("points", p.datasheetId, p.name));
    const perEntity = ENTITIES.map((e) => ({ entity: e, added: added.filter((r) => r.entity === e).length, removed: removed.filter((r) => r.entity === e).length, changed: changed.filter((r) => r.entity === e).length })).filter((r) => r.added + r.removed + r.changed > 0);
    return { added, removed, changed, points, perEntity };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [diff, q, faction, factionOf]);

  if (snapshotList.length < 2) return <Empty>{t("data.compare.needTwo")}</Empty>;

  const refLine = (r: EntityRef) => (
    <>
      <Badge>{entityLabel(r.entity)}</Badge> {r.name} <span className="mono muted small">{r.id}</span>
    </>
  );
  const changeLine = (c: EntityChange) => (
    <>
      <Badge>{entityLabel(c.entity)}</Badge> {c.name} <span className="muted small">— {t("data.compare.fields")}: </span>
      <span className="mono small">{[...new Set(c.changes.map((x) => x.field))].slice(0, 8).join(", ")}</span>
      {c.changes.length > 8 ? <span className="muted small"> {t("data.compare.more", { n: c.changes.length - 8 })}</span> : null}
    </>
  );
  const pointsLine = (p: PointsChange) => {
    const delta = p.delta;
    const tone = delta === undefined ? undefined : delta > 0 ? "danger" : delta < 0 ? "ok" : undefined;
    return (
      <span className="row" style={{ gap: "0.4rem" }}>
        <span className="grow">{p.name}</span>
        <span className="mono">
          {p.before !== undefined ? fmtInt(p.before) : "–"} → {p.after !== undefined ? fmtInt(p.after) : "–"}
        </span>
        {delta !== undefined && delta !== 0 ? <Badge tone={tone}>{`${delta > 0 ? "+" : ""}${fmtInt(delta)}`}</Badge> : <Badge>{t("data.compare.rulesOnly")}</Badge>}
      </span>
    );
  };

  return (
    <div className="stack">
      <div className="field-row">
        <Field label={t("data.compare.from")} className="grow">
          <select value={fromId} onChange={(e) => setFromId(e.target.value)}>
            {snapshotList.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label ?? m.id}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("data.compare.to")} className="grow">
          <select value={toId} onChange={(e) => setToId(e.target.value)}>
            {snapshotList.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label ?? m.id}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("data.compare.faction")} className="grow">
          <select value={faction} onChange={(e) => setFaction(e.target.value)}>
            <option value="">{t("data.compare.allFactions")}</option>
            {factions.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("data.compare.filter")} className="grow">
          <input type="search" value={filter} placeholder={t("data.compare.filterPlaceholder")} onChange={(e) => setFilter(e.target.value)} />
        </Field>
      </div>
      {fromId && toId && fromId === toId ? (
        <Empty>{t("data.compare.same")}</Empty>
      ) : !diff || !view ? (
        <Spinner label={t("data.compare.loading")} />
      ) : (
        <>
          <p className="small muted" style={{ margin: 0 }}>
            {t("data.compare.summaryLine", { added: view.added.length, removed: view.removed.length, changed: view.changed.length, points: view.points.length })}
          </p>
          {view.perEntity.length ? (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>{t("data.compare.entity")}</th>
                    <th className="num">{t("data.compare.added")}</th>
                    <th className="num">{t("data.compare.removed")}</th>
                    <th className="num">{t("data.compare.changed")}</th>
                  </tr>
                </thead>
                <tbody>
                  {view.perEntity.map((r) => (
                    <tr key={r.entity}>
                      <td>{entityLabel(r.entity)}</td>
                      <td className="num">{r.added}</td>
                      <td className="num">{r.removed}</td>
                      <td className="num">{r.changed}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          <div className="grid-2">
            <div className="diff-box">
              <h3 style={{ marginBottom: "0.4rem" }}>{t("data.compare.points")}</h3>
              {view.points.length ? <CappedList items={view.points} keyOf={(p) => p.datasheetId} render={pointsLine} /> : <p className="small muted">{t("data.compare.noPoints")}</p>}
            </div>
            <div className="diff-box">
              <h3 style={{ marginBottom: "0.4rem" }}>{t("data.compare.entities")}</h3>
              {view.added.length + view.removed.length + view.changed.length === 0 ? (
                <p className="small muted">{t("data.compare.noChanges")}</p>
              ) : (
                <div className="stack" style={{ gap: "0.4rem" }}>
                  {view.added.length ? (
                    <div>
                      <div className="small ok">{t("data.compare.added")}</div>
                      <CappedList items={view.added} keyOf={(r) => `${r.entity}:${r.id}`} render={refLine} />
                    </div>
                  ) : null}
                  {view.removed.length ? (
                    <div>
                      <div className="small danger">{t("data.compare.removed")}</div>
                      <CappedList items={view.removed} keyOf={(r) => `${r.entity}:${r.id}`} render={refLine} />
                    </div>
                  ) : null}
                  {view.changed.length ? (
                    <div>
                      <div className="small warn">{t("data.compare.changed")}</div>
                      <CappedList items={view.changed} keyOf={(r) => `${r.entity}:${r.id}`} render={changeLine} />
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
