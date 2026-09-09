import { useEffect } from "react";
import { can } from "@grimstat/entitlements";
import { currentPlan } from "@grimstat/entitlements";
import { useApp } from "./state/AppContext";
import { navigate, useRoute, type Route } from "./router";
import { useTheme } from "./theme";
import { decodePermalink, permalinkTokenFromHash } from "./lib/permalink";
import { CalculatorPage } from "./pages/CalculatorPage";
import { ScenariosPage } from "./pages/ScenariosPage";
import { DataPage } from "./pages/DataPage";
import { AboutPage } from "./pages/AboutPage";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { t } from "./i18n";

const NAV: Array<{ route: Route; label: () => string }> = [
  { route: "calculator", label: () => t("nav.calculator") },
  { route: "scenarios", label: () => t("nav.scenarios") },
  { route: "data", label: () => t("nav.data") },
  { route: "about", label: () => t("nav.about") },
];

function BrandMark() {
  return (
    <svg className="brand-mark" viewBox="0 0 64 64" aria-hidden="true">
      <rect width="64" height="64" rx="12" fill="var(--bg)" />
      <path d="M32 8 56 32 32 56 8 32Z" fill="var(--accent)" />
      <path d="M32 20 44 32 32 44 20 32Z" fill="var(--bg)" />
      <path d="M32 26 38 32 32 38 26 32Z" fill="var(--text)" />
    </svg>
  );
}

export function App() {
  const route = useRoute();
  const theme = useTheme();
  const { ready, notice, dismissNotice, replaceScenario, notify, snapshot, activeSnapshotId } = useApp();

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

  const themeLabel = theme.preference === "system" ? t("theme.system", { r: theme.resolved }) : theme.preference === "dark" ? t("theme.dark") : t("theme.light");

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <BrandMark />
          <div>
            <div className="brand-name">Grimstat</div>
            <div className="brand-sub">{t("brand.sub")}</div>
          </div>
        </div>
        <nav className="nav" aria-label={t("nav.label")}>
          {NAV.map((n) => (
            <a key={n.route} href={`#/${n.route}`} aria-current={route === n.route ? "page" : undefined}>
              {n.label()}
            </a>
          ))}
          {can("sync") ? (
            <span className="nav-item disabled" aria-disabled="true" title={t("nav.syncHint")}>
              {t("nav.sync")}
              <span className="badge">{t("nav.soon")}</span>
            </span>
          ) : null}
        </nav>
        <div className="sidebar-foot">
          <span title={activeSnapshotId}>{snapshot ? t("shell.activeSnapshot", { label: snapshot.label ?? snapshot.id }) : t("shell.noSnapshot")}</span>
          <button type="button" className="sm" onClick={theme.cycle} aria-label={t("theme.toggleAria")}>
            {themeLabel}
          </button>
          <span className="badge">{t("shell.plan", { plan: currentPlan() })}</span>
        </div>
      </aside>
      <main className="main">
        {notice ? (
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
        ) : null}
        {!ready ? (
          <p className="muted">{t("shell.loading")}</p>
        ) : (
          <ErrorBoundary resetKey={route}>
            {route === "calculator" ? <CalculatorPage /> : route === "scenarios" ? <ScenariosPage /> : route === "data" ? <DataPage /> : <AboutPage />}
          </ErrorBoundary>
        )}
      </main>
      <footer className="footer">{t("footer.disclaimer")}</footer>
    </div>
  );
}
