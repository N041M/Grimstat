import type { ScenarioUnit, ScenarioWeapon } from "@grimstat/schema";
import { dice, fmtInt, fmtRelative, skill } from "../../lib/format";
import { modelCount } from "../../lib/scenario";
import { t } from "../../i18n";

/** "18A · 3+ · S4 AP1 D1" — the 10px mono line under a weapon name in the context column. */
export function weaponStatline(w: ScenarioWeapon): string {
  const a = String(w.A).trim();
  const attacks = /^\d+$/.test(a) ? `${Number(a) * Math.max(1, w.count)}A` : w.count > 1 ? `${w.count}×${dice(a)}A` : `${dice(a)}A`;
  return `${attacks} · ${skill(w.skill)} · S${w.S} AP${w.AP} D${dice(w.D)}`;
}

/** The model line that carries the unit's defensive profile: the one most models share. */
function bulkModel(unit: ScenarioUnit) {
  return unit.models.reduce<ScenarioUnit["models"][number] | undefined>((best, m) => (!best || m.count > best.count ? m : best), undefined);
}

function UnitCard({ unit, side, showWeapons, onEdit }: { unit: ScenarioUnit; side: "attacker" | "defender"; showWeapons: boolean; onEdit: () => void }) {
  const weapons = unit.weapons.filter((w) => w.enabled && w.count > 0);
  const model = bulkModel(unit);
  const models = modelCount(unit);
  const wounds = unit.models.reduce((s, m) => s + m.count * m.W, 0);
  return (
    <div className="calc-side">
      <div className="calc-side-head">
        <span className={`calc-side-role ${side}`}>{t(side === "attacker" ? "side.attacker" : "side.defender")}</span>
        <span className="calc-side-pts">{unit.points === undefined ? "" : t("ctxcol.pts", { n: fmtInt(unit.points) })}</span>
      </div>
      <div className="unit-card">
        <div className="unit-card-head">
          <span className="unit-card-name" title={unit.name}>
            {unit.name}
          </span>
          <button type="button" className="unit-card-edit" onClick={onEdit} title={t(side === "attacker" ? "calc.editAttacker" : "calc.editDefender")}>
            {t("calc.edit")}
          </button>
        </div>
        {side === "defender" && model ? (
          <div className="unit-stats">
            {[
              { k: "T", v: String(model.T) },
              { k: "SV", v: `${model.Sv}+` },
              { k: "W", v: String(model.W) },
              { k: "INV", v: model.InvSv ? `${model.InvSv}++` : "–" },
            ].map((s) => (
              <div className="unit-stat" key={s.k}>
                <div className="unit-stat-k">{s.k}</div>
                <div className="unit-stat-v">{s.v}</div>
              </div>
            ))}
          </div>
        ) : null}
        {side === "defender" ? <div className="unit-card-meta">{t("calc.modelsWounds", { models: fmtInt(models), wounds: fmtInt(wounds) })}</div> : null}
        {showWeapons
          ? weapons.map((w, i) => (
              <div className="unit-wpn" key={`${w.name}#${i}`}>
                <span className="unit-wpn-name">{w.count > 1 ? t("calc.weaponName", { name: w.name, n: w.count }) : w.name}</span>
                <span className="unit-wpn-line">{weaponStatline(w)}</span>
              </div>
            ))
          : null}
        {showWeapons && weapons.length === 0 ? <div className="unit-card-meta">{t("calc.noWeapons")}</div> : null}
      </div>
    </div>
  );
}

/**
 * The Calculator's context column: the scenario's name and saved state, the attacker and defender
 * cards (each with an edit affordance that opens the unit picker), and the Save / Share pair pinned
 * to the bottom of the column.
 */
export function ScenarioCards({
  name,
  updatedAt,
  saved,
  attacker,
  defender,
  fightPhase,
  onRename,
  onEdit,
  onSave,
  onShare,
  onNew,
}: {
  name: string;
  updatedAt: string;
  /** undefined while the lookup is in flight. */
  saved: boolean | undefined;
  attacker: ScenarioUnit;
  defender: ScenarioUnit;
  /** In the fight phase the defender's own weapons matter, so the card lists them too. */
  fightPhase: boolean;
  onRename: (name: string) => void;
  onEdit: (side: "attacker" | "defender") => void;
  onSave: () => void;
  onShare: () => void;
  onNew: () => void;
}) {
  const status = saved === undefined ? fmtRelative(updatedAt) : t("calc.status", { rel: fmtRelative(updatedAt), state: saved ? t("calc.saved") : t("calc.unsaved") });
  return (
    <div className="calc-ctx">
      <div className="calc-ctx-lede">
        <input className="calc-ctx-name" type="text" value={name} aria-label={t("scenario.name")} onChange={(e) => onRename(e.target.value)} />
        <button type="button" className="calc-ctx-new" onClick={onNew} title={t("scenario.newScenario")} aria-label={t("scenario.newScenario")}>
          +
        </button>
        <div className="calc-ctx-status">{status}</div>
      </div>
      <UnitCard unit={attacker} side="attacker" showWeapons onEdit={() => onEdit("attacker")} />
      <UnitCard unit={defender} side="defender" showWeapons={fightPhase} onEdit={() => onEdit("defender")} />
      <div className="calc-ctx-actions">
        <button type="button" className="btn-primary" onClick={onSave}>
          {t("calc.save")}
        </button>
        <button type="button" className="btn-outline" onClick={onShare}>
          {t("calc.share")}
        </button>
      </div>
    </div>
  );
}
