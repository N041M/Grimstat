import { useEffect, useMemo, useState } from "react";
import { UnitArt } from "./UnitArt";
import type { Datasheet, ScenarioUnit, Snapshot } from "@grimstat/schema";
import { gameApi, host } from "../plugin";
import { cloneUnit, modelCount } from "../lib/scenario";
import { ALL_FACTIONS } from "../lib/codex";
import { fmtInt } from "../lib/format";
import { CustomUnitEditor } from "./CustomUnitEditor";
import { WeaponRows } from "./WeaponRows";
import { Field, Tabs } from "./ui";
import { t } from "../i18n";

type Tab = "data" | "archetype" | "custom";

interface Props {
  side: "attacker" | "defender";
  unit: ScenarioUnit;
  snapshot: Snapshot | undefined;
  /** Bumps when a scenario is loaded wholesale; the picker re-derives its state from the unit. */
  loadKey: number;
  onChange: (unit: ScenarioUnit) => void;
}

function archetypeIdFor(unit: ScenarioUnit): string | undefined {
  for (const a of host.registries.archetypes.values()) if (a.unit.name === unit.name && !unit.ref) return a.id;
  return undefined;
}

function deriveTab(unit: ScenarioUnit): Tab {
  if (unit.ref) return "data";
  if (archetypeIdFor(unit)) return "archetype";
  return "custom";
}

function defaultCount(ds: Datasheet): number {
  const mins = ds.composition.map((c) => c.min).filter((m): m is number => typeof m === "number" && m > 0);
  if (mins.length) return Math.max(...mins);
  return ds.models.length > 1 ? ds.models.length : 1;
}

