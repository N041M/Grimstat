import { defineWidget, type WidgetProps } from "./registry";
import { PanelHead, ProportionBar } from "../components/kit";
import { Empty } from "../components/ui";
import { fmt, pct } from "../lib/format";
import { t } from "../i18n";

/**
 * Where the damage came from: rows of `1fr | 56px | 40px` (weapon name, 6px bar, contribution),
 * bars scaled against the biggest contributor. The full per-stage breakdown stays in the
 * "Weapon breakdown" widget below.
 */
export function DamageByWeapon({ result, running }: WidgetProps) {
  if (!result || !result.weapons.length)
    return (
      <div className="w-pad">
        <PanelHead title={t("widget.byWeapon")} />
        <Empty>{!result ? (running ? t("results.running") : t("results.none")) : t("weapons.none")}</Empty>
      </div>
    );
  const rows = [...result.weapons].sort((a, b) => b.expectedDamage - a.expectedDamage);
  const peak = rows.reduce((m, w) => Math.max(m, w.expectedDamage), 0);
  const total = rows.reduce((s, w) => s + w.expectedDamage, 0);
  return (
    <div className="w-pad byw">
      <PanelHead title={t("widget.byWeapon")} />
      <div className="byw-rows">
        {rows.map((w, i) => (
          <div className="byw-row" key={`${w.name}#${i}`} title={t("byWeapon.rowTitle", { name: w.name, v: fmt(w.expectedDamage), share: pct(total > 0 ? w.expectedDamage / total : 0, 0) })}>
            <span className="byw-name">{w.count > 1 ? t("byWeapon.name", { name: w.name, n: w.count }) : w.name}</span>
            <ProportionBar value={peak > 0 ? w.expectedDamage / peak : 0} height={6} />
            <span className="byw-v">{fmt(w.expectedDamage, 1)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export const damageByWeaponWidget = defineWidget({
  id: "core.damage-by-weapon",
  title: t("widget.byWeapon"),
  description: t("widget.byWeapon.desc"),
  inputs: ["result"],
  defaultSize: { w: 6, h: 6 },
  minSize: { w: 4, h: 4 },
  render: DamageByWeapon,
});
