import type { CoverageReport, ScenarioUnit, ScenarioWeapon } from "@grimstat/schema";
import { ap, dice, fmtInt, fmtRelative, skill } from "../../lib/format";
import { modelCount } from "../../lib/scenario";
import { hrefFor } from "../../router";
import { t } from "../../i18n";

/** "18A · 3+ · S4 AP-1 D1" — the 10px mono line under a weapon name in the context column. */
export function weaponStatline(w: ScenarioWeapon): string {
  const a = String(w.A).trim();
  const attacks = /^\d+$/.test(a) ? `${Number(a) * Math.max(1, w.count)}A` : w.count > 1 ? `${w.count}×${dice(a)}A` : `${dice(a)}A`;
  return `${attacks} · ${skill(w.skill)} · S${w.S} AP${ap(w.AP)} D${dice(w.D)}`;
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
/**
 * What the engine could and could not model for this scenario, in the space the pinned actions
 * leave under the unit cards. Coverage is a fact about the scenario rather than a result, and the
 * abilities it cannot model are the ones worth acting on, so each links to the override editor.
 */
function CoverageBlock({ coverage }: { coverage: CoverageReport }) {
  const total = coverage.tier1 + coverage.tier2 + coverage.tier3;
  if (!total) return null;
  const modelled = coverage.tier1 + coverage.tier2;
  const pct = (n: number) => (total ? `${(n / total) * 100}%` : "0%");
  return (
    <section className="calc-ctx-cov" aria-labelledby="calc-cov-h">
      <div className="calc-ctx-cov-head">
        <span className="t-eyebrow" id="calc-cov-h">
          {t("calc.coverage")}
        </span>
        <span className="calc-ctx-cov-count mono">{t("coverage.summary", { modelled, total })}</span>
      </div>
      <div className="calc-ctx-cov-bar" role="img" aria-label={t("coverage.aria", { t1: coverage.tier1, t2: coverage.tier2, t3: coverage.tier3 })}>
        <span className="t1" style={{ width: pct(coverage.tier1) }} />
        <span className="t2" style={{ width: pct(coverage.tier2) }} />
        <span className="t3" style={{ width: pct(coverage.tier3) }} />
      </div>
      {/* The same three words the Coverage widget uses; the tier numbers stay in the tooltips. */}
      <ul className="calc-ctx-cov-legend" aria-hidden="true">
        <li title={t("coverage.tier1.title")}>
          <span className="sw t1" />
          {t("coverage.tier1", { n: coverage.tier1 })}
        </li>
        <li title={t("coverage.tier2.title")}>
          <span className="sw t2" />
          {t("coverage.tier2", { n: coverage.tier2 })}
        </li>
        <li title={t("coverage.tier3.title")}>
          <span className="sw t3" />
          {t("coverage.tier3", { n: coverage.tier3 })}
        </li>
      </ul>
      {coverage.unmodelled.length ? (
        <>
          <div className="calc-ctx-cov-label t-micro">{t("calc.coverage.notModelled")}</div>
          <ul className="calc-ctx-cov-list">
            {coverage.unmodelled.map((u) => (
              <li key={u}>
                <span title={u}>{u}</span>
                <a href={`${hrefFor("data", "overrides")}?q=${encodeURIComponent(u)}`} title={t("calc.coverage.fixHint", { name: u })}>
                  {t("coverage.override")}
                </a>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="calc-ctx-cov-all">{t("calc.coverage.allModelled")}</p>
      )}
    </section>
  );
}

export function ScenarioCards({
  name,
  updatedAt,
  saved,
  attacker,
  defender,
  fightPhase,
  coverage,
  onRename,
  onEdit,
  onSwap,
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
  /** Undefined until the first solve returns. */
  coverage?: CoverageReport | undefined;
  onRename: (name: string) => void;
  onEdit: (side: "attacker" | "defender") => void;
  /** Attacker and defender trade places. */
  onSwap: () => void;
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
      <div className="calc-swap-row">
        <button type="button" className="calc-swap" onClick={onSwap} title={t("calc.swap.title")}>
          <span aria-hidden="true">⇅</span> {t("calc.swap")}
        </button>
      </div>
      <UnitCard unit={defender} side="defender" showWeapons={fightPhase} onEdit={() => onEdit("defender")} />
      {coverage ? <CoverageBlock coverage={coverage} /> : <div className="calc-ctx-filler" />}
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
