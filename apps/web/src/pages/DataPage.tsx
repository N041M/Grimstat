import { useRef, useState, type ChangeEvent } from "react";
import { Override, Roster, Scenario, Snapshot } from "@grimstat/schema";
import { db, exportAll, importAll, overrideKey, type ExportBundle, type OverrideRecord } from "../db";
import { nowIso } from "../lib/ids";
import { download } from "../lib/download";
import { useApp } from "../state/AppContext";
import { loadSampleSnapshot } from "../lib/snapshotSource";
import { fmtDate } from "../lib/format";
import { Empty } from "../components/ui";
import { SnapshotCompare } from "../components/data/SnapshotCompare";
import { FetchSources } from "../components/data/FetchSources";
import { SourceAttribution } from "../components/data/SourceAttribution";
import { OverridesPill } from "./OverridesPage";
import { hrefFor } from "../router";
import { t } from "../i18n";

function zodIssues(err: { issues: Array<{ path: Array<string | number>; message: string }> }, max = 15): string[] {
  const lines = err.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
  return lines.length > max ? [...lines.slice(0, max), t("data.moreErrors", { n: lines.length - max })] : lines;
}

async function readFile(e: ChangeEvent<HTMLInputElement>): Promise<{ name: string; text: string } | undefined> {
  const f = e.target.files?.[0];
  e.target.value = "";
  if (!f) return undefined;
  return { name: f.name, text: await f.text() };
}

