import type { ScenarioWeapon } from "@grimstat/schema";
import { ap, dice, skill } from "../lib/format";
import { keywordsToText } from "../lib/keywordParser";
import { num } from "./ui";
import { t } from "../i18n";

/** Enable checkbox + count per weapon for units that came from data or an archetype. */
export function WeaponRows({ weapons, onChange }: { weapons: ScenarioWeapon[]; onChange: (w: ScenarioWeapon[]) => void }) {
  if (!weapons.length) return <p className="muted small">{t("unit.noWeapons")}</p>;
  const update = (i: number, patch: Partial<ScenarioWeapon>) => onChange(weapons.map((w, j) => (j === i ? { ...w, ...patch } : w)));
  return (
    <div className="table-wrap">
      <table className="data">
        <thead>
          <tr>
            <th>{t("weapon.on")}</th>
            <th>{t("weapon.name")}</th>
            <th className="num">#</th>
            <th>{t("weapon.profile")}</th>
            <th>{t("weapon.keywords")}</th>
          </tr>
        </thead>
        <tbody>
          {weapons.map((w, i) => (
            <tr key={i} style={w.enabled ? undefined : { opacity: 0.6 }}>
              <td>
                <input type="checkbox" aria-label={t("weapon.enableAria", { name: w.name })} checked={w.enabled} onChange={(e) => update(i, { enabled: e.target.checked })} />
              </td>
              <td>{w.name}</td>
              <td className="num">
                <input type="number" min={0} aria-label={t("weapon.countAria", { name: w.name })} value={w.count} onChange={(e) => update(i, { count: Math.max(0, Math.floor(num(e.target.value, 0))) })} />
              </td>
              <td className="mono small">
                {w.kind === "melee" ? t("weapon.melee") : `${w.range ?? "–"}"`} · A{dice(w.A)} {skill(w.skill)} S{w.S} AP{ap(w.AP)} D{dice(w.D)}
              </td>
              <td className="small">{keywordsToText(w.keywords)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
