import { useMemo, useRef, useState, type ChangeEvent } from "react";
import { Override, Roster, Scenario, Snapshot } from "@grimstat/schema";
import { db, exportAll, importAll, overrideKey, type ExportBundle, type OverrideRecord, type SnapshotMeta } from "../db";
import { nowIso } from "../lib/ids";
import { download } from "../lib/download";
import { useApp } from "../state/AppContext";
import { loadSampleSnapshot } from "../lib/snapshotSource";
import { summarisePatch } from "../lib/overrides";
import { fmtDay, fmtInt } from "../lib/format";
import { GridCell, GridHead, GridHeadCell, GridRow, GridTable, PanelHead } from "../components/kit";
import { SnapshotCompare } from "../components/data/SnapshotCompare";
import { FetchSources } from "../components/data/FetchSources";
import { SourceAttribution } from "../components/data/SourceAttribution";
import { hrefFor } from "../router";
import { PageHeader } from "../components/shell";
import { t } from "../i18n";

/** Label (status dot) | System | Units | Weapons | Built. */
const SNAPSHOT_COLUMNS = "minmax(180px,2fr) 120px 100px 100px 110px";

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

/** "3 effects", "Feel No Pain 5+", … — the change an override makes, in one mono line. */
function patchSummary(patch: Record<string, unknown>): string {
  const s = summarisePatch(patch);
  switch (s.kind) {
    case "effects":
      return t("overrides.patch.effects", { n: s.n });
    case "none":
      return t("overrides.patch.none");
    case "fnp":
      return t("overrides.patch.fnp", { n: s.n });
    case "fields":
      return t("overrides.patch.fields", { keys: s.keys.join(", ") });
  }
}

function SnapshotRow({ m, active, busy, onUse, onRemove }: { m: SnapshotMeta; active: boolean; busy: boolean; onUse: () => void; onRemove: () => void }) {
  return (
    <GridRow className={active ? "current" : ""} onClick={active ? undefined : onUse} title={active ? t("data.activeRow", { id: m.id }) : t("data.useRow", { id: m.id })}>
      <GridCell>
        <span className="snap-label">
          <span className={`snap-dot ${active ? "on" : ""}`.trim()} aria-hidden="true" />
          <span className="snap-name">{m.label ?? m.id}</span>
        </span>
      </GridCell>
      <GridCell mono tone="muted">
        {m.gameSystemId}
      </GridCell>
      <GridCell align="end" mono>
        {fmtInt(m.counts.datasheets)}
      </GridCell>
      <GridCell align="end" mono>
        {fmtInt(m.counts.weapons)}
      </GridCell>
      <GridCell align="end" mono tone="faint">
        {fmtDay(m.updatedAt)}
      </GridCell>
      <span className="snap-actions">
        <button
          type="button"
          disabled={busy || active}
          onClick={(e) => {
            e.stopPropagation();
            onUse();
          }}
        >
          {t("data.use")}
        </button>
        <button
          type="button"
          className="danger"
          disabled={busy}
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
        >
          {t("data.delete")}
        </button>
      </span>
    </GridRow>
  );
}

