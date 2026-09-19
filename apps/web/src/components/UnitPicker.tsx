import { useEffect, useMemo, useState } from "react";
import { UnitArt } from "./UnitArt";
import type { Datasheet, ScenarioUnit, Snapshot } from "@grimstat/schema";
import { compositionBounds } from "@grimstat/game-40k-11e";
import { gameApi, host } from "../plugin";
import { cloneUnit, modelCount } from "../lib/scenario";
import { ALL_FACTIONS } from "../lib/codex";
import { fmtInt } from "../lib/format";
import { deleteUnitPreset, listUnitPresets, saveUnitPreset, type UnitPresetRecord } from "../db";
import { useStoreVersion } from "../hooks/useStoreVersion";
import { findPresetByName, newPreset, presetSummary, replacePresetUnit, suggestPresetName } from "../lib/unitPreset";
import { useApp } from "../state/AppContext";
import { CustomUnitEditor } from "./CustomUnitEditor";
import { LoadoutCheck } from "./LoadoutCheck";
import { WeaponRows } from "./WeaponRows";
import { Field, Icon, Tabs, useConfirm } from "./ui";
import { t, tn } from "../i18n";

type Tab = "data" | "archetype" | "custom" | "preset";

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

/**
 * How many models a unit starts with: the smallest legal unit.
 *
 * Summed across the composition lines rather than taken from the largest of them — a sheet written
 * as "1 Sergeant" and "4-9 Troopers" is a unit of five, not of four.
 */
function defaultCount(ds: Datasheet): number {
  const { min } = compositionBounds(ds);
  if (min && min > 0) return min;
  return ds.models.length > 1 ? ds.models.length : 1;
}

