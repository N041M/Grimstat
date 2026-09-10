import { defineWidget, type WidgetProps } from "./registry";
import { PanelHead } from "../components/kit";
import { Empty } from "../components/ui";
import { axisTick, damageBars } from "../lib/distribution";
import { fmtInt, pct } from "../lib/format";
import { t } from "../i18n";

/**
 * One bar per integer damage value. The outcome is integer-valued, so discrete bars are the honest
 * encoding — deliberately not smoothed into a curve. Bars inside the interquartile range are `--ink`,
 * the tails `--dim`; every bar carries a `title` with its exact probability.
 */
export function DamageDistribution({ result, running }: WidgetProps) {
  if (!result)
    return (
      <div className="w-pad">
        <PanelHead title={t("widget.damage")} />
        <Empty>{running ? t("results.running") : t("results.none")}</Empty>
      </div>
    );
  const p = result.damagePercentiles;
  const bars = damageBars(result.damagePMF, p);
  return (
    <div className="dist">
      <PanelHead
        title={t("widget.damage")}
        aside={
          <div className="legend">
            <span className="legend-item">
              <span className="legend-sw ink" aria-hidden="true" />
              {t("dist.legend.iqr")}
            </span>
            <span className="legend-item">
              <span className="legend-sw dim" aria-hidden="true" />
              {t("dist.legend.tail")}
            </span>
            <span className="legend-item">
              <span className="legend-rule" aria-hidden="true" />
              {t("dist.legend.median", { v: fmtInt(p.p50) })}
            </span>
          </div>
        }
      />
      <div className="dist-plot" role="img" aria-label={t("dist.aria", { mean: result.expectedDamage.toFixed(1), p25: fmtInt(p.p25), p75: fmtInt(p.p75) })}>
        {bars.map((b) => (
          <div key={b.value} className="dist-col" title={t("dist.barTitle", { n: b.value, p: pct(b.p, 1) })}>
            <div className={`dist-bar ${b.inIqr ? "in" : "out"}`} style={{ height: `${Math.max(b.height * 100, b.p > 0 ? 1 : 0)}%` }} />
          </div>
        ))}
      </div>
      <div className="dist-axis" aria-hidden="true">
        {bars.map((b) => (
          <span key={b.value}>{axisTick(b.value)}</span>
        ))}
      </div>
    </div>
  );
}

export const damageDistributionWidget = defineWidget({
  id: "core.damage-distribution",
  title: t("widget.damage"),
  description: t("widget.damage.desc"),
  inputs: ["result"],
  defaultSize: { w: 12, h: 8 },
  render: DamageDistribution,
});
