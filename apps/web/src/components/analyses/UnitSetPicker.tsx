import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { Datasheet, Roster, Snapshot } from "@grimstat/schema";
import { archetypes, unitFromDatasheet } from "@grimstat/game-40k-11e";
import { db } from "../../db";
import { useApp } from "../../state/AppContext";
import { hrefFor } from "../../router";
import { attackerArchetypes, makeEntry, rosterHostEntries, totalPoints, type UnitEntry } from "../../lib/unitSet";
import { fmtInt } from "../../lib/format";
import { Field, Tabs } from "../ui";
import { t } from "../../i18n";

type Source = "army" | "archetype" | "datasheet" | "calculator";

export interface UnitSetPickerProps {
  /** Heading of the set ("Attackers", "Targets"…). */
  label: string;
  entries: UnitEntry[];
  onChange: (next: UnitEntry[]) => void;
  /** Exactly one unit (adding replaces). */
  single?: boolean;
  /** Restrict the archetype list to those that can attack. */
  archetypeFilter?: "attackers" | "all";
  /** Extra per-chip controls (turn optimiser: stratagem option, priority weight). */
  renderExtra?: (entry: UnitEntry, update: (patch: Partial<UnitEntry>) => void) => ReactNode;
}

/** Shared "build a set of units" control: army units, archetypes, datasheets or the calculator's units; chips with points. */
export function UnitSetPicker({ label, entries, onChange, single, archetypeFilter = "all", renderExtra }: UnitSetPickerProps) {
  const { snapshot, scenario } = useApp();
  const [source, setSource] = useState<Source>("archetype");

  const add = (added: UnitEntry[]) => {
    if (!added.length) return;
    onChange(single ? [added[added.length - 1]!] : [...entries, ...added]);
  };
  const remove = (id: string) => onChange(entries.filter((e) => e.id !== id));
  const update = (id: string) => (patch: Partial<UnitEntry>) => onChange(entries.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  const clear = () => onChange([]);
  const points = totalPoints(entries);

  return (
    <div className="unit-set">
      <div className="row between">
        <h3 style={{ margin: 0 }}>
          {label} <span className="muted small">({entries.length}{points !== undefined ? ` · ${t("unit.points", { v: fmtInt(points) })}` : ""})</span>
        </h3>
        {entries.length ? (
          <button type="button" className="ghost sm" onClick={clear}>
            {t("analyses.picker.clear")}
          </button>
        ) : null}
      </div>
      {entries.length ? (
        <ul className="unit-chips" aria-label={label}>
          {entries.map((e) => (
            <li key={e.id} className="unit-chip">
              <span className="unit-chip-main">
                <span className="unit-chip-name" title={e.unit.name}>
                  {e.unit.name}
                </span>
                {e.unit.points !== undefined ? <span className="badge accent">{t("unit.points", { v: fmtInt(e.unit.points) })}</span> : null}
                <span className="muted small">{e.origin}</span>
                <button type="button" className="chip-x" onClick={() => remove(e.id)} aria-label={t("analyses.picker.remove", { name: e.unit.name })}>
                  ×
                </button>
              </span>
              {renderExtra ? <span className="unit-chip-extra">{renderExtra(e, update(e.id))}</span> : null}
            </li>
          ))}
        </ul>
      ) : (
        <div className="empty small">{single ? t("analyses.picker.emptySingle") : t("analyses.picker.empty")}</div>
      )}
      <Tabs<Source>
        label={t("analyses.picker.sources", { set: label })}
        value={source}
        onChange={setSource}
        tabs={[
          { id: "army", label: t("analyses.picker.army") },
          { id: "archetype", label: t("analyses.picker.archetypes") },
          { id: "datasheet", label: t("analyses.picker.datasheets") },
          { id: "calculator", label: t("analyses.picker.calculator") },
        ]}
      />
      {source === "army" ? <ArmySource snapshot={snapshot} single={!!single} onAdd={add} /> : null}
      {source === "archetype" ? <ArchetypeSource filter={archetypeFilter} single={!!single} onAdd={add} /> : null}
      {source === "datasheet" ? <DatasheetSource snapshot={snapshot} onAdd={add} /> : null}
      {source === "calculator" ? (
        <div className="row">
          {(["attacker", "defender"] as const).map((side) => {
            const u = scenario[side];
            const usable = u.models.length > 0;
            return (
              <button key={side} type="button" className="sm" disabled={!usable} onClick={() => add([makeEntry({ kind: "calculator", side }, u, t("analyses.picker.originCalculator"))])}>
                {t(side === "attacker" ? "analyses.picker.addAttacker" : "analyses.picker.addDefender", { name: u.name })}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function ArmySource({ snapshot, single, onAdd }: { snapshot: Snapshot | undefined; single: boolean; onAdd: (e: UnitEntry[]) => void }) {
  const [rosters, setRosters] = useState<Roster[] | undefined>(undefined);
  const [rosterId, setRosterId] = useState("");
  const [rosterSnap, setRosterSnap] = useState<{ id: string; snapshot: Snapshot | undefined } | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    void db.rosters.toArray().then((all) => {
      if (!alive) return;
      const sorted = all.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
      setRosters(sorted);
      setRosterId((cur) => cur || sorted[0]?.id || "");
    });
    return () => {
      alive = false;
    };
  }, []);

  const roster = rosters?.find((r) => r.id === rosterId);
  const wanted = roster?.snapshotId;
  useEffect(() => {
    if (!wanted || wanted === snapshot?.id) return;
    let alive = true;
    void db.snapshots.get(wanted).then((s) => alive && setRosterSnap({ id: wanted, snapshot: s }));
    return () => {
      alive = false;
    };
  }, [wanted, snapshot?.id]);

  const snap = !roster ? undefined : roster.snapshotId === snapshot?.id ? snapshot : rosterSnap?.id === roster.snapshotId ? (rosterSnap.snapshot ?? snapshot) : undefined;
  const units = useMemo(() => (roster && snap ? rosterHostEntries(roster, snap) : []), [roster, snap]);

  if (rosters && !rosters.length)
    return (
      <div className="empty small">
        {t("analyses.picker.noArmies")} <a href={hrefFor("armies")}>{t("nav.armies")}</a>
      </div>
    );
  return (
    <div className="stack">
      <div className="field-row">
        <Field label={t("analyses.picker.armyLabel")} className="grow">
          <select value={rosterId} onChange={(e) => setRosterId(e.target.value)}>
            {(rosters ?? []).map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </Field>
        {!single ? (
          <button type="button" className="sm" disabled={!units.length} onClick={() => onAdd(units)}>
            {t("analyses.picker.addAll", { n: units.length })}
          </button>
        ) : null}
      </div>
      {roster && !snap ? <p className="muted small">{t("analyses.picker.armyLoading")}</p> : null}
      {roster && snap && !units.length ? <p className="muted small">{t("analyses.picker.armyEmpty")}</p> : null}
      {units.length ? (
        <div className="datasheet-list" role="listbox" aria-label={t("analyses.picker.armyUnits")}>
          {units.map((u) => (
            <button key={u.id} type="button" role="option" aria-selected={false} onClick={() => onAdd([makeEntry(u.source, u.unit, u.origin)])}>
              <span>{u.unit.name}</span>
              <span className="muted small">{u.unit.points !== undefined ? t("unit.points", { v: fmtInt(u.unit.points) }) : ""}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ArchetypeSource({ filter, single, onAdd }: { filter: "attackers" | "all"; single: boolean; onAdd: (e: UnitEntry[]) => void }) {
  const list = useMemo(() => (filter === "attackers" ? attackerArchetypes() : archetypes), [filter]);
  const [checked, setChecked] = useState<Set<string>>(() => new Set());
  const origin = t("analyses.picker.originArchetype");
  const entriesFor = (ids: string[]) => ids.flatMap((id) => {
    const a = list.find((x) => x.id === id);
    return a ? [makeEntry({ kind: "archetype", archetypeId: a.id }, a.unit, origin)] : [];
  });
  if (single)
    return (
      <Field label={t("analyses.picker.archetypeLabel")}>
        <select value="" onChange={(e) => e.target.value && onAdd(entriesFor([e.target.value]))}>
          <option value="">{t("picker.chooseArchetype")}</option>
          {list.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </Field>
    );
  const toggle = (id: string, on: boolean) =>
    setChecked((s) => {
      const n = new Set(s);
      if (on) n.add(id);
      else n.delete(id);
      return n;
    });
  return (
    <div className="stack">
      <div className="check-list" role="group" aria-label={t("analyses.picker.archetypeLabel")}>
        {list.map((a) => (
          <label key={a.id} className="inline">
            <input type="checkbox" checked={checked.has(a.id)} onChange={(e) => toggle(a.id, e.target.checked)} />
            <span>
              {a.name}
              {a.unit.points !== undefined ? <span className="muted small"> · {t("unit.points", { v: fmtInt(a.unit.points) })}</span> : null}
            </span>
          </label>
        ))}
      </div>
      <div className="row">
        <button
          type="button"
          className="sm"
          disabled={!checked.size}
          onClick={() => {
            onAdd(entriesFor(list.filter((a) => checked.has(a.id)).map((a) => a.id)));
            setChecked(new Set());
          }}
        >
          {t("analyses.picker.addSelected", { n: checked.size })}
        </button>
      </div>
    </div>
  );
}

function DatasheetSource({ snapshot, onAdd }: { snapshot: Snapshot | undefined; onAdd: (e: UnitEntry[]) => void }) {
  const [factionId, setFactionId] = useState("");
  const [search, setSearch] = useState("");
  const factions = useMemo(() => {
    if (!snapshot) return [];
    if (snapshot.data.factions.length) return [...snapshot.data.factions].sort((a, b) => a.name.localeCompare(b.name));
    return [...new Set(snapshot.data.datasheets.map((d) => d.factionId))].map((id) => ({ id, name: id }));
  }, [snapshot]);
  useEffect(() => {
    if (!factionId && factions.length) setFactionId(factions[0]!.id);
  }, [factions, factionId]);
  const sheets = useMemo(() => {
    if (!snapshot) return [];
    const q = search.trim().toLowerCase();
    return snapshot.data.datasheets.filter((d) => (!factionId || d.factionId === factionId) && (!q || d.name.toLowerCase().includes(q))).sort((a, b) => a.name.localeCompare(b.name));
  }, [snapshot, factionId, search]);

  if (!snapshot)
    return (
      <div className="empty small">
        {t("picker.noSnapshot")} <a href={hrefFor("data")}>{t("nav.data")}</a>
      </div>
    );
  const pick = (ds: Datasheet) => onAdd([makeEntry({ kind: "datasheet", snapshotId: snapshot.id, datasheetId: ds.id }, unitFromDatasheet(ds, snapshot), snapshot.label ?? snapshot.id)]);
  return (
    <div className="stack">
      <div className="field-row">
        <Field label={t("picker.faction")}>
          <select value={factionId} onChange={(e) => setFactionId(e.target.value)}>
            {factions.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("picker.search")} className="grow">
          <input type="search" value={search} placeholder={t("picker.searchPlaceholder")} onChange={(e) => setSearch(e.target.value)} />
        </Field>
      </div>
      <div className="datasheet-list" role="listbox" aria-label={t("picker.datasheets")}>
        {sheets.length ? (
          sheets.map((d) => (
            <button key={d.id} type="button" role="option" aria-selected={false} onClick={() => pick(d)}>
              <span>{d.name}</span>
              <span className="muted small">{d.role ?? ""}</span>
            </button>
          ))
        ) : (
          <div className="empty">{t("picker.noDatasheets")}</div>
        )}
      </div>
    </div>
  );
}