export function DataPage() {
  const { snapshotList, activeSnapshotId, rawSnapshot, setActiveSnapshot, refreshSnapshots, refreshOverrides, notify, overrides, overrideStatus } = useApp();
  const [busy, setBusy] = useState(false);
  const snapInput = useRef<HTMLInputElement>(null);
  const bundleInput = useRef<HTMLInputElement>(null);

  const overrideNames = useMemo(() => {
    const d = rawSnapshot?.data;
    const byEntity = (o: OverrideRecord): string | undefined => {
      if (!d) return undefined;
      switch (o.entity) {
        case "ability":
          return d.abilities.find((x) => x.id === o.id)?.name;
        case "datasheet":
        case "priceRule":
          return d.datasheets.find((x) => x.id === o.id)?.name;
        case "detachment":
          return d.detachments.find((x) => x.id === o.id)?.name;
        case "enhancement":
          return d.enhancements.find((x) => x.id === o.id)?.name;
        case "stratagem":
          return d.stratagems.find((x) => x.id === o.id)?.name;
        case "faction":
          return d.factions.find((x) => x.id === o.id)?.name;
        default:
          return undefined;
      }
    };
    return new Map(overrides.map((o) => [o.key, byEntity(o)] as const));
  }, [overrides, rawSnapshot]);

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
    <>
      <PageHeader
        title={t("data.title")}
        subtitle={t("page.sub.data")}
        actions={
          <>
            <button type="button" disabled={busy} onClick={() => void loadSample()}>
              {t("data.loadSample")}
            </button>
            <button type="button" className="primary" disabled={busy} onClick={() => snapInput.current?.click()}>
              {t("data.importSnapshot")}
            </button>
            <input ref={snapInput} type="file" accept="application/json,.json" className="sr-only" aria-label={t("data.importSnapshot")} onChange={(e) => void importSnapshot(e)} />
          </>
        }
      />
      <div className="page-body data-body">
        <FetchSources />

        <section aria-labelledby="data-snapshots-h">
          <PanelHead id="data-snapshots-h" title={t("data.stored")} aside={<span className="t-meta">{t("data.snapshotsMeta", { n: snapshotList.length })}</span>} />
          {snapshotList.length === 0 ? (
            <p className="data-empty">{t("data.empty")}</p>
          ) : (
            <div className="data-table-card">
              <GridTable columns={SNAPSHOT_COLUMNS} label={t("data.stored")} className="snap-table">
                <GridHead>
                  <GridHeadCell>{t("data.col.label")}</GridHeadCell>
                  <GridHeadCell>{t("data.col.system")}</GridHeadCell>
                  <GridHeadCell align="end">{t("data.col.units")}</GridHeadCell>
                  <GridHeadCell align="end">{t("data.col.weapons")}</GridHeadCell>
                  <GridHeadCell align="end">{t("data.col.built")}</GridHeadCell>
                </GridHead>
                {snapshotList.map((m) => (
                  <SnapshotRow key={m.id} m={m} active={m.id === activeSnapshotId} busy={busy} onUse={() => void setActiveSnapshot(m.id)} onRemove={() => void remove(m.id)} />
                ))}
              </GridTable>
            </div>
          )}
        </section>

        <section aria-labelledby="data-overrides-h">
          <PanelHead id="data-overrides-h" title={t("overrides.title")} aside={<a className="data-link" href={hrefFor("data", "overrides")}>{overrides.length ? t("overrides.open") : t("overrides.add")}</a>} />
          {overrides.length === 0 ? (
            <p className="data-empty">{t("overrides.emptyLine")}</p>
          ) : (
            <div className="ovr-cards">
              {overrides.map((o) => (
                <a key={o.key} className="ovr-card" href={hrefFor("data", "overrides")}>
                  <span className="ovr-target">{overrideNames.get(o.key) ?? o.id}</span>
                  <span className="ovr-change">{o.note ?? patchSummary(o.patch)}</span>
                  <span className="ovr-scope">{t("overrides.scope.global")}</span>
                </a>
              ))}
            </div>
          )}
          <p className="data-note">{t("overrides.dataSummary", { n: overrides.length, applied: overrideStatus.applied })}</p>
        </section>

        <section aria-labelledby="data-compare-h">
          <PanelHead id="data-compare-h" title={t("data.compare")} aside={<span className="t-meta">{t("data.compare.meta")}</span>} />
          <SnapshotCompare snapshotList={snapshotList} activeSnapshotId={activeSnapshotId} />
        </section>

        <section aria-labelledby="data-attribution-h">
          <PanelHead id="data-attribution-h" title={t("data.attribution")} aside={rawSnapshot ? <span className="t-meta">{rawSnapshot.label ?? rawSnapshot.id}</span> : undefined} />
          <SourceAttribution sources={rawSnapshot?.sources} />
        </section>

        <section aria-labelledby="data-backup-h">
          <PanelHead id="data-backup-h" title={t("data.backup")} />
          <div className="data-actions">
            <button type="button" disabled={busy} onClick={() => void doExportAll()}>
              {t("data.exportAll")}
            </button>
            <button type="button" disabled={busy} onClick={() => bundleInput.current?.click()}>
              {t("data.importAll")}
            </button>
            <input ref={bundleInput} type="file" accept="application/json,.json" className="sr-only" aria-label={t("data.importAll")} onChange={(e) => void doImportAll(e)} />
            <span className="data-note">{t("data.backupHint")}</span>
          </div>
        </section>
      </div>
    </>
  );
}
