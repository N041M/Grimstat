import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { isDiceExpr, type ScenarioModel, type ScenarioUnit, type ScenarioWeapon } from "@grimstat/schema";
import { keywordRegistry } from "@grimstat/game-40k-11e";
import { keywordsToText, parseKeywordText } from "../lib/keywordParser";
import { unitKeywordVocabulary } from "../lib/keywordSuggest";
import { defaultModel, defaultWeapon } from "../lib/scenario";
import { useApp } from "../state/AppContext";
import { KeywordField } from "./KeywordField";
import { numOrNull } from "./ui";
import { t } from "../i18n";

/** The schema's own test, so the field refuses exactly what the engine would refuse to parse. */
export const isDice = (s: string): boolean => isDiceExpr(s);

/** Text input that keeps local text while typing and only commits valid values; resyncs when the prop changes elsewhere. */
function TextCell({ value, onCommit, validate, className, label }: { value: string; onCommit: (v: string) => void; validate?: (v: string) => boolean; className?: string; label: string }) {
  const [text, setText] = useState(value);
  const last = useRef(value);
  useEffect(() => {
    if (value !== last.current) {
      last.current = value;
      setText(value);
    }
  }, [value]);
  const invalid = validate ? !validate(text) : false;
  return (
    <input
      type="text"
      aria-label={label}
      className={className}
      value={text}
      aria-invalid={invalid || undefined}
      onChange={(e) => {
        const v = e.target.value;
        setText(v);
        if (!validate || validate(v)) {
          last.current = v;
          onCommit(v);
        }
      }}
    />
  );
}

/**
 * Number input with a range. Valid values commit as they are typed; anything else waits for blur or
 * Enter, when the value is clamped into range (or, for an optional field, cleared to null). So a
 * field can be emptied to type a new number without snapping to the minimum on each keystroke.
 */
function NumCell({ value, min, max, nullable, normalize, onCommit, label, disabled }: { value: number | null | undefined; min?: number; max?: number; nullable?: boolean; /** Applied before the range check, e.g. AP typed as "-1" is stored as 1. */ normalize?: (n: number) => number; onCommit: (v: number | null) => void; label: string; disabled?: boolean }) {
  const asText = (v: number | null | undefined) => (v === null || v === undefined ? "" : String(v));
  const [text, setText] = useState(asText(value));
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!editing) setText(asText(value));
  }, [value, editing]);
  const norm = normalize ?? ((n: number) => n);
  const lo = min ?? -Infinity;
  const hi = max ?? Infinity;
  const inRange = (n: number) => n >= lo && n <= hi;
  const commit = () => {
    const n = Number(text);
    if (text.trim() === "") {
      if (nullable) onCommit(null);
      else setText(asText(value));
      return;
    }
    if (!Number.isFinite(n)) {
      setText(asText(value));
      return;
    }
    const next = Math.min(hi, Math.max(lo, norm(n)));
    setText(String(next));
    if (next !== value) onCommit(next);
  };
  return (
    <input
      type="number"
      aria-label={label}
      min={min}
      max={max}
      value={text}
      disabled={disabled}
      onFocus={() => setEditing(true)}
      onChange={(e) => {
        const v = e.target.value;
        setText(v);
        const n = Number(v);
        if (v.trim() === "") {
          if (nullable) onCommit(null);
        } else if (Number.isFinite(n) && inRange(norm(n))) onCommit(norm(n));
      }}
      onBlur={() => {
        commit();
        setEditing(false);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
      }}
    />
  );
}

const whole = (n: number) => Math.floor(n);
const absWhole = (n: number) => Math.floor(Math.abs(n));

