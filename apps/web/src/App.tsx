import { useCallback, useEffect, useRef, useState } from "react";
import { COMPACT_QUERY, PHONE_QUERY, useMediaQuery } from "./hooks/useMediaQuery";
import { useApp } from "./state/AppContext";
import { navigate, useRouteInfo } from "./router";
import { useTheme } from "./theme";
import { decodePermalink, permalinkTokenFromHash } from "./lib/permalink";
import { decodeRosterPermalink, rosterTokenFromHash } from "./lib/rosterPermalink";
import { cloneRoster } from "./lib/roster";
import { hasUnsavedEdits } from "./lib/scenario";
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
import { fmtResume, ProfilePage } from "./pages/ProfilePage";
import { PublicProfilePage } from "./pages/PublicProfilePage";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { Sheet, useConfirm, useEdgeFade } from "./components/ui";
import { CommandPalette, ContextColumn, contextEyebrow, IconRail, NavDrawer, Tour, useBarHostRef } from "./components/shell";
import { mayReplaceScenario, setReplaceScenarioGuard } from "./components/shell/ContextColumn";
import { useOnline } from "./lib/sw";
import { formatClosesOn, movedNotice } from "./lib/moved";
import { setAskReplace } from "./lib/accountBoot";
import { sync } from "./services/sync";
import { t } from "./i18n";

/** The notice this build carries when the app has moved; see `lib/moved.ts`. Read once. */
const MOVED = movedNotice(import.meta.env);

