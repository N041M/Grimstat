import { useMemo, useRef, useState } from "react";
import type { ScenarioUnit, Snapshot } from "@grimstat/schema";
import { archetypes, type EfficiencyRow } from "@grimstat/game-40k-11e";
import { useApp } from "../../state/AppContext";
import { simClient } from "../../worker/client";
import { useWorkerTask } from "../../hooks/useWorkerTask";
import { useUnitSet } from "../../hooks/useUnitSet";
import { usePersistedSetting } from "../../hooks/usePersistedSetting";
import { UNIT_SET_KEYS, type UnitEntry } from "../../lib/unitSet";
import { fmtInt, fmtSampled, overlaps } from "../../lib/format";
import { download } from "../../lib/download";
import { efficiencyToCsv } from "../../lib/matrixCsv";
import { UnitSetPicker } from "./UnitSetPicker";
import { RunActions, RunStatus, SortHeader, useAnalysisHeader } from "./shared";
import { HBarChart } from "../charts/HBarChart";
import { Field } from "../ui";
import { t } from "../../i18n";

interface EfficiencyOptions {
  targetIds: string[];
  rangeBand: "half" | "full";
}

const DEFAULT_TARGETS = ["guardsman-like", "marine-like", "terminator-like", "light-vehicle", "heavy-tank"];
const DEFAULT_OPTIONS: EfficiencyOptions = { targetIds: DEFAULT_TARGETS, rangeBand: "half" };

function parseOptions(raw: unknown): EfficiencyOptions | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Partial<Record<keyof EfficiencyOptions, unknown>>;
  const valid = new Set(archetypes.map((a) => a.id));
  const ids = Array.isArray(r.targetIds) ? r.targetIds.filter((x): x is string => typeof x === "string" && valid.has(x)) : DEFAULT_TARGETS;
  return { targetIds: ids, rangeBand: r.rangeBand === "full" ? "full" : "half" };
}

// The task takes the entries themselves, so `task.ran` holds what a result was computed for.
const runEfficiency = (attackers: UnitEntry[], targetIds: string[], rangeBand: "half" | "full", snapshot: Snapshot | undefined) => simClient().efficiency(units(attackers), { targetIds, context: { rangeBand } }, snapshot);

const units = (entries: UnitEntry[]): ScenarioUnit[] => entries.map((e) => e.unit);

const fingerprint = (a: UnitEntry[], o: EfficiencyOptions) => JSON.stringify([a.map((e) => e.id), o]);

/**
 * What a stored result was computed from, read back from the arguments the run was made with.
 *
 * The store keeps a result for as long as the app is open, so it outlives this tab. Holding the
 * same fingerprint in component state instead lost it on the way out, and the tab then came back
 * with a ranking that no longer matched the controls and nothing saying so.
 */
export function efficiencyRan(ran: Parameters<typeof runEfficiency> | undefined): string | undefined {
  if (!ran) return undefined;
  const [attackers, targetIds, rangeBand] = ran;
  return fingerprint(attackers, { targetIds, rangeBand });
}

type SortCol = "rank" | "unit" | "points" | "per100" | `t:${string}`;

/** Target names in first-seen order (the ranking keeps `byTarget` keyed by target name). */
export function targetNames(rows: EfficiencyRow[]): string[] {
  const out: string[] = [];
  for (const r of rows) for (const k of Object.keys(r.byTarget)) if (!out.includes(k)) out.push(k);
  return out;
}

/** A row's place in a ranking, and whether any other row holds the same one. */
export interface Place {
  rank: number;
  tied: boolean;
}

/**
 * Places for a list of rows already in ranking order, sharing a place wherever the ranking has no
 * grounds to put one row above another.
 *
 * A place is held by the rows that cannot be told apart from the best row in it, and it ends at the
 * first row that can be. Sharing a place is a claim about every row in it, so it is measured against
 * the row holding the place rather than against the row above.
 *
 * Comparing each row with the one above it instead would chain: six rows each within noise of their
 * neighbour would share one place even when the first and the last are three times their reach
 * apart, which says the last of them might be first when it plainly cannot be. A row worked out
 * exactly stands at a point and shares a place only with a row holding the very same figure, so a
 * ranking with no sampled row in it numbers 1, 2, 3 as it always has.
 */
export function tieRanks<T>(rows: readonly T[], value: (row: T) => number, half: (row: T) => number | undefined): Place[] {
  const places: Place[] = [];
  let start = 0;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    if (i > 0) {
      const leader = rows[start]!;
      if (!overlaps(value(row), half(row), value(leader), half(leader))) start = i;
    }
    places.push({ rank: start + 1, tied: false });
  }
  // Rows holding a place together are always neighbours, so a row is tied when either neighbour
  // carries its number.
  for (let i = 0; i < places.length; i++) {
    places[i]!.tied = (i > 0 && places[i - 1]!.rank === places[i]!.rank) || (i + 1 < places.length && places[i + 1]!.rank === places[i]!.rank);
  }
  return places;
}

