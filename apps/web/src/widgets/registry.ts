import type { ComponentType } from "react";
import type { PluginHost, WidgetDef } from "@grimstat/plugin-host";
import type { Scenario, SimResult, Snapshot } from "@grimstat/schema";
import type { DurabilityEntry, EfficiencyRow, MatrixResult } from "@grimstat/game-40k-11e";
import type { MatrixMetric } from "../lib/heatmap";
import type { TurnPlanResult } from "../lib/turn";
import type { TurnPlanView } from "../components/analyses/TurnTab";

/** Army-level analysis results a dashboard may provide; each key unlocks the widgets that `require` it. */
export interface AnalysisInputs {
  matrix?: { matrix: MatrixResult; metric: MatrixMetric; attackerPoints?: Array<number | undefined>; defenderPoints?: Array<number | undefined>; onSelect?: (attackerIndex: number, defenderIndex: number) => void };
  durability?: { entries: DurabilityEntry[] };
  efficiency?: { rows: EfficiencyRow[] };
  turn?: { result: TurnPlanResult; view: TurnPlanView };
}

/** Inputs every dashboard widget receives. */
export interface WidgetProps {
  scenario: Scenario;
  result: SimResult | undefined;
  snapshot: Snapshot | undefined;
  running: boolean;
  error: string | undefined;
  /** Present only on dashboards that host army-level analyses. */
  analyses?: AnalysisInputs;
}

export type WidgetComponent = ComponentType<WidgetProps>;

/** A plugin-host WidgetDef whose opaque `render` token is a React component. */
export type ReactWidgetDef = WidgetDef<WidgetComponent>;

export function defineWidget(def: ReactWidgetDef): ReactWidgetDef {
  return def;
}

function isReactWidget(def: WidgetDef): def is ReactWidgetDef {
  const r = def.render as unknown;
  return typeof r === "function" || (typeof r === "object" && r !== null);
}

/** Every registered widget whose render token is a React component, in registration order. */
export function widgetsFrom(host: PluginHost): ReactWidgetDef[] {
  return [...host.registries.widgets.values()].filter(isReactWidget);
}

/** Analysis widgets declare `requires: "analyses.<key>"`; they only show on dashboards providing that input. */
export function widgetAvailable(def: ReactWidgetDef, analyses: AnalysisInputs | undefined): boolean {
  if (!def.requires) return true;
  const [ns, key] = def.requires.split(".");
  if (ns !== "analyses" || !key) return true;
  return !!analyses?.[key as keyof AnalysisInputs];
}

/** Stable key describing which analysis inputs are present (for memoising the widget list). */
export function analysisKeys(analyses: AnalysisInputs | undefined): string {
  return analyses ? (Object.keys(analyses) as Array<keyof AnalysisInputs>).filter((k) => !!analyses[k]).sort().join(",") : "";
}
