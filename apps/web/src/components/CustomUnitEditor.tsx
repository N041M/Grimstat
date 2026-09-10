import { useEffect, useRef, useState } from "react";
import type { ScenarioModel, ScenarioUnit, ScenarioWeapon } from "@grimstat/schema";
import { keywordsToText, parseKeywordText } from "../lib/keywordParser";
import { defaultModel, defaultWeapon } from "../lib/scenario";
import { num, numOrNull } from "./ui";
import { t } from "../i18n";

const DICE_RE = /^\s*(\d+)?[dD]?(3|6)?\s*([+-]\s*\d+)?\s*$/;
export const isDice = (s: string): boolean => s.trim().length > 0 && DICE_RE.test(s);
const normKeywords = (s: string) => keywordsToText(parseKeywordText(s));

/** Text input that keeps local text while typing and only commits valid values; resyncs when the prop changes elsewhere. */
function TextCell({ value, onCommit, validate, normalize, className, label }: { value: string; onCommit: (v: string) => void; validate?: (v: string) => boolean; normalize?: (v: string) => string; className?: string; label: string }) {
  const [text, setText] = useState(value);
  const last = useRef(value);
  useEffect(() => {
    const norm = normalize ?? ((v: string) => v);
    if (norm(value) !== norm(last.current)) {
      last.current = value;
      setText(value);
    }
  }, [value, normalize]);
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

export function CustomUnitEditor({ unit, onChange }: { unit: ScenarioUnit; onChange: (u: ScenarioUnit) => void }) {
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
          <TextCell label={t("unit.keywords")} value={unit.keywords.join(", ")} normalize={(s) => s.split(",").map((x) => x.trim().toUpperCase()).filter(Boolean).join(",")} onCommit={(v) => onChange({ ...unit, keywords: v.split(",").map((x) => x.trim().toUpperCase()).filter(Boolean) })} />
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
                    <input type="number" min={1} aria-label={t("model.count")} value={m.count} onChange={(e) => um(i, { count: Math.max(1, Math.floor(num(e.target.value, 1))) })} />
                  </td>
                  <td className="num">
                    <input type="number" min={1} aria-label="T" value={m.T} onChange={(e) => um(i, { T: num(e.target.value, m.T) })} />
                  </td>
                  <td className="num">
                    <input type="number" min={2} max={7} aria-label="Sv" value={m.Sv} onChange={(e) => um(i, { Sv: num(e.target.value, m.Sv) })} />
                  </td>
                  <td className="num">
                    <input type="number" min={2} max={6} aria-label={t("model.invAria")} value={m.InvSv ?? ""} onChange={(e) => um(i, { InvSv: numOrNull(e.target.value) })} />
                  </td>
                  <td className="num">
                    <input type="number" min={1} aria-label="W" value={m.W} onChange={(e) => um(i, { W: Math.max(1, Math.floor(num(e.target.value, m.W))) })} />
                  </td>
                  <td className="num">
                    <input type="number" min={2} max={6} aria-label={t("model.fnpAria")} value={m.fnp ?? ""} onChange={(e) => um(i, { fnp: numOrNull(e.target.value) })} />
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
        <div className="table-wrap">
          <table className="data editor-table">
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
                <th>{t("weapon.keywords")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {unit.weapons.map((w, i) => (
                <tr key={i}>
                  <td>
                    <input type="checkbox" aria-label={t("weapon.enableAria", { name: w.name })} checked={w.enabled} onChange={(e) => uw(i, { enabled: e.target.checked })} />
                  </td>
                  <td>
                    <input type="text" aria-label={t("weapon.name")} value={w.name} onChange={(e) => uw(i, { name: e.target.value })} />
                  </td>
                  <td className="num">
                    <input type="number" min={0} aria-label={t("weapon.countAria", { name: w.name })} value={w.count} onChange={(e) => uw(i, { count: Math.max(0, Math.floor(num(e.target.value, 0))) })} />
                  </td>
                  <td>
                    <select aria-label={t("weapon.kind")} value={w.kind} onChange={(e) => uw(i, { kind: e.target.value as ScenarioWeapon["kind"], range: e.target.value === "melee" ? null : (w.range ?? 24) })}>
                      <option value="ranged">{t("weapon.ranged")}</option>
                      <option value="melee">{t("weapon.melee")}</option>
                    </select>
                  </td>
                  <td className="num">
                    <input type="number" min={0} aria-label={t("weapon.range")} disabled={w.kind === "melee"} value={w.range ?? ""} onChange={(e) => uw(i, { range: numOrNull(e.target.value) })} />
                  </td>
                  <td className="num">
                    <TextCell label="A" className="dice" value={String(w.A)} validate={isDice} onCommit={(v) => uw(i, { A: v.trim().toUpperCase() })} />
                  </td>
                  <td className="num">
                    <input type="number" min={2} max={6} aria-label={t("weapon.skillAria")} value={w.skill ?? ""} onChange={(e) => uw(i, { skill: numOrNull(e.target.value) })} />
                  </td>
                  <td className="num">
                    <input type="number" min={1} aria-label="S" value={w.S} onChange={(e) => uw(i, { S: num(e.target.value, w.S) })} />
                  </td>
                  <td className="num">
                    <input type="number" min={0} max={6} aria-label="AP" value={w.AP} onChange={(e) => uw(i, { AP: Math.abs(num(e.target.value, w.AP)) })} />
                  </td>
                  <td className="num">
                    <TextCell label="D" className="dice" value={String(w.D)} validate={isDice} onCommit={(v) => uw(i, { D: v.trim().toUpperCase() })} />
                  </td>
                  <td>
                    <TextCell label={t("weapon.keywords")} value={keywordsToText(w.keywords)} normalize={normKeywords} onCommit={(v) => uw(i, { keywords: parseKeywordText(v) })} />
                  </td>
                  <td>
                    <button type="button" className="sm ghost danger" aria-label={t("editor.removeWeaponAria", { name: w.name })} onClick={() => setWeapons(unit.weapons.filter((_, j) => j !== i))}>
                      ×
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="small muted" style={{ marginTop: "0.4rem" }}>{t("editor.keywordHint")}</p>
      </div>
    </div>
  );
}
