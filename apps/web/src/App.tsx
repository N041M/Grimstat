import { useEffect, useState } from "react";
import { NARROW_QUERY, useMediaQuery } from "./hooks/useMediaQuery";
import { useApp } from "./state/AppContext";
import { navigate, useRouteInfo } from "./router";
import { useTheme } from "./theme";
import { decodePermalink, permalinkTokenFromHash } from "./lib/permalink";
import { decodeRosterPermalink, rosterTokenFromHash } from "./lib/rosterPermalink";
import { cloneRoster } from "./lib/roster";
import { db, saveRosterWithVersion } from "./db";
import { CalculatorPage } from "./pages/CalculatorPage";
import { ScenariosPage } from "./pages/ScenariosPage";
import { ArmiesPage } from "./pages/ArmiesPage";
import { RosterEditorPage } from "./pages/RosterEditorPage";
import { CodexPage } from "./pages/CodexPage";
import { AnalysesPage } from "./pages/AnalysesPage";
import { BattlePage } from "./pages/BattlePage";
import { DataPage } from "./pages/DataPage";
import { OverridesPage } from "./pages/OverridesPage";
import { AboutPage } from "./pages/AboutPage";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { Sheet } from "./components/ui";
import { CommandPalette, ContextColumn, contextEyebrow, IconRail } from "./components/shell";
import { t } from "./i18n";

export function App() {
  const { route, param } = useRouteInfo();
  const theme = useTheme();
  const { ready, notice, dismissNotice, replaceScenario, notify } = useApp();
  const narrow = useMediaQuery(NARROW_QUERY);
  const [sheet, setSheet] = useState(false);

  // The context sheet is per-screen; leaving the screen closes it.
  useEffect(() => setSheet(false), [route, param]);
  useEffect(() => {
    if (!narrow) setSheet(false);
  }, [narrow]);

  // Permalinks: "#s=<token>" opens the scenario in the calculator (on load and when pasted later).
  useEffect(() => {
    if (!ready) return;
    const handle = () => {
      const token = permalinkTokenFromHash(location.hash);
      if (!token) return;
      try {
        const { scenario, snapshotId } = decodePermalink(token);
        void replaceScenario(scenario, snapshotId).then(() => notify(t("scenario.openedFromLink", { name: scenario.name }), "success"));
      } catch (e) {
        notify(t("scenario.badLink"), "error", [e instanceof Error ? e.message : String(e)]);
      }
      navigate("calculator", true);
    };
    handle();
    window.addEventListener("hashchange", handle);
    return () => window.removeEventListener("hashchange", handle);
  }, [ready, replaceScenario, notify]);

  // Roster permalinks: "#/armies?r=<token>" stores the embedded army and opens it in the editor.
  useEffect(() => {
    if (!ready) return;
    const handle = () => {
      const token = rosterTokenFromHash(location.hash);
      if (!token) return;
      void (async () => {
        try {
          const { roster, snapshotId } = decodeRosterPermalink(token);
          const existing = await db.rosters.get(roster.id);
          const same = existing && JSON.stringify(existing) === JSON.stringify(roster);
          const rec = existing && !same ? cloneRoster(roster, t("armies.fromLinkName", { name: roster.name })) : roster;
          if (!same) await saveRosterWithVersion(rec);
          if (!(await db.snapshots.get(snapshotId))) notify(t("armies.snapshotMissing", { id: snapshotId }), "info");
          else notify(t("armies.openedFromLink", { name: rec.name }), "success");
          navigate("armies", true, rec.id);
        } catch (e) {
          notify(t("armies.badLink"), "error", [e instanceof Error ? e.message : String(e)]);
          navigate("armies", true);
        }
      })();
    };
    handle();
    window.addEventListener("hashchange", handle);
    return () => window.removeEventListener("hashchange", handle);
  }, [ready, notify]);

  const page = !ready ? (
    <p className="muted shell-loading">{t("shell.loading")}</p>
  ) : (
    <ErrorBoundary resetKey={`${route}/${param ?? ""}`}>
      {route === "calculator" ? <CalculatorPage /> : route === "scenarios" ? <ScenariosPage /> : route === "armies" ? param ? <RosterEditorPage id={param} /> : <ArmiesPage /> : route === "codex" ? <CodexPage id={param} /> : route === "analyses" ? <AnalysesPage /> : route === "battle" ? <BattlePage /> : route === "data" ? param === "overrides" ? <OverridesPage /> : <DataPage /> : <AboutPage />}
    </ErrorBoundary>
  );

  return (
    <div className={`shell ${narrow ? "narrow" : ""}`.trim()}>
      <IconRail route={route} theme={theme} />
      {narrow ? null : <ContextColumn route={route} param={param} />}
      <main className="main-region">
        {narrow ? (
          <div className="ctx-bar">
            <button type="button" className="ctx-bar-btn" onClick={() => setSheet(true)} aria-haspopup="dialog" aria-expanded={sheet} aria-label={t("ctxcol.openSheet")}>
              <span aria-hidden="true">☰</span>
              {contextEyebrow(route)}
            </button>
          </div>
        ) : null}
        {page}
      </main>
      {narrow ? (
        <Sheet open={sheet} onClose={() => setSheet(false)} label={contextEyebrow(route)} className="ctx-sheet">
          <ContextColumn route={route} param={param} inSheet />
        </Sheet>
      ) : null}
      {notice ? (
        <div className="notice-layer">
          <div className={`notice ${notice.kind}`} role={notice.kind === "error" ? "alert" : "status"}>
            <div>
              <div>{notice.text}</div>
              {notice.details?.length ? (
                <ul className="error-list">
                  {notice.details.map((d, i) => (
                    <li key={i}>{d}</li>
                  ))}
                </ul>
              ) : null}
            </div>
            <button type="button" className="ghost sm close" onClick={dismissNotice} aria-label={t("common.close")}>
              ×
            </button>
          </div>
        </div>
      ) : null}
      <CommandPalette theme={theme} />
    </div>
  );
}
