import { useCallback, useEffect, useRef, useState } from "react";
import { COMPACT_QUERY, PHONE_QUERY, useMediaQuery } from "./hooks/useMediaQuery";
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
import { CollectionPage } from "./pages/CollectionPage";
import { RosterEditorPage } from "./pages/RosterEditorPage";
import { CodexPage } from "./pages/CodexPage";
import { AnalysesPage } from "./pages/AnalysesPage";
import { BattlePage } from "./pages/BattlePage";
import { PlayPage } from "./pages/PlayPage";
import { DataPage } from "./pages/DataPage";
import { OverridesPage } from "./pages/OverridesPage";
import { AboutPage } from "./pages/AboutPage";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { Sheet, useEdgeFade } from "./components/ui";
import { CommandPalette, ContextColumn, contextEyebrow, IconRail, NavDrawer, useBarHostRef } from "./components/shell";
import { swStore, useOnline, useServiceWorker } from "./lib/sw";
import { t } from "./i18n";

export function App() {
  const { route, param } = useRouteInfo();
  const theme = useTheme();
  const { ready, notices, dismissNotice, replaceScenario, notify } = useApp();
  const sw = useServiceWorker();
  const online = useOnline();
  // On a phone the drawer carries navigation and on a tablet the rail does. Both widths put the
  // context column in a sheet, which is what `compact` is for.
  const phone = useMediaQuery(PHONE_QUERY);
  const compact = useMediaQuery(COMPACT_QUERY);
  const tablet = compact && !phone;
  const [sheet, setSheet] = useState(false);
  const [nav, setNav] = useState(false);
  // The bar's action strip scrolls when a page has more actions than the width takes, and it is
  // only mounted at compact widths, so the fade is set up again whenever that changes.
  const setBarHost = useBarHostRef();
  const barRef = useRef<HTMLDivElement | null>(null);
  const barHostRef = useCallback(
    (el: HTMLDivElement | null) => {
      barRef.current = el;
      setBarHost(el);
    },
    [setBarHost],
  );
  useEdgeFade(barRef, compact);

  // The context sheet is per-screen; leaving the screen closes it.
  useEffect(() => setSheet(false), [route, param]);
  useEffect(() => {
    if (!compact) setSheet(false);
  }, [compact]);
  useEffect(() => {
    if (!phone) setNav(false);
  }, [phone]);

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
      {route === "calculator" ? <CalculatorPage /> : route === "scenarios" ? <ScenariosPage /> : route === "armies" ? param ? <RosterEditorPage id={param} /> : <ArmiesPage /> : route === "collection" ? <CollectionPage /> : route === "codex" ? <CodexPage id={param} /> : route === "analyses" ? <AnalysesPage /> : route === "battle" ? <BattlePage /> : route === "play" ? <PlayPage /> : route === "data" ? param === "overrides" ? <OverridesPage /> : <DataPage /> : <AboutPage />}
    </ErrorBoundary>
  );

  return (
    <div className={["shell", compact ? "compact" : "", phone ? "phone" : "", tablet ? "tablet" : ""].filter(Boolean).join(" ")}>
      {phone ? null : <IconRail route={route} theme={theme} offline={!online} stacked={tablet} />}
      {compact ? null : <ContextColumn route={route} param={param} />}
      <main className="main-region">
        {compact ? (
          <div className="ctx-bar">
            {phone ? (
              <button type="button" className="ctx-bar-nav" onClick={() => setNav(true)} aria-haspopup="dialog" aria-expanded={nav} aria-label={t("nav.open")}>
                <span aria-hidden="true">☰</span>
              </button>
            ) : null}
            <button type="button" className="ctx-bar-btn" onClick={() => setSheet(true)} aria-haspopup="dialog" aria-expanded={sheet} aria-label={t("ctxcol.openSheet")}>
              {contextEyebrow(route)}
              <span aria-hidden="true">⌄</span>
            </button>
            {/* A screen with no page header of its own puts its primary actions here. */}
            <div className="ctx-bar-actions" ref={barHostRef} />
          </div>
        ) : null}
        {page}
      </main>
      {phone ? <NavDrawer open={nav} onClose={() => setNav(false)} route={route} theme={theme} offline={!online} /> : null}
      {compact ? (
        <Sheet open={sheet} onClose={() => setSheet(false)} label={contextEyebrow(route)} className="ctx-sheet">
          <ContextColumn route={route} param={param} inSheet />
        </Sheet>
      ) : null}
      {sw.needRefresh ? (
        <div className="update-banner" role="status">
          <span>{t("shell.updateReady")}</span>
          <button type="button" className="primary sm" onClick={() => void swStore.update()}>
            {t("shell.updateReload")}
          </button>
          <button type="button" className="ghost sm" onClick={() => swStore.dismiss()}>
            {t("shell.updateLater")}
          </button>
        </div>
      ) : null}
      {notices.length ? (
        <div className="notice-layer">
          {notices.map((n) => (
            <div key={n.id} className={`notice ${n.kind}`} role={n.kind === "error" ? "alert" : "status"}>
              <div className="notice-body">
                <div>{n.text}</div>
                {n.details?.length ? (
                  <ul className="error-list">
                    {n.details.map((d, i) => (
                      <li key={i}>{d}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
              {n.action ? (
                <button
                  type="button"
                  className="sm notice-action"
                  onClick={() => {
                    n.action?.run();
                    dismissNotice(n.id);
                  }}
                >
                  {n.action.label}
                </button>
              ) : null}
              <button type="button" className="ghost sm close" onClick={() => dismissNotice(n.id)} aria-label={t("common.close")}>
                ×
              </button>
            </div>
          ))}
        </div>
      ) : null}
      <CommandPalette theme={theme} />
    </div>
  );
}
