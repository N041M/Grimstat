import { useState } from "react";
import { defineWidget, type WidgetProps } from "./registry";
import { PanelHead } from "../components/kit";
import { Empty } from "../components/ui";
import { useHover } from "../components/charts/HoverLayer";
import { axisTick, cumulativeBars, damageBars } from "../lib/distribution";
import { fmtInt, pct } from "../lib/format";
import { t } from "../i18n";

type View = "density" | "cumulative";

/**
 * One bar per integer damage value. The outcome is integer-valued, so discrete bars are the honest
 * encoding — deliberately not smoothed into a curve. Bars inside the interquartile range are `--ink`,
 * the tails `--dim`.
 *
 * Two readings of the same numbers: how likely each result is, and the chance of at least that much
 * damage. The second is the question a player actually asks, and no eye can take it off the first.
 */
export function DamageDistribution({ result, running }: WidgetProps) {
  const [view, setView] = useState<View>("density");
  const hover = useHover();
  if (!result)
    return (
      <div className="w-pad">
        <PanelHead title={t("widget.damage")} />
        <Empty>{running ? t("results.running") : t("results.none")}</Empty>
      </div>
    );
  const p = result.damagePercentiles;
  const density = damageBars(result.damagePMF, p);
  const bars = view === "cumulative" ? cumulativeBars(result.damagePMF, p) : density;
  const peak = density.reduce((m, b) => Math.max(m, b.p), 0);
  // The tallest bar carries the scale, so a probability can be read off the plot without hovering.
  const scale = view === "cumulative" ? 1 : peak;
  return (
    <div className="dist">
      <PanelHead
        title={t("widget.damage")}
        aside={
          <div className="dist-head-aside">
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
            <div className="seg" role="group" aria-label={t("dist.view")}>
              {(["density", "cumulative"] as const).map((v) => (
                <button key={v} type="button" className={`seg-btn ${view === v ? "on" : ""}`.trim()} aria-pressed={view === v} onClick={() => setView(v)}>
                  {t(v === "density" ? "dist.view.density" : "dist.view.cumulative")}
                </button>
              ))}
            </div>
          </div>
        }
      />
      <div className="dist-scale mono" aria-hidden="true">
        {pct(scale, scale < 0.1 ? 1 : 0)}
      </div>
      <div className="dist-plot" role="img" aria-label={t(view === "cumulative" ? "dist.ariaCumulative" : "dist.aria", { mean: result.expectedDamage.toFixed(1), p25: fmtInt(p.p25), p75: fmtInt(p.p75) })}>
        {bars.map((b, i) => (
          <div
            key={b.value}
            className="dist-col"
            tabIndex={-1}
            {...hover.bind({
              title: t("dist.hoverTitle", { n: b.value }),
              rows: [
                { label: t("dist.hoverExactly"), value: pct(density[i]?.p ?? 0, 1) },
                { label: t("dist.hoverAtLeast"), value: pct(cumulativeAt(result.damagePMF, b.value), 1) },
              ],
              ...(b.inIqr ? { note: t("dist.hoverIqr") } : {}),
            })}
          >
            <div className={`dist-bar ${b.inIqr ? "in" : "out"}`} style={{ height: `${Math.max((b.p / (scale || 1)) * 100, b.p > 0 ? 1 : 0)}%` }} />
          </div>
        ))}
      </div>
      <div className="dist-axis" aria-hidden="true">
        {bars.map((b) => (
          <span key={b.value}>{axisTick(b.value)}</span>
        ))}
      </div>
      {hover.layer}
    </div>
  );
}

/** P(damage >= value), read straight off the mass function. */
function cumulativeAt(pmf: readonly number[], value: number): number {
  let s = 0;
  for (let i = value; i < pmf.length; i++) s += pmf[i] ?? 0;
  return s;
}

export const damageDistributionWidget = defineWidget({
  id: "core.damage-distribution",
  title: t("widget.damage"),
  description: t("widget.damage.desc"),
  inputs: ["result"],
  defaultSize: { w: 12, h: 8 },
  minSize: { w: 6, h: 6 },
  render: DamageDistribution,
});
