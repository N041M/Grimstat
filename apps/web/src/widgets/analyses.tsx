import { defineWidget, type WidgetProps } from "./registry";
import { Heatmap } from "../components/analyses/Heatmap";
import { DurabilityCharts, DurabilityTable } from "../components/analyses/DurabilityTab";
import { EfficiencyChart, EfficiencyTable } from "../components/analyses/EfficiencyTab";
import { TurnPlanTable, TurnSlainChart, TurnTargetCards, TurnTotals } from "../components/analyses/TurnTab";
import { Empty } from "../components/ui";
import { t } from "../i18n";

/**
 * Army-level analysis views as dashboard widgets. Each one `requires` an `analyses.<key>` input, so
 * they stay hidden on the calculator dashboard until it provides that analysis.
 */

function MatrixHeatmap({ analyses }: WidgetProps) {
  const m = analyses?.matrix;
  if (!m) return <Empty>{t("results.none")}</Empty>;
  return <Heatmap matrix={m.matrix} metric={m.metric} attackerPoints={m.attackerPoints} defenderPoints={m.defenderPoints} onSelect={m.onSelect} />;
}

function DurabilityChartsWidget({ analyses }: WidgetProps) {
  const d = analyses?.durability;
  return d ? <DurabilityCharts entries={d.entries} /> : <Empty>{t("results.none")}</Empty>;
}

function DurabilityTableWidget({ analyses }: WidgetProps) {
  const d = analyses?.durability;
  return d ? <DurabilityTable entries={d.entries} /> : <Empty>{t("results.none")}</Empty>;
}

function EfficiencyTableWidget({ analyses }: WidgetProps) {
  const e = analyses?.efficiency;
  return e ? <EfficiencyTable rows={e.rows} /> : <Empty>{t("results.none")}</Empty>;
}

function EfficiencyChartWidget({ analyses }: WidgetProps) {
  const e = analyses?.efficiency;
  return e ? <EfficiencyChart rows={e.rows} /> : <Empty>{t("results.none")}</Empty>;
}

function TurnPlanWidget({ analyses }: WidgetProps) {
  const x = analyses?.turn;
  return x ? <TurnPlanTable result={x.result} view={x.view} /> : <Empty>{t("results.none")}</Empty>;
}

function TurnTargetsWidget({ analyses }: WidgetProps) {
  const x = analyses?.turn;
  if (!x) return <Empty>{t("results.none")}</Empty>;
  return (
    <div className="stack">
      <TurnTotals result={x.result} />
      <TurnTargetCards result={x.result} view={x.view} />
    </div>
  );
}

function TurnSlainWidget({ analyses }: WidgetProps) {
  const x = analyses?.turn;
  return x ? <TurnSlainChart result={x.result} /> : <Empty>{t("results.none")}</Empty>;
}

export const matrixHeatmapWidget = defineWidget({ id: "analysis.matrix-heatmap", title: t("widget.matrix"), description: t("widget.matrix.desc"), inputs: ["snapshot"], defaultSize: { w: 12, h: 8 }, render: MatrixHeatmap, requires: "analyses.matrix" });
export const durabilityChartsWidget = defineWidget({ id: "analysis.durability-charts", title: t("widget.durabilityCharts"), description: t("widget.durabilityCharts.desc"), inputs: ["snapshot"], defaultSize: { w: 8, h: 7 }, render: DurabilityChartsWidget, requires: "analyses.durability" });
export const durabilityTableWidget = defineWidget({ id: "analysis.durability-table", title: t("widget.durabilityTable"), description: t("widget.durabilityTable.desc"), inputs: ["snapshot"], defaultSize: { w: 4, h: 7 }, render: DurabilityTableWidget, requires: "analyses.durability" });
export const efficiencyTableWidget = defineWidget({ id: "analysis.efficiency-table", title: t("widget.efficiencyTable"), description: t("widget.efficiencyTable.desc"), inputs: ["snapshot"], defaultSize: { w: 7, h: 8 }, render: EfficiencyTableWidget, requires: "analyses.efficiency" });
export const efficiencyChartWidget = defineWidget({ id: "analysis.efficiency-chart", title: t("widget.efficiencyChart"), description: t("widget.efficiencyChart.desc"), inputs: ["snapshot"], defaultSize: { w: 5, h: 8 }, render: EfficiencyChartWidget, requires: "analyses.efficiency" });
export const turnPlanWidget = defineWidget({ id: "analysis.turn-plan", title: t("widget.turnPlan"), description: t("widget.turnPlan.desc"), inputs: ["snapshot"], defaultSize: { w: 7, h: 8 }, render: TurnPlanWidget, requires: "analyses.turn" });
export const turnTargetsWidget = defineWidget({ id: "analysis.turn-targets", title: t("widget.turnTargets"), description: t("widget.turnTargets.desc"), inputs: ["snapshot"], defaultSize: { w: 5, h: 8 }, render: TurnTargetsWidget, requires: "analyses.turn" });
export const turnSlainWidget = defineWidget({ id: "analysis.turn-slain", title: t("widget.turnSlain"), description: t("widget.turnSlain.desc"), inputs: ["snapshot"], defaultSize: { w: 6, h: 7 }, render: TurnSlainWidget, requires: "analyses.turn" });

export const analysisWidgets = [matrixHeatmapWidget, durabilityChartsWidget, durabilityTableWidget, efficiencyTableWidget, efficiencyChartWidget, turnPlanWidget, turnTargetsWidget, turnSlainWidget];
