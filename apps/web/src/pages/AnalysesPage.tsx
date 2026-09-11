import { useCallback, useEffect, useState, type ReactNode } from "react";
import { getSetting, setSetting } from "../db";
import { PageHeader } from "../components/shell";
import { AnalysisHeaderProvider, type AnalysisHeader } from "../components/analyses/shared";
import { MatrixTab } from "../components/analyses/MatrixTab";
import { DurabilityTab } from "../components/analyses/DurabilityTab";
import { EfficiencyTab } from "../components/analyses/EfficiencyTab";
import { TurnTab } from "../components/analyses/TurnTab";
import { ReverseTab } from "../components/analyses/ReverseTab";
import { t, type I18nKey } from "../i18n";

export type AnalysisTab = "matrix" | "heatmap" | "durability" | "efficiency" | "reverse" | "turn";
const TABS: AnalysisTab[] = ["matrix", "heatmap", "durability", "efficiency", "reverse", "turn"];

const TAB_LABEL: Record<AnalysisTab, I18nKey> = {
  matrix: "analyses.tab.matrix",
  heatmap: "analyses.tab.heatmap",
  durability: "analyses.tab.durability",
  efficiency: "analyses.tab.efficiency",
  reverse: "analyses.tab.reverse",
  turn: "analyses.tab.turn",
};
const TAB_TITLE: Record<AnalysisTab, I18nKey> = {
  matrix: "analyses.title.matrix",
  heatmap: "analyses.title.heatmap",
  durability: "analyses.title.durability",
  efficiency: "analyses.title.efficiency",
  reverse: "analyses.title.reverse",
  turn: "analyses.title.turn",
};

const TAB_KEY = "analyses.tab";

/**
 * The six analyses. Matrix and Heatmap are two readings of the same matrix run — the same grid, with
 * and without the per-cell numbers — so they share a component and only differ by `view`.
 */
export function AnalysesPage() {
  const [tab, setTab] = useState<AnalysisTab>("matrix");
  const [header, setHeader] = useState<AnalysisHeader>({});

  useEffect(() => {
    let alive = true;
    void getSetting<unknown>(TAB_KEY).then((v) => {
      const found = TABS.find((x) => x === v);
      if (alive && found) setTab(found);
    });
    return () => {
      alive = false;
    };
  }, []);

  const select = (next: AnalysisTab) => {
    setTab(next);
    setHeader({});
    void setSetting(TAB_KEY, next);
  };

  // Stable so a tab's publishing effect only re-runs on its own dependencies.
  const publish = useCallback((h: AnalysisHeader) => setHeader(h), []);

  let panel: ReactNode;
  switch (tab) {
    case "matrix":
    case "heatmap":
      // No `key`, so that switching between Matrix and Heatmap keeps the run instead of discarding it.
      panel = <MatrixTab view={tab === "heatmap" ? "swatches" : "values"} />;
      break;
    case "durability":
      panel = <DurabilityTab />;
      break;
    case "efficiency":
      panel = <EfficiencyTab />;
      break;
    case "reverse":
      panel = <ReverseTab />;
      break;
    case "turn":
      panel = <TurnTab />;
      break;
  }

  return (
    <>
      <PageHeader className="tabbed" title={t(TAB_TITLE[tab])} subtitle={header.subtitle ?? t("page.sub.analyses")} actions={header.actions}>
        <div className="tabbar" role="tablist" aria-label={t("analyses.tabs")}>
          {TABS.map((id) => (
            <button key={id} type="button" role="tab" id={`analysis-tab-${id}`} aria-selected={id === tab} aria-controls="analysis-panel" className={`tabbar-tab ${id === tab ? "on" : ""}`.trim()} onClick={() => select(id)}>
              {t(TAB_LABEL[id])}
            </button>
          ))}
        </div>
      </PageHeader>
      <div className="page-body analysis-body" role="tabpanel" id="analysis-panel" aria-labelledby={`analysis-tab-${tab}`}>
        <AnalysisHeaderProvider value={publish}>{panel}</AnalysisHeaderProvider>
      </div>
    </>
  );
}
