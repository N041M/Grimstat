import { useRef, useState } from "react";
import type { ScenarioUnit, Snapshot } from "@grimstat/schema";
import type { DurabilityEntry } from "@grimstat/game-40k-11e";
import { useApp } from "../../state/AppContext";
import { simClient } from "../../worker/client";
import { useWorkerTask } from "../../hooks/useWorkerTask";
import { useUnitSet } from "../../hooks/useUnitSet";
import { usePersistedSetting } from "../../hooks/usePersistedSetting";
import { UNIT_SET_KEYS, attackerArchetypes, shortArchetypeName, type UnitEntry } from "../../lib/unitSet";
import { fmt, pct } from "../../lib/format";
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

const runDurability = (defender: ScenarioUnit, attackerIds: string[], inCover: boolean, snapshot: Snapshot | undefined) => simClient().durability(defender, { attackerIds, context: { inCover } }, snapshot);

const fingerprint = (d: UnitEntry[], o: DurabilityOptions) => JSON.stringify([d.map((e) => e.id), o]);

/** Three small horizontal bar charts: one per durability metric, one bar per attacker archetype. */
export function DurabilityCharts({ entries }: { entries: DurabilityEntry[] }) {
  if (!entries.length) return <div className="empty">{t("analyses.durability.none")}</div>;
  const hasPoints = entries.some((e) => e.damageTakenPer100 !== undefined);
  const row = (e: DurabilityEntry, value: number | undefined, display: string, tone?: "brass" | "info") => ({ key: e.archetype, label: shortArchetypeName(e.archetype), title: `${e.archetype}: ${display}`, value, display, ...(tone ? { tone } : {}) });
  return (
    <div className="chart-trio">
      <div>
        <h4 className="chart-h">{t("analyses.durability.wounds")}</h4>
        <HBarChart ariaLabel={t("analyses.durability.woundsAria")} rows={entries.map((e) => row(e, e.expectedDamage, fmt(e.expectedDamage)))} />
      </div>
      <div>
        <h4 className="chart-h">{t("analyses.metric.pKill")}</h4>
        <HBarChart ariaLabel={t("analyses.durability.pKillAria")} max={1} rows={entries.map((e) => row(e, e.pKill, pct(e.pKill), "brass"))} />
      </div>
      {hasPoints ? (
        <div>
          <h4 className="chart-h">{t("analyses.durability.per100")}</h4>
          <HBarChart ariaLabel={t("analyses.durability.per100Aria")} rows={entries.map((e) => row(e, e.damageTakenPer100, fmt(e.damageTakenPer100), "info"))} />
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
              <td className="num">{fmt(e.expectedDamage)}</td>
              <td className="num">{pct(e.pKill)}</td>
              {hasPoints ? <td className="num">{fmt(e.damageTakenPer100)}</td> : null}
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
  const [ran, setRan] = useState<{ name: string; fp: string } | undefined>(undefined);
  const attackers = attackerArchetypes();
  const unit = defender.entries[0];
  const canRun = !!unit && opts.attackerIds.length > 0;
  const dirty = !!ran && ran.fp !== fingerprint(defender.entries, opts);

  const run = () => {
    if (!unit) return;
    setRan({ name: unit.unit.name, fp: fingerprint(defender.entries, opts) });
    task.run(unit.unit, opts.attackerIds, opts.inCover, snapshot);
  };
  const toggleId = (id: string, on: boolean) => setOpts((o) => ({ ...o, attackerIds: on ? [...o.attackerIds.filter((x) => x !== id), id] : o.attackerIds.filter((x) => x !== id) }));

  // Header actions call through a ref so they never run against a stale closure.
  const handlers = useRef({ run, cancel: task.cancel });
  handlers.current = { run, cancel: task.cancel };
  useAnalysisHeader(
    () => ({
      subtitle: unit ? t("analyses.durability.sub", { name: unit.unit.name, n: opts.attackerIds.length }) : t("analyses.durability.subIdle"),
      actions: <RunActions canRun={canRun} running={task.running} onRun={() => handlers.current.run()} onCancel={() => handlers.current.cancel()} />,
    }),
    [canRun, task.running, unit?.unit.name, opts.attackerIds.length],
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
