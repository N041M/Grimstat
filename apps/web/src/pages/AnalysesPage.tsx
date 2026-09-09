import { useEffect, useState } from "react";
import { getSetting, setSetting } from "../db";
import { Tabs } from "../components/ui";
import { MatrixTab } from "../components/analyses/MatrixTab";
import { DurabilityTab } from "../components/analyses/DurabilityTab";
import { EfficiencyTab } from "../components/analyses/EfficiencyTab";
import { TurnTab } from "../components/analyses/TurnTab";
import { t } from "../i18n";

export type AnalysisTab = "matrix" | "durability" | "efficiency" | "turn";
const TABS: AnalysisTab[] = ["matrix", "durability", "efficiency", "turn"];
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
        tabs={[
          { id: "matrix", label: t("analyses.tab.matrix") },
          { id: "durability", label: t("analyses.tab.durability") },
          { id: "efficiency", label: t("analyses.tab.efficiency") },
          { id: "turn", label: t("analyses.tab.turn") },
        ]}
      />
      <div role="tabpanel" aria-label={t(tab === "matrix" ? "analyses.tab.matrix" : tab === "durability" ? "analyses.tab.durability" : tab === "efficiency" ? "analyses.tab.efficiency" : "analyses.tab.turn")}>
        {tab === "matrix" ? <MatrixTab /> : tab === "durability" ? <DurabilityTab /> : tab === "efficiency" ? <EfficiencyTab /> : <TurnTab />}
      </div>
    </div>
  );
}