export function App() {
  const { route, param } = useRouteInfo();
  const theme = useTheme();
  const { ready, notices, dismissNotice, replaceScenario, notify, scenario } = useApp();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const online = useOnline();
  // On a phone the drawer carries navigation and on a tablet the rail does. Both widths put the
  // context column in a sheet, which is what `compact` is for.
  const phone = useMediaQuery(PHONE_QUERY);
  const compact = useMediaQuery(COMPACT_QUERY);
  const tablet = compact && !phone;
  const [sheet, setSheet] = useState(false);
  const [nav, setNav] = useState(false);
  // Both layers keep the same close handler for as long as the app is mounted, so their focus
  // handling is set up when they open rather than on every render of this screen.
  const closeSheet = useCallback(() => setSheet(false), []);
  const closeNav = useCallback(() => setNav(false), []);
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

  // The account asks one question of its own, when a device holds another account's lists, and
  // the shell's dialog is where it is asked.
  useEffect(() => setAskReplace(() => confirm({ title: t("profile.replaceTitle"), body: t("profile.replaceBody"), confirmLabel: t("profile.replace"), danger: true })), [confirm]);

  // Sync says when it is paused or failing, once per change of state, wherever the reader is.
  // A failure notice stays until it is closed, and every retry that fails again replaces it rather
  // than stacking a copy beneath it.
  useEffect(() => {
    let last = sync().state().status;
    let failure: number | undefined;
    return sync().subscribe((s) => {
      if (s.status === last) return;
      last = s.status;
      if (s.status === "paused" && s.pausedUntil) notify(t("sync.paused", { time: fmtResume(s.pausedUntil) }), "info");
      else if (s.status === "error" && s.error) {
        if (failure !== undefined) dismissNotice(failure);
        failure = notify(t("sync.error", { error: s.error }), "error");
      }
    });
  }, [notify, dismissNotice]);

  // The shell owns the question every way of loading a scenario has to ask, because the calculator
  // holds one scenario and loading another drops it. The screens and the palette ask through
  // `mayReplaceScenario`.
  useEffect(
    () =>
      setReplaceScenarioGuard(async () => {
        const stored = await db.scenarios.get(scenario.id);
        if (!hasUnsavedEdits(scenario, stored)) return true;
        return confirm({ title: t("scenario.discardTitle"), body: t("scenario.discardBody", { name: scenario.name }), confirmLabel: t("scenario.discard"), danger: true });
      }),
    [scenario, confirm],
  );

  // Permalinks: "#s=<token>" opens the scenario in the calculator (on load and when pasted later).
  useEffect(() => {
    if (!ready) return;
    const handle = () => {
      const token = permalinkTokenFromHash(location.hash);
      if (!token) return;
      void (async () => {
        try {
          const shared = decodePermalink(token);
          // A link pasted into the address bar changes the hash without reloading the page, so the
          // scenario on screen is still there to lose.
          if (await mayReplaceScenario()) {
            await replaceScenario(shared.scenario, shared.snapshotId);
            notify(t("scenario.openedFromLink", { name: shared.scenario.name }), "success");
          }
        } catch (e) {
          notify(t("scenario.badLink"), "error", [e instanceof Error ? e.message : String(e)]);
        }
        navigate("calculator", true);
      })();
    };
    handle();
    window.addEventListener("hashchange", handle);
    return () => window.removeEventListener("hashchange", handle);
  }, [ready, replaceScenario, notify]);

  // Roster permalinks: "#/armies?r=<token>" offers the army the link carries, and keeps it once the
  // person says so. Following a link is not by itself a reason to put someone else's army on this
  // device, so nothing is stored until they answer.
  useEffect(() => {
    if (!ready) return;
    const handle = () => {
      const token = rosterTokenFromHash(location.hash);
      if (!token) return;
      void (async () => {
        try {
          const { roster, snapshotId } = decodeRosterPermalink(token);
          const existing = await db.rosters.get(roster.id);
          if (existing && JSON.stringify(existing) === JSON.stringify(roster)) {
            navigate("armies", true, roster.id);
            return;
          }
          if (!(await confirm({ title: t("armies.keepFromLinkTitle"), body: t("armies.keepFromLinkBody", { name: roster.name }), confirmLabel: t("armies.keepFromLink") }))) {
            navigate("armies", true);
            return;
          }
          const rec = existing ? cloneRoster(roster, t("armies.fromLinkName", { name: roster.name })) : roster;
          await saveRosterWithVersion(rec);
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
  }, [ready, notify, confirm]);

  const page = !ready ? (
    <p className="muted shell-loading">{t("shell.loading")}</p>
  ) : (
    <ErrorBoundary resetKey={`${route}/${param ?? ""}`}>
      {route === "calculator" ? <CalculatorPage /> : route === "scenarios" ? <ScenariosPage /> : route === "armies" ? param ? <RosterEditorPage key={param} id={param} /> : <ArmiesPage /> : route === "collection" ? <CollectionPage /> : route === "codex" ? <CodexPage id={param} /> : route === "analyses" ? <AnalysesPage /> : route === "battle" ? <BattlePage /> : route === "play" ? <PlayPage /> : route === "data" ? param === "overrides" ? <OverridesPage /> : <DataPage /> : route === "profile" ? <ProfilePage /> : route === "u" ? <PublicProfilePage handle={param} /> : <AboutPage />}
    </ErrorBoundary>
  );

  return (
    <div className={["shell", compact ? "compact" : "", phone ? "phone" : "", tablet ? "tablet" : ""].filter(Boolean).join(" ")}>
      {phone ? null : <IconRail route={route} theme={theme} offline={!online} stacked={tablet} />}
      {compact ? null : <ContextColumn route={route} param={param} />}
      {/* The screen on show, named so the tour can point at the one its card is about: on a phone
          there is no rail to light, and the page's own title stands in for it. */}
      <main className="main-region" data-route={route}>
        {MOVED ? (
          <div className="moved-banner" role="status">
            <span>
              {MOVED.closesOn ? t("moved.text", { host: MOVED.host, date: formatClosesOn(MOVED.closesOn) }) : t("moved.textNoDate", { host: MOVED.host })}
            </span>
            <a href="#/data">{t("data.backup")}</a>
            <a href={MOVED.url}>{t("moved.open", { host: MOVED.host })}</a>
          </div>
        ) : null}
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
      {phone ? <NavDrawer open={nav} onClose={closeNav} route={route} theme={theme} offline={!online} /> : null}
      {compact ? (
        <Sheet open={sheet} onClose={closeSheet} label={contextEyebrow(route)} className="ctx-sheet">
          <ContextColumn route={route} param={param} inSheet />
        </Sheet>
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
      <Tour />
      {confirmDialog}
    </div>
  );
}
