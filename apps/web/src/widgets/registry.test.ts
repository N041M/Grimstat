import { describe, expect, it } from "vitest";
import { analysisKeys, widgetAvailable, type AnalysisInputs, type ReactWidgetDef } from "./registry";

const def = (requires?: string): ReactWidgetDef => ({ id: "x", title: "x", inputs: ["result"], defaultSize: { w: 1, h: 1 }, render: () => null, ...(requires ? { requires } : {}) });

describe("analysis widget gating", () => {
  it("shows plain widgets everywhere and analysis widgets only when their input is provided", () => {
    const analyses = { efficiency: { rows: [] } } as AnalysisInputs;
    expect(widgetAvailable(def(), undefined)).toBe(true);
    expect(widgetAvailable(def("analyses.matrix"), undefined)).toBe(false);
    expect(widgetAvailable(def("analyses.matrix"), analyses)).toBe(false);
    expect(widgetAvailable(def("analyses.efficiency"), analyses)).toBe(true);
    expect(widgetAvailable(def("something-else"), undefined)).toBe(true);
  });

  it("derives a stable key from the provided inputs", () => {
    expect(analysisKeys(undefined)).toBe("");
    expect(analysisKeys({ turn: undefined, efficiency: { rows: [] }, durability: { entries: [] } } as AnalysisInputs)).toBe("durability,efficiency");
  });
});
