import type { ScenarioUnit } from "@grimstat/schema";
import { defineWidget, type WidgetProps } from "./registry";
import { ap, dice, fmtInt, skill } from "../lib/format";
import { keywordsToText } from "../lib/keywordParser";
import { t } from "../i18n";

function UnitCard({ unit, title }: { unit: ScenarioUnit; title: string }) {
  return (
    <div className="stack">
      <div className="row between">
        <h3>
          <span className="muted small">{title} · </span>
          {unit.name}
        </h3>
        {unit.points !== undefined ? <span className="badge accent">{t("unit.points", { v: fmtInt(unit.points) })}</span> : null}
      </div>
      {unit.keywords.length ? (
        <div className="chips" aria-label={t("unit.keywords")}>
          {unit.keywords.map((k) => (
            <span key={k} className="chip">
              {k}
            </span>
          ))}
        </div>
      ) : null}
      {unit.models.length ? (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>{t("model.name")}</th>
                <th className="num">#</th>
                <th className="num">T</th>
                <th className="num">Sv</th>
                <th className="num">Inv</th>
                <th className="num">W</th>
                <th className="num">FNP</th>
              </tr>
            </thead>
            <tbody>
              {unit.models.map((m, i) => (
                <tr key={i}>
                  <td>
                    {m.name}
                    {m.isCharacter ? <span className="badge" style={{ marginLeft: 6 }}>{t("model.character")}</span> : null}
                  </td>
                  <td className="num">{m.count}</td>
                  <td className="num">{m.T}</td>
                  <td className="num">{m.Sv}+</td>
                  <td className="num">{m.InvSv ? `${m.InvSv}++` : "–"}</td>
                  <td className="num">{m.W}</td>
                  <td className="num">{m.fnp ? `${m.fnp}+` : "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="muted small">{t("unit.noModels")}</p>
      )}
      {unit.weapons.length ? (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>{t("weapon.name")}</th>
                <th className="num">#</th>
                <th>{t("weapon.range")}</th>
                <th className="num">A</th>
                <th className="num">{t("weapon.skill")}</th>
                <th className="num">S</th>
                <th className="num">AP</th>
                <th className="num">D</th>
                <th>{t("weapon.keywords")}</th>
              </tr>
            </thead>
            <tbody>
              {unit.weapons.map((w, i) => (
                <tr key={i} style={w.enabled ? undefined : { opacity: 0.5 }}>
                  <td>{w.name}</td>
                  <td className="num">{w.count}</td>
                  <td>{w.kind === "melee" ? t("weapon.melee") : w.range ? `${w.range}"` : "–"}</td>
                  <td className="num">{dice(w.A)}</td>
                  <td className="num">{skill(w.skill)}</td>
                  <td className="num">{w.S}</td>
                  <td className="num">{ap(w.AP)}</td>
                  <td className="num">{dice(w.D)}</td>
                  <td className="small">{keywordsToText(w.keywords)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

export function UnitCards({ scenario }: WidgetProps) {
  return (
    <div className="stack">
      <UnitCard unit={scenario.attacker} title={t("side.attacker")} />
      <hr style={{ border: 0, borderTop: "1px solid var(--border)" }} />
      <UnitCard unit={scenario.defender} title={t("side.defender")} />
    </div>
  );
}

export const unitCardsWidget = defineWidget({
  id: "core.unit-cards",
  title: t("widget.units"),
  description: t("widget.units.desc"),
  inputs: ["scenario"],
  defaultSize: { w: 5, h: 9 },
  render: UnitCards,
});
