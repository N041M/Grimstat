import { useEffect, useState } from "react";
import { getSetting, setSetting } from "../db";
import { Tabs } from "../components/ui";
import { MatrixTab } from "../components/analyses/MatrixTab";
import { DurabilityTab } from "../components/analyses/DurabilityTab";
import { EfficiencyTab } from "../components/analyses/EfficiencyTab";
import { TurnTab } from "../components/analyses/TurnTab";
import { ReverseTab } from "../components/analyses/ReverseTab";
import { t } from "../i18n";

export type AnalysisTab = "matrix" | "durability" | "efficiency" | "turn" | "reverse";
const TABS: AnalysisTab[] = ["matrix", "durability", "efficiency", "turn", "reverse"];

function tabLabel(tab: AnalysisTab): string {
  switch (tab) {
    case "matrix":
      return t("analyses.tab.matrix");
    case "durability":
      return t("analyses.tab.durability");
    case "efficiency":
      return t("analyses.tab.efficiency");
    case "turn":
      return t("analyses.tab.turn");
    case "reverse":
      return t("analyses.tab.reverse");
  }
}
const TAB_KEY = "analyses.tab";

export function AnalysesPage() {
  const [tab, setTab] = useState<AnalysisTab>("matrix");
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
    void setSetting(TAB_KEY, next);
  };

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>{t("analyses.title")}</h1>
          <p>{t("analyses.intro")}</p>
        </div>
      </div>
      <Tabs<AnalysisTab>
        label={t("analyses.tabs")}
        value={tab}
        onChange={select}
        tabs={TABS.map((id) => ({ id, label: tabLabel(id) }))}
      />
      <div role="tabpanel" aria-label={tabLabel(tab)}>
        {tab === "matrix" ? <MatrixTab /> : tab === "durability" ? <DurabilityTab /> : tab === "efficiency" ? <EfficiencyTab /> : tab === "turn" ? <TurnTab /> : <ReverseTab />}
      </div>
    </div>
  );
}