export function DataPage() {
  const { snapshotList, activeSnapshotId, rawSnapshot, setActiveSnapshot, refreshSnapshots, refreshOverrides, notify, overrides, overrideStatus } = useApp();
  const [busy, setBusy] = useState(false);
  const snapInput = useRef<HTMLInputElement>(null);
  const bundleInput = useRef<HTMLInputElement>(null);

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

  const loadSample = () =>
    run(async () => {
      const s = loadSampleSnapshot();
      await db.snapshots.put(s);
      await refreshSnapshots();
      await setActiveSnapshot(s.id);
      notify(t("data.sampleLoaded", { label: s.label ?? s.id }), "success");
    });

  const importSnapshot = (e: ChangeEvent<HTMLInputElement>) =>
    run(async () => {
      const file = await readFile(e);
      if (!file) return;
      let json: unknown;
      try {
        json = JSON.parse(file.text);
      } catch (err) {
        notify(t("data.notJson", { name: file.name }), "error", [err instanceof Error ? err.message : String(err)]);
        return;
      }
      const parsed = Snapshot.safeParse(json);
      if (!parsed.success) {
        notify(t("data.invalidSnapshot", { name: file.name }), "error", zodIssues(parsed.error));
        return;
      }
      await db.snapshots.put(parsed.data);
      await refreshSnapshots();
      await setActiveSnapshot(parsed.data.id);
      notify(t("data.snapshotImported", { id: parsed.data.id }), "success");
    });

  const remove = (id: string) =>
    run(async () => {
      if (!window.confirm(t("data.confirmDelete", { id }))) return;
      await db.snapshots.delete(id);
      await refreshSnapshots();
    });

  const doExportAll = () =>
    run(async () => {
      const bundle = await exportAll();
      download(`grimstat-export-${new Date().toISOString().slice(0, 10)}.json`, bundle);
    });

  const doImportAll = (e: ChangeEvent<HTMLInputElement>) =>
    run(async () => {
      const file = await readFile(e);
      if (!file) return;
      let json: unknown;
      try {
        json = JSON.parse(file.text);
      } catch (err) {
        notify(t("data.notJson", { name: file.name }), "error", [err instanceof Error ? err.message : String(err)]);
        return;
      }
      const b = json as Partial<ExportBundle>;
      if (!b || b.format !== "grimstat-export" || !b.stores || typeof b.stores !== "object") {
        notify(t("data.invalidBundle", { name: file.name }), "error");
        return;
      }
      const errors: string[] = [];
      const snapshots: Snapshot[] = [];
      for (const s of b.stores.snapshots ?? []) {
        const p = Snapshot.safeParse(s);
        if (p.success) snapshots.push(p.data);
        else errors.push(`snapshot ${(s as { id?: string })?.id ?? "?"}: ${p.error.issues[0]?.message ?? "invalid"}`);
      }
      const scenarios: Scenario[] = [];
      for (const s of b.stores.scenarios ?? []) {
        const p = Scenario.safeParse(s);
        if (p.success) scenarios.push(p.data);
        else errors.push(`scenario ${(s as { id?: string })?.id ?? "?"}: ${p.error.issues[0]?.message ?? "invalid"}`);
      }
      const rosters: Roster[] = [];
      for (const r of b.stores.rosters ?? []) {
        const p = Roster.safeParse(r);
        if (p.success) rosters.push(p.data);
        else errors.push(`roster ${(r as { id?: string })?.id ?? "?"}: ${p.error.issues[0]?.message ?? "invalid"}`);
      }
      const overridesIn: OverrideRecord[] = [];
      for (const o of b.stores.overrides ?? []) {
        const p = Override.safeParse(o);
        const rec = o as Partial<OverrideRecord>;
        if (p.success) overridesIn.push({ ...p.data, key: overrideKey(p.data.entity, p.data.id), ownerId: typeof rec.ownerId === "string" ? rec.ownerId : "local", createdAt: typeof rec.createdAt === "string" ? rec.createdAt : nowIso(), updatedAt: typeof rec.updatedAt === "string" ? rec.updatedAt : nowIso() });
        else errors.push(`override ${rec.entity ?? "?"}:${rec.id ?? "?"}: ${p.error.issues[0]?.message ?? "invalid"}`);
      }
      const counts = await importAll({
        format: "grimstat-export",
        version: 1,
        exportedAt: b.exportedAt ?? new Date().toISOString(),
        stores: { snapshots, scenarios, layouts: Array.isArray(b.stores.layouts) ? b.stores.layouts : [], settings: Array.isArray(b.stores.settings) ? b.stores.settings : [], rosters, overrides: overridesIn },
      });
      await refreshSnapshots();
      await refreshOverrides();
      notify(t("data.bundleImported", { snapshots: counts.snapshots, scenarios: counts.scenarios }), errors.length ? "error" : "success", errors.length ? errors : undefined);
    });

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>{t("nav.data")}</h1>
          <p>{t("data.intro")}</p>
        </div>
      </div>

      <section className="panel">
        <div className="panel-head">
          <h2>{t("data.getData")}</h2>
        </div>
        <div className="row">
          <button type="button" className="primary" disabled={busy} onClick={() => void loadSample()}>
            {t("data.loadSample")}
          </button>
          <button type="button" disabled={busy} onClick={() => snapInput.current?.click()}>
            {t("data.importSnapshot")}
          </button>
          <input ref={snapInput} type="file" accept="application/json,.json" className="sr-only" aria-label={t("data.importSnapshot")} onChange={(e) => void importSnapshot(e)} />
        </div>
        <p className="small muted" style={{ marginTop: "0.6rem" }}>{t("data.importHint")}</p>
      </section>

      <FetchSources />

      <section className="panel">
        <div className="panel-head">
          <h2>{t("data.stored")}</h2>
          <OverridesPill />
        </div>
        {snapshotList.length === 0 ? (
          <Empty>{t("data.empty")}</Empty>
        ) : (
          <div className="list">
            {snapshotList.map((m) => (
              <div key={m.id} className={`list-item ${m.id === activeSnapshotId ? "active" : ""}`}>
                <div className="grow">
                  <div className="row">
                    <strong>{m.label ?? m.id}</strong>
                    {m.id === activeSnapshotId ? <span className="badge accent">{t("data.active")}</span> : null}
                    <span className="badge">{m.gameSystemId}</span>
                  </div>
                  <dl className="kv" style={{ marginTop: 6 }}>
                    <dt>{t("data.id")}</dt>
                    <dd className="mono">{m.id}</dd>
                    <dt>{t("data.checksum")}</dt>
                    <dd className="mono">{m.checksum}</dd>
                    <dt>{t("data.counts")}</dt>
                    <dd>
                      {t("data.countsLine", { factions: m.counts.factions, datasheets: m.counts.datasheets, abilities: m.counts.abilities, detachments: m.counts.detachments, stratagems: m.counts.stratagems, priceRules: m.counts.priceRules })}
                      {m.conflicts ? ` · ${t("data.conflicts", { n: m.conflicts })}` : ""}
                    </dd>
                    <dt>{t("data.sources")}</dt>
                    <dd>
                      {m.sources.length ? (
                        <ul style={{ margin: 0, paddingLeft: "1.1rem" }}>
                          {m.sources.map((s, i) => (
                            <li key={i}>
                              <span className="mono">{s.adapter}</span>
                              {s.ref ? ` @ ${s.ref}` : ""}
                              {s.url ? ` · ${s.url}` : ""} · {fmtDate(s.fetchedAt)}
                              {s.notes ? <span className="muted"> — {s.notes}</span> : null}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        "–"
                      )}
                    </dd>
                    <dt>{t("data.date")}</dt>
                    <dd>{fmtDate(m.updatedAt)}</dd>
                  </dl>
                </div>
                <div className="actions">
                  <button type="button" className="sm primary" disabled={busy || m.id === activeSnapshotId} onClick={() => void setActiveSnapshot(m.id)}>
                    {t("data.use")}
                  </button>
                  <button type="button" className="sm danger" disabled={busy} onClick={() => void remove(m.id)}>
                    {t("data.delete")}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="panel" aria-labelledby="data-attribution-h">
        <div className="panel-head">
          <h2 id="data-attribution-h">{t("data.attribution")}</h2>
          {rawSnapshot ? <span className="badge">{rawSnapshot.label ?? rawSnapshot.id}</span> : null}
        </div>
        <p className="small muted">{t("data.attribution.intro")}</p>
        <SourceAttribution sources={rawSnapshot?.sources} />
      </section>

      <section className="panel" aria-labelledby="data-overrides-h">
        <div className="panel-head">
          <h2 id="data-overrides-h">{t("overrides.title")}</h2>
          <OverridesPill />
        </div>
        <p className="small muted">{t("overrides.intro")}</p>
        <div className="row">
          <a className="btn" href={hrefFor("data", "overrides")}>
            {t("overrides.open")}
          </a>
          <span className="small muted">{t("overrides.dataSummary", { n: overrides.length, applied: overrideStatus.applied })}</span>
        </div>
      </section>

      <section className="panel" aria-labelledby="data-compare-h">
        <div className="panel-head">
          <h2 id="data-compare-h">{t("data.compare")}</h2>
        </div>
        <p className="small muted">{t("data.compare.intro")}</p>
        <SnapshotCompare snapshotList={snapshotList} activeSnapshotId={activeSnapshotId} />
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>{t("data.backup")}</h2>
        </div>
        <div className="row">
          <button type="button" disabled={busy} onClick={() => void doExportAll()}>
            {t("data.exportAll")}
          </button>
          <button type="button" disabled={busy} onClick={() => bundleInput.current?.click()}>
            {t("data.importAll")}
          </button>
          <input ref={bundleInput} type="file" accept="application/json,.json" className="sr-only" aria-label={t("data.importAll")} onChange={(e) => void doImportAll(e)} />
        </div>
        <p className="small muted" style={{ marginTop: "0.6rem" }}>{t("data.backupHint")}</p>
      </section>
    </div>
  );
}
