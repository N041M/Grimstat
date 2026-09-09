import { defineWidget, type WidgetProps } from "./registry";
import { BarChart } from "../components/charts/BarChart";
import { Empty } from "../components/ui";
import { fmt, pct } from "../lib/format";
import { t } from "../i18n";

export function ModelsSlain({ result, running }: WidgetProps) {
  if (!result) return <Empty>{running ? t("results.running") : t("results.none")}</Empty>;
  const pmf = result.slainPMF;
  const atLeast = result.pAtLeastSlain;
  return (
    <div className="widget-body chart" style={{ padding: 0 }}>
      <BarChart
        values={pmf}
        stepLine={atLeast}
        marker={result.expectedSlain}
        markerLabel={t("chart.mean", { v: fmt(result.expectedSlain) })}
        maxIndex={Math.max(1, pmf.length - 1)}
        xLabel={t("chart.slain")}
        yLabel={t("chart.probability")}
        ariaLabel={t("chart.slain.aria")}
        tooltip={(k) => [t("chart.slain.k", { k }), `P(X = ${k}) = ${pct(pmf[k] ?? 0, 2)}`, `P(X ≥ ${k}) = ${pct(atLeast[k] ?? 0, 2)}`]}
      />
      <div className="chart-legend" style={{ padding: "0 0.75rem 0.5rem" }}>
        <span>
          <span className="sw" style={{ background: "var(--chart-bar)" }} />
          {t("chart.legend.slainPmf")}
        </span>
        <span>
          <span className="sw" style={{ borderTop: "2px dashed var(--chart-line)", height: 0, background: "none" }} />
          {t("chart.legend.atLeast")}
        </span>
      </div>
    </div>
  );
}

export const modelsSlainWidget = defineWidget({
  id: "core.models-slain",
  title: t("widget.slain"),
  description: t("widget.slain.desc"),
  inputs: ["result"],
  defaultSize: { w: 5, h: 7 },
  render: ModelsSlain,
});