export function UnitPicker({ side, unit, snapshot, loadKey, onChange }: Props) {
  const { notify } = useApp();
  const [tab, setTab] = useState<Tab>(() => deriveTab(unit));
  // Every faction until the reader picks one, so a search reaches the whole snapshot.
  const [factionId, setFactionId] = useState<string>(ALL_FACTIONS);
  const [search, setSearch] = useState("");
  const [count, setCount] = useState<number>(() => modelCount(unit) || 1);
  const [attached, setAttached] = useState<string[]>(() => unit.ref?.attachedDatasheetIds ?? []);
  const datasheetId = unit.ref?.datasheetId;

  const api = gameApi();

  // Re-derive picker state when a scenario is loaded from storage / permalink.
  useEffect(() => {
    setTab(deriveTab(unit));
    setNameTouched(false);
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

  /**
   * The bounds of the whole unit, not of its first composition line.
   *
   * Reading `composition[0]` alone put a squad written as "1 Sergeant" / "4-9 Troopers" at min 1,
   * max 1, so the field refused every legal size and snapped whatever was typed back to one. The
   * army builder already sums the lines; this is the same rule, in the other place that needs it.
   */
  const bounds = useMemo(() => (selected ? compositionBounds(selected) : {}), [selected]);
  const minCount = bounds.min ?? 1;
  const maxCount = bounds.max ?? Math.max(minCount, 30);
  /** Every composition line, since the unit is only described by all of them together. */
  const compositionHint = selected?.composition.map((c) => c.description).filter(Boolean).join(" · ");

  /**
   * The unit as the app builds it from this datasheet, with nothing changed. The loadout check
   * compares against it so that anything the default is already guilty of — a loadout line the
   * parser could not read, so every model was handed the weapon — is not reported as the player's.
   */
  const defaultUnit = useMemo(() => {
    if (!snapshot || !selected) return undefined;
    try {
      return api.unitFromDatasheet(selected, snapshot, { modelCount: count, attachedDatasheetIds: attached });
    } catch {
      return undefined;
    }
  }, [api, snapshot, selected, count, attached]);

  /**
   * Build the unit from a datasheet and hand it up; false when the datasheet could not be built.
   *
   * Imported data does throw here, and an exception from a click handler does not reach the error
   * boundary. Without this the button would do nothing and only the console would say why. The
   * picker's own state follows the unit, so it is left alone when the build fails.
   */
  const build = (ds: Datasheet, n: number, att: string[]): boolean => {
    if (!snapshot) return false;
    try {
      onChange(api.unitFromDatasheet(ds, snapshot, { modelCount: n, attachedDatasheetIds: att }));
      return true;
    } catch (err) {
      notify(t("palette.unitFailed", { name: ds.name }), "error", [err instanceof Error ? err.message : String(err)]);
      return false;
    }
  };

  const pickDatasheet = (ds: Datasheet) => {
    const n = defaultCount(ds);
    if (!build(ds, n, [])) return;
    setCount(n);
    setAttached([]);
  };
  const changeCount = (n: number) => {
    if (selected && !build(selected, n, attached)) return;
    setCount(n);
  };

  /*
   * The model-count field holds what is typed and only commits it when the box is left or Enter is
   * pressed.
   *
   * Committing each keystroke rebuilt the unit from the datasheet, which put every weapon back to
   * the default and threw away whatever the player had ticked. It also made the field impossible to
   * clear. A squad of ten snapped straight back to its smallest legal size the moment Backspace
   * took a digit off.
   */
  const [countText, setCountText] = useState(String(count));
  const [editingCount, setEditingCount] = useState(false);
  useEffect(() => {
    if (!editingCount) setCountText(String(count));
  }, [count, editingCount]);
  const commitCount = () => {
    const n = Number(countText);
    const next = countText.trim() === "" || !Number.isFinite(n) ? count : Math.min(maxCount, Math.max(minCount, Math.floor(n)));
    setCountText(String(next));
    if (next !== count) changeCount(next);
  };
  const toggleAttached = (id: string, on: boolean) => {
    const next = on ? [...attached, id] : attached.filter((x) => x !== id);
    if (selected && !build(selected, count, next)) return;
    setAttached(next);
  };

  // Presets live in Dexie and any other picker can add one, so the list follows the store rather
  // than a snapshot of it taken when the dialog opened.
  const presetVersion = useStoreVersion("unitPresets");
  const [presets, setPresets] = useState<UnitPresetRecord[]>([]);
  const [presetName, setPresetName] = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  const { confirm, dialog: confirmDialog } = useConfirm();

  useEffect(() => {
    let alive = true;
    void listUnitPresets()
      .then((all) => {
        if (alive) setPresets(all);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [presetVersion]);

  // Until the player types a name of their own, the field follows the unit they are configuring.
  useEffect(() => {
    if (!nameTouched) setPresetName(suggestPresetName(unit, presets));
  }, [unit, unit.name, presets, nameTouched]);

  const existing = findPresetByName(presets, presetName);
  const canSave = presetName.trim().length > 0 && unit.models.length > 0;

  // Saving takes a write and a reload of the list, and until both have happened the name still
  // reads as unused. A second press in that gap made a second preset under the same name, so the
  // button is held until the first one is done.
  const [saving, setSaving] = useState(false);
  const savePreset = async () => {
    if (!canSave || saving) return;
    setSaving(true);
    try {
      const record = existing ? replacePresetUnit(existing, unit, snapshot) : newPreset(presetName, unit, snapshot);
      await saveUnitPreset(record);
      // The field keeps the name it was saved under, so pressing save again updates that preset
      // rather than quietly making a second one beside it.
      setNameTouched(true);
      setPresetName(record.name);
      notify(t(existing ? "picker.preset.updated" : "picker.preset.saved", { name: record.name }), "success");
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setSaving(false);
    }
  };

  const removePreset = async (preset: UnitPresetRecord) => {
    if (!(await confirm({ title: t("picker.preset.deleteTitle"), body: t("picker.preset.deleteBody", { name: preset.name }), confirmLabel: t("common.delete"), danger: true }))) return;
    await deleteUnitPreset(preset.id);
    notify(t("picker.preset.deleted", { name: preset.name }), "success");
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
          { id: "preset", label: presets.length ? t("picker.presetsN", { n: presets.length }) : t("picker.presets") },
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
                  <Field label={t("picker.modelCount")} hint={compositionHint || undefined}>
                    <input
                      type="number"
                      min={minCount}
                      max={maxCount}
                      value={countText}
                      onFocus={() => setEditingCount(true)}
                      onChange={(e) => setCountText(e.target.value)}
                      onBlur={() => {
                        commitCount();
                        setEditingCount(false);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitCount();
                      }}
                    />
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
                {defaultUnit ? <LoadoutCheck datasheet={selected} unit={unit} baseline={defaultUnit} /> : null}
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

      {tab === "preset" ? (
        presets.length ? (
          <div className="datasheet-list" role="listbox" aria-label={t("picker.presets")}>
            {presets.map((p) => {
              const { models, weapons, points } = presetSummary(p);
              return (
                <div key={p.id} className="preset-row">
                  <button
                    type="button"
                    role="option"
                    aria-selected={false}
                    onClick={() => {
                      onChange(cloneUnit(p.unit));
                      setNameTouched(true);
                      setPresetName(p.name);
                      // The data tab's own fields have to follow the preset, or its model count and
                      // attachments show whatever was last picked and the next edit rebuilds the
                      // unit from the wrong numbers.
                      setAttached(p.unit.ref?.attachedDatasheetIds ?? []);
                      // The unit's own models, not an attached character's, exactly as the data tab counts them.
                      setCount(p.unit.models.filter((m) => !m.isCharacter).reduce((n, m) => n + m.count, 0) || modelCount(p.unit) || 1);
                    }}
                  >
                    <span>
                      <UnitArt of={p.unit} />
                      {p.name}
                    </span>
                    <span className="muted small">
                      {[tn(models, "picker.preset.models.one", "picker.preset.models.many"), weapons.length ? weapons.join(", ") : t("picker.preset.noWeapons"), points !== undefined ? t("unit.points", { v: fmtInt(points) }) : ""].filter(Boolean).join(" · ")}
                    </span>
                  </button>
                  <button type="button" className="ghost sm" aria-label={t("picker.preset.deleteAria", { name: p.name })} onClick={() => void removePreset(p)}>
                    <Icon name="trash" />
                  </button>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="empty">{t("picker.preset.empty")}</div>
        )
      ) : null}

      {/*
        Saving is offered under every tab, not just the preset one. A preset is worth most for a unit
        that took work to build — a custom profile, a datasheet with its loadout changed — and that
        work happens on the other tabs.
      */}
      <div className="preset-save">
        <Field label={t("picker.preset.name")} className="grow">
          <input
            type="text"
            value={presetName}
            placeholder={t("picker.preset.namePlaceholder")}
            onChange={(e) => {
              setNameTouched(true);
              setPresetName(e.target.value);
            }}
          />
        </Field>
        <button type="button" disabled={!canSave || saving} onClick={() => void savePreset()}>
          {existing ? t("picker.preset.update") : t("picker.preset.save")}
        </button>
      </div>
      {confirmDialog}
    </div>
  );
}
