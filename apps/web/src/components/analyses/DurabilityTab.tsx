import { useMemo, useRef } from "react";
import type { Snapshot } from "@grimstat/schema";
import type { DurabilityEntry } from "@grimstat/game-40k-11e";
import { useApp } from "../../state/AppContext";
import { simClient } from "../../worker/client";
import { useWorkerTask } from "../../hooks/useWorkerTask";
import { useUnitSet } from "../../hooks/useUnitSet";
import { usePersistedSetting } from "../../hooks/usePersistedSetting";
import { UNIT_SET_KEYS, attackerArchetypes, shortArchetypeName, type UnitEntry } from "../../lib/unitSet";
import { fmtSampled, pct } from "../../lib/format";
import { durabilityToCsv } from "../../lib/matrixCsv";
import { download } from "../../lib/download";
import { UnitSetPicker } from "./UnitSetPicker";
import { RunActions, RunStatus, useAnalysisHeader } from "./shared";
import { HBarChart } from "../charts/HBarChart";
import { t } from "../../i18n";

interface DurabilityOptions {
  attackerIds: string[];
  inCover: boolean;
}

const DEFAULT_IDS = ["bolter-squad", "lascannon-team", "melta-squad", "chainsword-mob"];
const DEFAULT_OPTIONS: DurabilityOptions = { attackerIds: DEFAULT_IDS, inCover: false };

function parseOptions(raw: unknown): DurabilityOptions | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Partial<Record<keyof DurabilityOptions, unknown>>;
  const valid = new Set(attackerArchetypes().map((a) => a.id));
  const ids = Array.isArray(r.attackerIds) ? r.attackerIds.filter((x): x is string => typeof x === "string" && valid.has(x)) : DEFAULT_IDS;
  return { attackerIds: ids, inCover: r.inCover === true };
}

// The task takes the entry itself, so `task.ran` holds the defender a result was computed for.
const runDurability = (defender: UnitEntry, attackerIds: string[], inCover: boolean, snapshot: Snapshot | undefined) => simClient().durability(defender.unit, { attackerIds, context: { inCover } }, snapshot);

/** The arguments a run is made with, and which the store keeps beside its result. */
export type DurabilityArgs = Parameters<typeof runDurability>;

/** What a result was computed from, as one string the tab can compare against the controls. */
export function durabilityFingerprint(defender: UnitEntry | undefined, attackerIds: readonly string[], inCover: boolean): string {
  return JSON.stringify([defender?.id, attackerIds, inCover]);
}

/**
 * The defender's name and the fingerprint a stored result belongs to, read back from the arguments
 * the run was made with.
 *
 * The store keeps a result for as long as the app is open, so it outlives this tab. Reading these
 * back from the result's own arguments is what lets the tab be left and returned to. Holding them
 * in component state instead lost them on the way out, and the tab then came back with the header
 * calling the result current while the body offered to run it.
 */
export function durabilityRan(ran: DurabilityArgs | undefined): { name: string; fp: string } | undefined {
  if (!ran) return undefined;
  const [defender, attackerIds, inCover] = ran;
  return { name: defender.unit.name, fp: durabilityFingerprint(defender, attackerIds, inCover) };
}

/**
 * The half-width on the per-100-points column, on that column's own scale.
 *
 * An entry's interval belongs to `expectedDamage`, and `damageTakenPer100` is that figure times
 * 100 / the defender's points. The same factor is read back off the two figures, so the interval is
 * scaled along with the column instead of being printed against a figure it does not describe.
 * Reading the factor from the entry keeps both mounts of this table honest, including the dashboard
 * widget, which has the entries without the defender.
 *
 * An entry that took no damage leaves no factor to read. Its per-100 figure is zero as well, so
 * there is nothing there for an interval to place.
 */
export function per100HalfWidth(e: DurabilityEntry): number | undefined {
  if (e.ciHalfWidth === undefined || e.damageTakenPer100 === undefined) return undefined;
  if (!Number.isFinite(e.expectedDamage) || e.expectedDamage <= 0) return undefined;
  return (e.ciHalfWidth * e.damageTakenPer100) / e.expectedDamage;
}

/** Three small horizontal bar charts: one per durability metric, one bar per attacker archetype. */
export function DurabilityCharts({ entries }: { entries: DurabilityEntry[] }) {
  if (!entries.length) return <div className="empty">{t("analyses.durability.none")}</div>;
  const hasPoints = entries.some((e) => e.damageTakenPer100 !== undefined);
  const row = (e: DurabilityEntry, value: number | undefined, display: string, tone?: "brass" | "info") => ({ key: e.archetype, label: shortArchetypeName(e.archetype), title: `${e.archetype}: ${display}`, value, display, ...(tone ? { tone } : {}) });
  return (
    <div className="chart-trio">
      <div>
        <h4 className="chart-h">{t("analyses.durability.wounds")}</h4>
        <HBarChart ariaLabel={t("analyses.durability.woundsAria")} rows={entries.map((e) => row(e, e.expectedDamage, fmtSampled(e.expectedDamage, e.ciHalfWidth)))} />
      </div>
      <div>
        <h4 className="chart-h">{t("analyses.metric.pKill")}</h4>
        <HBarChart ariaLabel={t("analyses.durability.pKillAria")} max={1} rows={entries.map((e) => row(e, e.pKill, pct(e.pKill), "brass"))} />
      </div>
      {hasPoints ? (
        <div>
          <h4 className="chart-h">{t("analyses.durability.per100")}</h4>
          <HBarChart ariaLabel={t("analyses.durability.per100Aria")} rows={entries.map((e) => row(e, e.damageTakenPer100, fmtSampled(e.damageTakenPer100, per100HalfWidth(e)), "info"))} />
        </div>
      ) : null}
    </div>
  );
}