/** "4" for a place of its own, "=4" for one held with the rows either side of it. */
export function rankLabel(place: Place): string {
  return place.tied ? `=${place.rank}` : String(place.rank);
}

/**
 * The half-width on a per-target cell, on that cell's own scale.
 *
 * The row's interval belongs to `damagePer100`, which is the mean of the per-target intervals and,
 * in a ranking priced per 100 points, already scaled by 100 / points. The per-target cells are raw
 * expected damage, so that scaling is taken back off before the interval decides how many decimals
 * a cell can carry.
 */
export function perTargetHalfWidth(row: EfficiencyRow): number | undefined {
  if (row.ciHalfWidth === undefined) return undefined;
  if (!row.perPoints || !row.points) return row.ciHalfWidth;
  return (row.ciHalfWidth * row.points) / 100;
}

export function EfficiencyTable({ rows }: { rows: EfficiencyRow[] }) {
  const [sort, setSort] = useState<{ col: SortCol; dir: "asc" | "desc" }>({ col: "rank", dir: "asc" });
  const targets = useMemo(() => targetNames(rows), [rows]);
  // Places come off the ranking order the engine delivered, so they stay put when the reader sorts
  // the view by another column.
  const ranked = useMemo(() => {
    const places = tieRanks(
      rows,
      (r) => r.damagePer100,
      (r) => r.ciHalfWidth,
    );
    return rows.map((r, i) => ({ r, at: i, place: places[i]! }));
  }, [rows]);
  const anyTied = useMemo(() => ranked.some((x) => x.place.tied), [ranked]);
  const sorted = useMemo(() => {
    const key = (x: { r: EfficiencyRow; at: number; place: Place }): number | string => {
      if (sort.col === "rank") return x.place.rank;
      if (sort.col === "unit") return x.r.unit.toLowerCase();
      if (sort.col === "points") return x.r.points ?? -1;
      if (sort.col === "per100") return x.r.damagePer100;
      return x.r.byTarget[sort.col.slice(2)] ?? -1;
    };
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...ranked].sort((a, b) => {
      const ka = key(a);
      const kb = key(b);
      return (ka < kb ? -1 : ka > kb ? 1 : 0) * dir;
    });
  }, [ranked, sort]);
  const onSort = (col: SortCol) => setSort((s) => (s.col === col ? { col, dir: s.dir === "asc" ? "desc" : "asc" } : { col, dir: col === "unit" || col === "rank" ? "asc" : "desc" }));
  if (!rows.length) return <div className="empty">{t("analyses.efficiency.none")}</div>;
  const perPoints = rows[0]?.perPoints ?? false;
  const hasPoints = rows.some((r) => r.points !== undefined);
  return (
    <div className="table-wrap">
      <table className="data">
        <thead>
          <tr>
            <SortHeader col="rank" label="#" sort={sort} onSort={onSort} num />
            <SortHeader col="unit" label={t("analyses.efficiency.unit")} sort={sort} onSort={onSort} />
            {hasPoints ? <SortHeader col="points" label={t("unit.pointsLabel")} sort={sort} onSort={onSort} num /> : null}
            <SortHeader col="per100" label={perPoints ? t("analyses.metric.damagePer100") : t("analyses.metric.damage")} sort={sort} onSort={onSort} num />
            {targets.map((name) => (
              <SortHeader key={name} col={`t:${name}`} label={name} sort={sort} onSort={onSort} num />
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map(({ r, at, place }) => (
            <tr key={`${at}-${r.unit}`}>
              <td className={place.tied ? "num rank-tied" : "num"} {...(place.tied ? { title: t("analyses.tie.title") } : {})}>
                {rankLabel(place)}
              </td>
              <td>{r.unit}</td>
              {hasPoints ? <td className="num">{r.points !== undefined ? fmtInt(r.points) : "–"}</td> : null}
              <td className="num">
                <strong>{fmtSampled(r.damagePer100, r.ciHalfWidth)}</strong>
              </td>
              {targets.map((name) => (
                <td key={name} className="num">
                  {fmtSampled(r.byTarget[name], perTargetHalfWidth(r))}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {anyTied ? <p className="small muted">{t("analyses.tie")}</p> : null}
      <p className="small muted">{t("analyses.efficiency.tableHint")}</p>
    </div>
  );
}

export function EfficiencyChart({ rows }: { rows: EfficiencyRow[] }) {
  if (!rows.length) return <div className="empty">{t("analyses.efficiency.none")}</div>;
  const perPoints = rows[0]?.perPoints ?? false;
  const places = tieRanks(
    rows,
    (r) => r.damagePer100,
    (r) => r.ciHalfWidth,
  );
  return (
    <HBarChart
      ariaLabel={t("analyses.efficiency.chartAria")}
      rows={rows.map((r, i) => {
        const shown = fmtSampled(r.damagePer100, r.ciHalfWidth);
        return { key: `${i}-${r.unit}`, label: `${rankLabel(places[i]!)}. ${r.unit}`, value: r.damagePer100, display: shown, title: `${r.unit}: ${shown} ${perPoints ? t("analyses.metric.damagePer100") : t("analyses.metric.damage")}` };
      })}
    />
  );
}

export function EfficiencyTab() {
  const { snapshot } = useApp();
  const attackers = useUnitSet("analyses.efficiency.attackers");
  const [opts, setOpts] = usePersistedSetting<EfficiencyOptions>("analyses.efficiency.options", DEFAULT_OPTIONS, parseOptions);
  const task = useWorkerTask(runEfficiency, "analyses.efficiency");
  const ran = useMemo(() => efficiencyRan(task.ran), [task.ran]);
  const canRun = attackers.entries.length > 0 && opts.targetIds.length > 0;
  const dirty = !!ran && ran !== fingerprint(attackers.entries, opts);

  const run = () => {
    if (!canRun) return;
    task.run(attackers.entries, opts.targetIds, opts.rangeBand, snapshot);
  };
  const toggleId = (id: string, on: boolean) => setOpts((o) => ({ ...o, targetIds: on ? [...o.targetIds.filter((x) => x !== id), id] : o.targetIds.filter((x) => x !== id) }));

  const exportCsv = () => {
    if (!task.result) return;
    download(`grimstat-efficiency-${new Date().toISOString().slice(0, 10)}.csv`, efficiencyToCsv(task.result), "text/csv");
  };

  // Header actions call through a ref so they never run against a stale closure.
  const handlers = useRef({ run, cancel: task.cancel, exportCsv });
  handlers.current = { run, cancel: task.cancel, exportCsv };
  const hasResult = !!task.result;
  useAnalysisHeader(
    () => ({
      subtitle: t("analyses.efficiency.sub", { a: attackers.entries.length, t: opts.targetIds.length }),
      actions: (
        <RunActions canRun={canRun} running={task.running} onRun={() => handlers.current.run()} onCancel={() => handlers.current.cancel()}>
          <button type="button" disabled={!hasResult} onClick={() => handlers.current.exportCsv()}>
            {t("analyses.exportCsv")}
          </button>
        </RunActions>
      ),
    }),
    [canRun, hasResult, task.running, attackers.entries.length, opts.targetIds.length],
  );

  return (
    <div className="analysis">
      <aside className="analysis-controls stack">
        <section className="panel">
          <UnitSetPicker label={t("analyses.set.attackers")} storageKey={UNIT_SET_KEYS.efficiencyAttackers} entries={attackers.entries} onChange={attackers.setEntries} archetypeFilter="attackers" />
        </section>
        <section className="panel stack" aria-labelledby="eff-t-h">
          <h3 id="eff-t-h" style={{ margin: 0 }}>
            {t("analyses.efficiency.targets")}
          </h3>
          <div className="check-list" role="group" aria-label={t("analyses.efficiency.targets")}>
            {archetypes.map((a) => (
              <label key={a.id} className="inline">
                <input type="checkbox" checked={opts.targetIds.includes(a.id)} onChange={(e) => toggleId(a.id, e.target.checked)} />
                <span>{a.name}</span>
              </label>
            ))}
          </div>
          <Field label={t("ctx.rangeBand")}>
            <select value={opts.rangeBand} onChange={(e) => setOpts((o) => ({ ...o, rangeBand: e.target.value === "full" ? "full" : "half" }))}>
              <option value="full">{t("ctx.rangeBand.full")}</option>
              <option value="half">{t("ctx.rangeBand.half")}</option>
            </select>
          </Field>
        </section>
      </aside>
      <section className="analysis-results stack">
        <RunStatus task={task} stale={dirty} />
        {task.result ? (
          <>
            <EfficiencyChart rows={task.result} />
            <EfficiencyTable rows={task.result} />
          </>
        ) : (
          <div className="empty">{canRun ? t("analyses.efficiency.ready") : t("analyses.efficiency.needAttackers")}</div>
        )}
      </section>
    </div>
  );
}