export function CustomUnitEditor({ unit, onChange }: { unit: ScenarioUnit; onChange: (u: ScenarioUnit) => void }) {
  const { snapshot } = useApp();
  // Weapon keywords come from the game system, which is what decides whether one is modelled at
  // all. Unit keywords come from the loaded data, because they are whatever the datasheets carry.
  const weaponKeywords = useMemo(() => keywordRegistry.suggestions(), []);
  const unitKeywords = useMemo(() => unitKeywordVocabulary(snapshot), [snapshot]);
  const setModels = (models: ScenarioModel[]) => onChange({ ...unit, models });
  const setWeapons = (weapons: ScenarioWeapon[]) => onChange({ ...unit, weapons });
  const um = (i: number, patch: Partial<ScenarioModel>) => setModels(unit.models.map((m, j) => (j === i ? { ...m, ...patch } : m)));
  const uw = (i: number, patch: Partial<ScenarioWeapon>) => setWeapons(unit.weapons.map((w, j) => (j === i ? { ...w, ...patch } : w)));

  return (
    <div className="stack">
      <div className="field-row">
        <label className="field" style={{ flex: 1 }}>
          <span>{t("unit.name")}</span>
          <input type="text" value={unit.name} onChange={(e) => onChange({ ...unit, name: e.target.value })} />
        </label>
        <label className="field">
          <span>{t("unit.pointsLabel")}</span>
          <input type="number" min={0} value={unit.points ?? ""} onChange={(e) => onChange({ ...unit, points: numOrNull(e.target.value) ?? undefined })} />
        </label>
        <label className="field" style={{ flex: 1 }}>
          <span>{t("unit.keywords")}</span>
          <KeywordField label={t("unit.keywords")} value={unit.keywords.join(", ")} suggestions={unitKeywords} unknownLabel="editor.kw.unknownUnit" onCommit={(v) => onChange({ ...unit, keywords: v.split(",").map((x) => x.trim().toUpperCase()).filter(Boolean) })} />
        </label>
      </div>

      <div>
        <div className="row between">
          <h3>{t("editor.models")}</h3>
          <button type="button" className="sm" onClick={() => setModels([...unit.models, defaultModel()])}>
            {t("editor.addModel")}
          </button>
        </div>
        <div className="table-wrap">
          <table className="data editor-table">
            <thead>
              <tr>
                <th>{t("model.name")}</th>
                <th className="num">#</th>
                <th className="num">T</th>
                <th className="num">Sv</th>
                <th className="num">Inv</th>
                <th className="num">W</th>
                <th className="num">FNP</th>
                <th>{t("model.character")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {unit.models.map((m, i) => (
                <tr key={i}>
                  <td>
                    <input type="text" aria-label={t("model.name")} value={m.name} onChange={(e) => um(i, { name: e.target.value })} />
                  </td>
                  <td className="num">
                    <NumCell label={t("model.count")} value={m.count} min={1} normalize={whole} onCommit={(v) => um(i, { count: v ?? m.count })} />
                  </td>
                  <td className="num">
                    <NumCell label="T" value={m.T} min={1} normalize={whole} onCommit={(v) => um(i, { T: v ?? m.T })} />
                  </td>
                  <td className="num">
                    <NumCell label="Sv" value={m.Sv} min={2} max={7} normalize={whole} onCommit={(v) => um(i, { Sv: v ?? m.Sv })} />
                  </td>
                  <td className="num">
                    <NumCell label={t("model.invAria")} value={m.InvSv} min={2} max={6} nullable normalize={whole} onCommit={(v) => um(i, { InvSv: v })} />
                  </td>
                  <td className="num">
                    <NumCell label="W" value={m.W} min={1} normalize={whole} onCommit={(v) => um(i, { W: v ?? m.W })} />
                  </td>
                  <td className="num">
                    <NumCell label={t("model.fnpAria")} value={m.fnp} min={2} max={6} nullable normalize={whole} onCommit={(v) => um(i, { fnp: v })} />
                  </td>
                  <td>
                    <input type="checkbox" aria-label={t("model.character")} checked={m.isCharacter} onChange={(e) => um(i, { isCharacter: e.target.checked })} />
                  </td>
                  <td>
                    <button type="button" className="sm ghost danger" aria-label={t("editor.removeModelAria", { name: m.name })} onClick={() => setModels(unit.models.filter((_, j) => j !== i))}>
                      ×
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <div className="row between">
          <h3>{t("editor.weapons")}</h3>
          <span className="row">
            <button type="button" className="sm" onClick={() => setWeapons([...unit.weapons, defaultWeapon("ranged")])}>
              {t("editor.addRanged")}
            </button>
            <button type="button" className="sm" onClick={() => setWeapons([...unit.weapons, defaultWeapon("melee")])}>
              {t("editor.addMelee")}
            </button>
          </span>
        </div>
        {/* Under 900px the CSS turns each row into a card; the data-label on every cell becomes its caption. */}
        <div className="table-wrap">
          <table className="data editor-table editor-weapons">
            <thead>
              <tr>
                <th>{t("weapon.on")}</th>
                <th>{t("weapon.name")}</th>
                <th className="num">#</th>
                <th>{t("weapon.kind")}</th>
                <th className="num">{t("weapon.range")}</th>
                <th className="num">A</th>
                <th className="num">{t("weapon.skill")}</th>
                <th className="num">S</th>
                <th className="num">AP</th>
                <th className="num">D</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {unit.weapons.map((w, i) => (
                <Fragment key={i}>
                <tr className="wpn-row">
                  <td className="cell-on" data-label={t("weapon.on")}>
                    <input type="checkbox" aria-label={t("weapon.enableAria", { name: w.name })} checked={w.enabled} onChange={(e) => uw(i, { enabled: e.target.checked })} />
                  </td>
                  <td className="cell-name" data-label={t("weapon.name")}>
                    <input type="text" aria-label={t("weapon.name")} value={w.name} onChange={(e) => uw(i, { name: e.target.value })} />
                  </td>
                  <td className="num" data-label="#">
                    <NumCell label={t("weapon.countAria", { name: w.name })} value={w.count} min={0} normalize={whole} onCommit={(v) => uw(i, { count: v ?? w.count })} />
                  </td>
                  <td data-label={t("weapon.kind")}>
                    <select aria-label={t("weapon.kind")} value={w.kind} onChange={(e) => uw(i, { kind: e.target.value as ScenarioWeapon["kind"], range: e.target.value === "melee" ? null : (w.range ?? 24) })}>
                      <option value="ranged">{t("weapon.ranged")}</option>
                      <option value="melee">{t("weapon.melee")}</option>
                    </select>
                  </td>
                  <td className="num" data-label={t("weapon.range")}>
                    <NumCell label={t("weapon.range")} value={w.range} min={0} nullable normalize={whole} disabled={w.kind === "melee"} onCommit={(v) => uw(i, { range: v })} />
                  </td>
                  <td className="num" data-label="A">
                    <TextCell label="A" className="dice" value={String(w.A)} validate={isDice} onCommit={(v) => uw(i, { A: v.trim().toUpperCase() })} />
                  </td>
                  <td className="num" data-label={t("weapon.skill")}>
                    <NumCell label={t("weapon.skillAria")} value={w.skill} min={2} max={6} nullable normalize={whole} onCommit={(v) => uw(i, { skill: v })} />
                  </td>
                  <td className="num" data-label="S">
                    <NumCell label="S" value={w.S} min={1} normalize={whole} onCommit={(v) => uw(i, { S: v ?? w.S })} />
                  </td>
                  <td className="num" data-label="AP">
                    <NumCell label="AP" value={w.AP} min={0} max={6} normalize={absWhole} onCommit={(v) => uw(i, { AP: v ?? w.AP })} />
                  </td>
                  <td className="num" data-label="D">
                    <TextCell label="D" className="dice" value={String(w.D)} validate={isDice} onCommit={(v) => uw(i, { D: v.trim().toUpperCase() })} />
                  </td>
                  <td className="cell-remove">
                    <button type="button" className="sm ghost danger" aria-label={t("editor.removeWeaponAria", { name: w.name })} onClick={() => setWeapons(unit.weapons.filter((_, j) => j !== i))}>
                      ×
                    </button>
                  </td>
                </tr>
                {/* Keywords are prose next to ten numbers. On their own line they are reachable
                    without scrolling the table sideways, and the suggestions have room to be read. */}
                <tr className="kw-row">
                  <td colSpan={11}>
                    <div className="kw-cell">
                      <span className="kw-cell-label">{t("weapon.keywords")}</span>
                      <KeywordField label={t("weapon.keywordsFor", { name: w.name })} value={keywordsToText(w.keywords)} suggestions={weaponKeywords} unknownLabel="editor.kw.unknownWeapon" onCommit={(v) => uw(i, { keywords: parseKeywordText(v) })} />
                    </div>
                  </td>
                </tr>
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
        <p className="small muted" style={{ marginTop: "0.4rem" }}>{t("editor.keywordHint")}</p>
      </div>
    </div>
  );
}
