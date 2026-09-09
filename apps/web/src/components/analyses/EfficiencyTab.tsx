import { useMemo, useState } from "react";
import type { ScenarioUnit, Snapshot } from "@grimstat/schema";
import { archetypes, type EfficiencyRow } from "@grimstat/game-40k-11e";
import { useApp } from "../../state/AppContext";
import { simClient } from "../../worker/client";
import { useWorkerTask } from "../../hooks/useWorkerTask";
import { useUnitSet } from "../../hooks/useUnitSet";
import { usePersistedSetting } from "../../hooks/usePersistedSetting";
import type { UnitEntry } from "../../lib/unitSet";
import { fmt, fmtInt } from "../../lib/format";
import { UnitSetPicker } from "./UnitSetPicker";
import { RunStatus, SortHeader } from "./shared";
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

const runEfficiency = (attackers: ScenarioUnit[], targetIds: string[], rangeBand: "half" | "full", snapshot: Snapshot | undefined) => simClient().efficiency(attackers, { targetIds, context: { rangeBand } }, snapshot);

const fingerprint = (a: UnitEntry[], o: EfficiencyOptions) => JSON.stringify([a.map((e) => e.id), o]);

type SortCol = "rank" | "unit" | "points" | "per100" | `t:${string}`;

/** Target names in first-seen order (the ranking keeps `byTarget` keyed by target name). */
export function targetNames(rows: EfficiencyRow[]): string[] {
  const out: string[] = [];
  for (const r of rows) for (const k of Object.keys(r.byTarget)) if (!out.includes(k)) out.push(k);
  return out;
}

export function EfficiencyTable({ rows }: { rows: EfficiencyRow[] }) {
  const [sort, setSort] = useState<{ col: SortCol; dir: "asc" | "desc" }>({ col: "rank", dir: "asc" });
  const targets = useMemo(() => targetNames(rows), [rows]);
  const ranked = useMemo(() => rows.map((r, i) => ({ r, rank: i + 1 })), [rows]);
  const sorted = useMemo(() => {
    const key = (x: { r: EfficiencyRow; rank: number }): number | string => {
      if (sort.col === "rank") return x.rank;
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
  const hasPoints = rows.some((r) => r.points !== undefined);
  return (
    <div className="table-wrap">
      <table className="data">
        <thead>
          <tr>
            <SortHeader col="rank" label="#" sort={sort} onSort={onSort} num />
            <SortHeader col="unit" label={t("analyses.efficiency.unit")} sort={sort} onSort={onSort} />
            {hasPoints ? <SortHeader col="points" label={t("unit.pointsLabel")} sort={sort} onSort={onSort} num /> : null}
            <SortHeader col="per100" label={hasPoints ? t("analyses.metric.damagePer100") : t("analyses.metric.damage")} sort={sort} onSort={onSort} num />
            {targets.map((name) => (
              <SortHeader key={name} col={`t:${name}`} label={name} sort={sort} onSort={onSort} num />
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map(({ r, rank }) => (
            <tr key={`${rank}-${r.unit}`}>
              <td className="num">{rank}</td>
              <td>{r.unit}</td>
              {hasPoints ? <td className="num">{r.points !== undefined ? fmtInt(r.points) : "–"}</td> : null}
              <td className="num">
                <strong>{fmt(r.damagePer100)}</strong>
              </td>
              {targets.map((name) => (
                <td key={name} className="num">
                  {fmt(r.byTarget[name])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="small muted">{t("analyses.efficiency.tableHint")}</p>
    </div>
  );
}

export function EfficiencyChart({ rows }: { rows: EfficiencyRow[] }) {
  if (!rows.length) return <div className="empty">{t("analyses.efficiency.none")}</div>;
  const hasPoints = rows.some((r) => r.points !== undefined);
  return <HBarChart ariaLabel={t("analyses.efficiency.chartAria")} rows={rows.map((r, i) => ({ key: `${i}-${r.unit}`, label: `${i + 1}. ${r.unit}`, value: r.damagePer100, display: fmt(r.damagePer100), title: `${r.unit}: ${fmt(r.damagePer100)} ${hasPoints ? t("analyses.metric.damagePer100") : t("analyses.metric.damage")}` }))} />;
}

export function EfficiencyTab() {
  const { snapshot } = useApp();
  const attackers = useUnitSet("analyses.efficiency.attackers");
  const [opts, setOpts] = usePersistedSetting<EfficiencyOptions>("analyses.efficiency.options", DEFAULT_OPTIONS, parseOptions);
  const task = useWorkerTask(runEfficiency);
  const [ran, setRan] = useState<string | undefined>(undefined);
  const canRun = attackers.entries.length > 0 && opts.targetIds.length > 0;
  const dirty = !!ran && ran !== fingerprint(attackers.entries, opts);

  const run = () => {
    if (!canRun) return;
    setRan(fingerprint(attackers.entries, opts));
    task.run(
      attackers.entries.map((e) => e.unit),
      opts.targetIds,
      opts.rangeBand,
      snapshot,
    );
  };
  const toggleId = (id: string, on: boolean) => setOpts((o) => ({ ...o, targetIds: on ? [...o.targetIds.filter((x) => x !== id), id] : o.targetIds.filter((x) => x !== id) }));

  return (
    <div className="analysis">
      <aside className="analysis-controls stack">
        <section className="panel">
          <UnitSetPicker label={t("analyses.set.attackers")} entries={attackers.entries} onChange={attackers.setEntries} archetypeFilter="attackers" />
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
          <div className="row">
            <button type="button" className="primary" disabled={!canRun || task.running} onClick={run}>
              {t("analyses.run")}
            </button>
          </div>
        </section>
      </aside>
      <section className="analysis-results stack">
        <RunStatus task={task} extra={dirty ? t("analyses.stale") : undefined} />
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