export function DurabilityTable({ entries }: { entries: DurabilityEntry[] }) {
  if (!entries.length) return <div className="empty">{t("analyses.durability.none")}</div>;
  const hasPoints = entries.some((e) => e.damageTakenPer100 !== undefined);
  return (
    <div className="table-wrap">
      <table className="data">
        <thead>
          <tr>
            <th>{t("analyses.durability.archetype")}</th>
            <th className="num">{t("analyses.durability.wounds")}</th>
            <th className="num">{t("analyses.metric.pKill")}</th>
            {hasPoints ? <th className="num">{t("analyses.durability.per100")}</th> : null}
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.archetype}>
              <td>{e.archetype}</td>
              <td className="num">{fmtSampled(e.expectedDamage, e.ciHalfWidth)}</td>
              <td className="num">{pct(e.pKill)}</td>
              {hasPoints ? <td className="num">{fmtSampled(e.damageTakenPer100, per100HalfWidth(e))}</td> : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function DurabilityTab() {
  const { snapshot } = useApp();
  const defender = useUnitSet("analyses.durability.defender");
  const [opts, setOpts] = usePersistedSetting<DurabilityOptions>("analyses.durability.options", DEFAULT_OPTIONS, parseOptions);
  const task = useWorkerTask(runDurability, "analyses.durability");
  const ran = useMemo(() => durabilityRan(task.ran), [task.ran]);
  const attackers = attackerArchetypes();
  const unit = defender.entries[0];
  const canRun = !!unit && opts.attackerIds.length > 0;
  const dirty = !!ran && ran.fp !== durabilityFingerprint(unit, opts.attackerIds, opts.inCover);

  const run = () => {
    if (!unit) return;
    task.run(unit, opts.attackerIds, opts.inCover, snapshot);
  };
  const toggleId = (id: string, on: boolean) => setOpts((o) => ({ ...o, attackerIds: on ? [...o.attackerIds.filter((x) => x !== id), id] : o.attackerIds.filter((x) => x !== id) }));

  /*
   * What an export would write. The name is the one the run was made under rather than whatever is
   * in the picker now. The button is live exactly when this exists, so it never looks available and
   * then does nothing when it is pressed.
   */
  const exportable = task.result && ran ? { entries: task.result, name: ran.name } : undefined;
  const exportCsv = () => {
    if (!exportable) return;
    download(`grimstat-durability-${new Date().toISOString().slice(0, 10)}.csv`, durabilityToCsv(exportable.name, exportable.entries), "text/csv");
  };

  // Header actions call through a ref so they never run against a stale closure.
  const handlers = useRef({ run, cancel: task.cancel, exportCsv });
  handlers.current = { run, cancel: task.cancel, exportCsv };
  const canExport = !!exportable;
  useAnalysisHeader(
    () => ({
      subtitle: unit ? t("analyses.durability.sub", { name: unit.unit.name, n: opts.attackerIds.length }) : t("analyses.durability.subIdle"),
      actions: (
        <RunActions canRun={canRun} running={task.running} onRun={() => handlers.current.run()} onCancel={() => handlers.current.cancel()}>
          <button type="button" disabled={!canExport} onClick={() => handlers.current.exportCsv()}>
            {t("analyses.exportCsv")}
          </button>
        </RunActions>
      ),
    }),
    [canRun, canExport, task.running, unit?.unit.name, opts.attackerIds.length],
  );

  return (
    <div className="analysis">
      <aside className="analysis-controls stack">
        <section className="panel">
          <UnitSetPicker label={t("analyses.set.defender")} storageKey={UNIT_SET_KEYS.durabilityDefender} entries={defender.entries} onChange={defender.setEntries} single />
        </section>
        <section className="panel stack" aria-labelledby="dur-att-h">
          <h3 id="dur-att-h" style={{ margin: 0 }}>
            {t("analyses.durability.attackers")}
          </h3>
          <div className="check-list" role="group" aria-label={t("analyses.durability.attackers")}>
            {attackers.map((a) => (
              <label key={a.id} className="inline">
                <input type="checkbox" checked={opts.attackerIds.includes(a.id)} onChange={(e) => toggleId(a.id, e.target.checked)} />
                <span>{a.name}</span>
              </label>
            ))}
          </div>
          <label className="inline">
            <input type="checkbox" checked={opts.inCover} onChange={(e) => setOpts((o) => ({ ...o, inCover: e.target.checked }))} />
            <span>{t("ctx.inCover")}</span>
          </label>
        </section>
      </aside>
      <section className="analysis-results stack">
        <RunStatus task={task} stale={dirty} />
        {task.result && ran ? (
          <>
            <h3 style={{ margin: 0 }}>{t("analyses.durability.title", { name: ran.name })}</h3>
            <DurabilityCharts entries={task.result} />
            <DurabilityTable entries={task.result} />
          </>
        ) : (
          <div className="empty">{canRun ? t("analyses.durability.ready") : t("analyses.durability.needDefender")}</div>
        )}
      </section>
    </div>
  );
}
