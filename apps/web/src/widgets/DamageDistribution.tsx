import { defineWidget, type WidgetProps } from "./registry";
import { BarChart } from "../components/charts/BarChart";
import { Empty } from "../components/ui";
import { fmt, pct } from "../lib/format";
import { t } from "../i18n";

function tailFrom(pmf: number[]): number[] {
  const out: number[] = new Array<number>(pmf.length).fill(0);
  let acc = 0;
  for (let k = pmf.length - 1; k >= 0; k--) {
    acc += pmf[k] ?? 0;
    out[k] = acc;
  }
  return out;
}

export function DamageDistribution({ result, running }: WidgetProps) {
  if (!result) return <Empty>{running ? t("results.running") : t("results.none")}</Empty>;
  const pmf = result.damagePMF;
  const tail = tailFrom(pmf);
  const p = result.damagePercentiles;
  return (
    <div className="widget-body chart" style={{ padding: 0 }}>
      <BarChart
        values={pmf}
        marker={result.expectedDamage}
        markerLabel={t("chart.mean", { v: fmt(result.expectedDamage) })}
        shade={{ from: p.p5, to: p.p95 }}
        xLabel={t("chart.damage")}
        yLabel={t("chart.probability")}
        ariaLabel={t("chart.damage.aria")}
        tooltip={(k) => [t("chart.damage.k", { k }), `P(X = ${k}) = ${pct(pmf[k] ?? 0, 2)}`, `P(X ≥ ${k}) = ${pct(tail[k] ?? 0, 2)}`]}
      />
      <div className="chart-legend" style={{ padding: "0 0.75rem 0.5rem" }}>
        <span>
          <span className="sw" style={{ background: "var(--chart-bar)" }} />
          {t("chart.legend.pmf")}
        </span>
        <span>
          <span className="sw" style={{ background: "var(--chart-shade)", border: "1px solid var(--brass)" }} />
          {t("chart.legend.p5p95", { a: p.p5, b: p.p95 })}
        </span>
        <span>
          <span className="sw" style={{ background: "var(--brass)" }} />
          {t("chart.legend.mean")}
        </span>
      </div>
    </div>
  );
}

export const damageDistributionWidget = defineWidget({
  id: "core.damage-distribution",
  title: t("widget.damage"),
  description: t("widget.damage.desc"),
  inputs: ["result"],
  defaultSize: { w: 7, h: 7 },
  render: DamageDistribution,
});