export function UnitPicker({ side, unit, snapshot, loadKey, onChange }: Props) {
  const [tab, setTab] = useState<Tab>(() => deriveTab(unit));
  const [factionId, setFactionId] = useState<string>("");
  const [search, setSearch] = useState("");
  const [count, setCount] = useState<number>(() => modelCount(unit) || 1);
  const [attached, setAttached] = useState<string[]>(() => unit.ref?.attachedDatasheetIds ?? []);
  const datasheetId = unit.ref?.datasheetId;

  const api = gameApi();

  // Re-derive picker state when a scenario is loaded from storage / permalink.
  useEffect(() => {
    setTab(deriveTab(unit));
    setAttached(unit.ref?.attachedDatasheetIds ?? []);
    const ds = unit.ref && snapshot ? snapshot.data.datasheets.find((d) => d.id === unit.ref?.datasheetId) : undefined;
    if (ds) {
      setFactionId(ds.factionId);
      const own = unit.models.filter((m) => !m.isCharacter).reduce((s, m) => s + m.count, 0);
      setCount(own || defaultCount(ds));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadKey, snapshot?.id]);

  const factions = useMemo(() => {
    if (!snapshot) return [];
    if (snapshot.data.factions.length) return [...snapshot.data.factions].sort((a, b) => a.name.localeCompare(b.name));
    const ids = [...new Set(snapshot.data.datasheets.map((d) => d.factionId))];
    return ids.map((id) => ({ id, name: id }));
  }, [snapshot]);

  useEffect(() => {
    if (!factionId && factions.length) setFactionId(factions[0]!.id);
  }, [factions, factionId]);

  const everyFaction = factionId === ALL_FACTIONS;
  const factionNames = useMemo(() => new Map(factions.map((f) => [f.id, f.name] as const)), [factions]);
  const datasheets = useMemo(() => {
    if (!snapshot) return [];
    const q = search.trim().toLowerCase();
    return snapshot.data.datasheets
      .filter((d) => (!factionId || everyFaction || d.factionId === factionId) && (!q || d.name.toLowerCase().includes(q)))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [snapshot, factionId, everyFaction, search]);

  const selected = useMemo(() => (snapshot && datasheetId ? snapshot.data.datasheets.find((d) => d.id === datasheetId) : undefined), [snapshot, datasheetId]);

  const attachable = useMemo(() => {
    if (!snapshot || !selected) return [];
    return snapshot.data.datasheets.filter((d) => d.id !== selected.id && (d.leaderTo.includes(selected.id) || d.supportTo.includes(selected.id))).sort((a, b) => a.name.localeCompare(b.name));
  }, [snapshot, selected]);

  const composition = selected?.composition[0];
  const minCount = composition?.min ?? 1;
  const maxCount = composition?.max ?? Math.max(minCount, 30);

  const build = (ds: Datasheet, n: number, att: string[]) => {
    if (!snapshot) return;
    onChange(api.unitFromDatasheet(ds, snapshot, { modelCount: n, attachedDatasheetIds: att }));
  };

  const pickDatasheet = (ds: Datasheet) => {
    const n = defaultCount(ds);
    setCount(n);
    setAttached([]);
    build(ds, n, []);
  };
  const changeCount = (n: number) => {
    setCount(n);
    if (selected) build(selected, n, attached);
  };
  const toggleAttached = (id: string, on: boolean) => {
    const next = on ? [...attached, id] : attached.filter((x) => x !== id);
    setAttached(next);
    if (selected) build(selected, count, next);
  };

  const archetypes = useMemo(() => [...host.registries.archetypes.values()], []);
  const archetypeId = archetypeIdFor(unit) ?? "";
  const pickArchetype = (id: string) => {
    const a = host.registries.archetypes.get(id);
    if (a) onChange(cloneUnit(a.unit));
  };

  const switchTab = (next: Tab) => {
    setTab(next);
    if (next === "custom" && (unit.ref || archetypeIdFor(unit))) {
      // Customising: keep the current stats inline, drop the data reference.
      const { ref: _ref, ...rest } = cloneUnit(unit);
      onChange({ ...rest, name: unit.ref ? `${unit.name} (custom)` : unit.name });
    }
  };

  const setWeapons = (weapons: ScenarioUnit["weapons"]) => onChange({ ...unit, weapons });

  return (
    <div className="stack">
      <Tabs<Tab>
        label={t(side === "attacker" ? "picker.attackerTabs" : "picker.defenderTabs")}
        value={tab}
        onChange={switchTab}
        tabs={[
          { id: "data", label: t("picker.fromData") },
          { id: "archetype", label: t("picker.archetype") },
          { id: "custom", label: t("picker.custom") },
        ]}
      />

      {tab === "data" ? (
        !snapshot ? (
          <div className="empty">
            {t("picker.noSnapshot")} <a href="#/data">{t("nav.data")}</a>
          </div>
        ) : (
          <div className="stack">
            <div className="field-row">
              <Field label={t("picker.faction")}>
                <select value={factionId} onChange={(e) => setFactionId(e.target.value)}>
                  <option value={ALL_FACTIONS}>{t("codex.allFactions")}</option>
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
              {datasheets.length ? (
                datasheets.map((d) => (
                  <button key={d.id} type="button" role="option" aria-selected={d.id === datasheetId} aria-pressed={d.id === datasheetId} onClick={() => pickDatasheet(d)}>
                    <span>
                      <UnitArt of={d} />
                      {d.name}
                    </span>
                    {/* Across every faction the role alone does not place a sheet, so its faction is named too. */}
                    <span className="muted small">{[everyFaction ? (factionNames.get(d.factionId) ?? d.factionId) : "", d.role ?? ""].filter(Boolean).join(" · ")}</span>
                  </button>
                ))
              ) : (
                <div className="empty">{t("picker.noDatasheets")}</div>
              )}
            </div>
            {selected ? (
              <div className="stack">
                <div className="field-row">
                  <Field label={t("picker.modelCount")} hint={composition ? composition.description : undefined}>
                    <input type="number" min={minCount} max={maxCount} value={count} onChange={(e) => changeCount(Math.min(maxCount, Math.max(minCount, Math.floor(Number(e.target.value) || minCount))))} />
                  </Field>
                  {unit.points !== undefined ? <span className="badge accent">{t("unit.points", { v: fmtInt(unit.points) })}</span> : null}
                </div>
                {attachable.length ? (
                  <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
                    <legend className="small muted" style={{ textTransform: "uppercase", letterSpacing: "0.06em", fontSize: "0.7rem" }}>
                      {t("picker.attach")}
                    </legend>
                    <div className="check-list">
                      {attachable.map((c) => (
                        <label key={c.id} className="inline">
                          <input type="checkbox" checked={attached.includes(c.id)} onChange={(e) => toggleAttached(c.id, e.target.checked)} />
                          <span>
                            {c.name} <span className="muted small">{c.leaderTo.includes(selected.id) ? t("picker.leader") : t("picker.support")}</span>
                          </span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                ) : null}
                <WeaponRows weapons={unit.weapons} onChange={setWeapons} />
              </div>
            ) : (
              <p className="muted small">{t("picker.pickOne")}</p>
            )}
          </div>
        )
      ) : null}

      {tab === "archetype" ? (
        <div className="stack">
          <Field label={t("picker.archetype")}>
            <select value={archetypeId} onChange={(e) => pickArchetype(e.target.value)}>
              <option value="">{t("picker.chooseArchetype")}</option>
              {archetypes.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </Field>
          {archetypeId ? <WeaponRows weapons={unit.weapons} onChange={setWeapons} /> : <p className="muted small">{t("picker.pickOne")}</p>}
        </div>
      ) : null}

      {tab === "custom" ? <CustomUnitEditor unit={unit} onChange={onChange} /> : null}
    </div>
  );
}
