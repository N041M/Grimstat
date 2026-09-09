import type { ComponentType } from "react";
import type { PluginHost, WidgetDef } from "@grimstat/plugin-host";
import type { Scenario, SimResult, Snapshot } from "@grimstat/schema";

/** Inputs every dashboard widget receives. */
export interface WidgetProps {
  scenario: Scenario;
  result: SimResult | undefined;
  snapshot: Snapshot | undefined;
  running: boolean;
  error: string | undefined;
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
