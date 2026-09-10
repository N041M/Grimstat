import type { PluginModule, WidgetDef } from "@grimstat/plugin-host";
import { PLUGIN_API_VERSION } from "@grimstat/schema";
import { summaryTilesWidget } from "./SummaryTiles";
import { damageDistributionWidget } from "./DamageDistribution";
import { modelsSlainWidget } from "./ModelsSlain";
import { weaponBreakdownWidget } from "./WeaponBreakdown";
import { unitCardsWidget } from "./UnitCards";
import { coverageMeterWidget } from "./CoverageMeter";
import { whatIfWidget } from "./WhatIf";
import { warningsWidget } from "./Warnings";
import { analysisWidgets } from "./analyses";
import type { ReactWidgetDef } from "./registry";

/** Built-in widgets, in default dashboard order. Analysis widgets only show where their `requires` input is provided. */
export const coreWidgets: ReactWidgetDef[] = [summaryTilesWidget, damageDistributionWidget, modelsSlainWidget, weaponBreakdownWidget, whatIfWidget, unitCardsWidget, coverageMeterWidget, warningsWidget, ...analysisWidgets];

/** The built-ins are themselves a plugin so third-party widget packs use the same door. */
export const coreWidgetsPlugin: PluginModule = {
  manifest: {
    id: "widgets-core",
    name: "Grimstat core widgets",
    version: "0.1.0",
    apiVersion: PLUGIN_API_VERSION,
    kind: "widgets",
    entry: "apps/web/src/widgets",
    trusted: true,
  },
  activate(ctx) {
    for (const w of coreWidgets) ctx.registerWidget(w as WidgetDef);
  },
};
