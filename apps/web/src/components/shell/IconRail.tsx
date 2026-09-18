import { useCallback, useRef, useState } from "react";
import { hrefFor, type Route } from "../../router";
import type { ThemePreference, useTheme } from "../../theme";
import { useApp } from "../../state/AppContext";
import { Icon, Sheet, menuKeys, useDismiss } from "../ui";
import { t, type I18nKey } from "../../i18n";
import { MOD } from "../../lib/keys";
import { useAuthUser, useSyncState } from "../../hooks/useAccount";

export interface RailEntry {
  route: Route;
  /** The single mono letter shown in the rail — the item has no other label. */
  glyph: string;
  labelKey: I18nKey;
}

/** `C S A M X N B P D U ?` — the rail's whole vocabulary. Reused by the command palette's "Go to" group. */
export const RAIL_ENTRIES: readonly RailEntry[] = [
  { route: "calculator", glyph: "C", labelKey: "nav.calculator" },
  { route: "scenarios", glyph: "S", labelKey: "nav.scenarios" },
  { route: "armies", glyph: "A", labelKey: "nav.armies" },
  { route: "collection", glyph: "M", labelKey: "nav.collection" },
  { route: "codex", glyph: "X", labelKey: "nav.codex" },
  { route: "analyses", glyph: "N", labelKey: "nav.analyses" },
  { route: "battle", glyph: "B", labelKey: "nav.battle" },
  { route: "play", glyph: "P", labelKey: "nav.play" },
  { route: "data", glyph: "D", labelKey: "nav.data" },
  { route: "profile", glyph: "@", labelKey: "nav.profile" },
  { route: "about", glyph: "?", labelKey: "nav.about" },
];

/**
 * About is not one of the places the work happens, so it sits at the foot of the rail and of the
 * drawer, beside the theme control, rather than at the end of the run of destinations.
 */
const FOOT_ROUTES: readonly Route[] = ["profile", "about"];
const WORK_ENTRIES = RAIL_ENTRIES.filter((e) => !FOOT_ROUTES.includes(e.route));
const FOOT_ENTRIES = RAIL_ENTRIES.filter((e) => FOOT_ROUTES.includes(e.route));

const PREFERENCES: Array<{ value: ThemePreference; key: I18nKey }> = [
  { value: "light", key: "theme.optionLight" },
  { value: "dark", key: "theme.optionDark" },
  { value: "system", key: "theme.optionSystem" },
];

function ThemeControl({ theme }: { theme: ReturnType<typeof useTheme> }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(ref, open, close);
  const dark = theme.resolved === "dark";
  const label = theme.preference === "system" ? t("theme.system", { r: t(dark ? "theme.optionDark" : "theme.optionLight") }) : t(dark ? "theme.dark" : "theme.light");
  return (
    <div className="rail-theme" ref={ref}>
      <button type="button" className="rail-item rail-theme-btn" aria-haspopup="menu" aria-expanded={open} title={label} aria-label={t("theme.toggleAria")} onClick={() => setOpen((v) => !v)}>
        <span className="rail-glyph" aria-hidden="true">
          {dark ? "☀" : "☾"}
        </span>
        <span className="rail-label" aria-hidden="true">
          {t("theme.menuLabel")}
        </span>
      </button>
      {open ? (
        <div className="rail-theme-menu menu" role="menu" aria-label={t("theme.menuLabel")} onKeyDown={(e) => menuKeys(e, e.currentTarget)}>
          {PREFERENCES.map((p) => (
            <button
              key={p.value}
              type="button"
              role="menuitemradio"
              aria-checked={theme.preference === p.value}
              onClick={() => {
                theme.setPreference(p.value);
                close();
              }}
            >
              {t(p.key)}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * The 56px icon rail: brand mark (opens the command palette, carries the solve-state dot),
 * one single-letter item per route, theme control pinned to the bottom. Pointing at it or
 * tabbing into it widens it over the page to name each item, since a letter on its own says
 * little — see `.rail` in styles.css.
 *
 * `stacked` is the tablet rail. It stands in the page at 78px rather than hanging over it, and
 * every item shows its name under its letter at all times. A tablet has no pointer to hover with,
 * so the labels have to be there without one.
 *
 * Each item carries `data-route`, which is how the tour finds the one to point at (see Tour.tsx).
 */
/**
 * The account's mark: a circle with the signed-in person's initial, or an empty one when nobody is,
 * with a dot for a sync that is paused, failing or running. It stands apart from the letter tiles
 * because it is not a screen of the app so much as who is using it.
 */
function AccountGlyph() {
  const user = useAuthUser();
  const sync = useSyncState();
  const initial = user.anonymous ? "" : (user.handle ?? user.displayName).charAt(0).toUpperCase();
  const dot = sync.status === "paused" || sync.status === "error" || sync.status === "syncing" ? sync.status : undefined;
  return (
    <span className={`rail-avatar ${user.anonymous ? "out" : "in"}`} aria-hidden="true">
      {initial}
      {dot ? <span className={`rail-dot ${dot}`} /> : null}
    </span>
  );
}

/** What the account entry says on hover and in the drawer: the address when signed in. */
function useAccountTitle(): string | undefined {
  const user = useAuthUser();
  return user.anonymous ? undefined : user.displayName;
}

export function IconRail({ route, theme, offline, stacked }: { route: Route; theme: ReturnType<typeof useTheme>; offline?: boolean; stacked?: boolean }) {
  const accountTitle = useAccountTitle();
  const { solveState, openPalette } = useApp();
  const pending = solveState === "pending";
  return (
    <div className={stacked ? "rail rail-stacked" : "rail"}>
      <button type="button" className="rail-mark" onClick={() => openPalette()} title={t("palette.openHint", { mod: MOD })} aria-label={t("palette.open")} aria-haspopup="dialog">
        <span className="rail-mark-diamond" aria-hidden="true" />
        <span className={`rail-dot ${pending ? "pending" : "current"}`} title={t(pending ? "solve.pending" : "solve.current")} />
      </button>
      <nav className="rail-nav rail-nav-fill" aria-label={t("nav.label")}>
        {WORK_ENTRIES.map((e) => (
          <a key={e.route} className="rail-item" data-route={e.route} href={hrefFor(e.route)} aria-label={t(e.labelKey)} aria-current={route === e.route ? "page" : undefined}>
            <span className="rail-glyph" aria-hidden="true">
              {e.glyph}
            </span>
            <span className="rail-label" aria-hidden="true">
              {t(e.labelKey)}
            </span>
          </a>
        ))}
        <div className="rail-foot">
          {FOOT_ENTRIES.map((e) => (
            <a key={e.route} className="rail-item rail-item-foot" data-route={e.route} href={hrefFor(e.route)} aria-label={t(e.labelKey)} title={e.route === "profile" ? accountTitle : undefined} aria-current={route === e.route ? "page" : undefined}>
              <span className="rail-glyph" aria-hidden="true">
                {e.route === "profile" ? <AccountGlyph /> : e.glyph}
              </span>
              <span className="rail-label" aria-hidden="true">
                {t(e.labelKey)}
              </span>
            </a>
          ))}
        </div>
      </nav>
      {offline ? (
        <span className="rail-offline" role="status" title={t("shell.offlineHint")} aria-label={t("shell.offlineHint")}>
          {t("shell.offline")}
        </span>
      ) : null}
      <ThemeControl theme={theme} />
    </div>
  );
}

/**
 * Navigation on a phone: the rail, slid in from the left.
 *
 * The bar along the bottom could not hold ten destinations, a theme control and the mark, and its
 * single letters said nothing without the labels a hover reveals on a wider screen. This is the same
 * list in the same order, always with its labels, in a drawer at the edge the rail lives on. The mark
 * keeps its place at the top and still opens the command palette.
 */
export function NavDrawer({ open, onClose, route, theme, offline }: { open: boolean; onClose: () => void; route: Route; theme: ReturnType<typeof useTheme>; offline?: boolean }) {
  const { solveState, openPalette } = useApp();
  const pending = solveState === "pending";
  const accountTitle = useAccountTitle();
  return (
    <Sheet open={open} onClose={onClose} side="left" label={t("nav.label")} className="nav-drawer">
      <div className="nav-drawer-head">
        <span className="rail-mark" aria-hidden="true">
          <span className="rail-mark-diamond" />
          <span className={`rail-dot ${pending ? "pending" : "current"}`} title={t(pending ? "solve.pending" : "solve.current")} />
        </span>
        <span className="nav-drawer-brand">{t("nav.name")}</span>
        <button type="button" className="nav-drawer-close" onClick={onClose} aria-label={t("common.close")}>
          <span aria-hidden="true">×</span>
        </button>
      </div>
      <button
        type="button"
        className="nav-drawer-search"
        onClick={() => {
          onClose();
          openPalette();
        }}
      >
        <Icon name="search" />
        {t("palette.placeholder")}
      </button>
      <nav className="nav-drawer-list" aria-label={t("nav.label")}>
        {WORK_ENTRIES.map((e) => (
          <a key={e.route} className="nav-drawer-item" href={hrefFor(e.route)} aria-current={route === e.route ? "page" : undefined} onClick={onClose}>
            <span className="nav-drawer-glyph" aria-hidden="true">
              {e.glyph}
            </span>
            {t(e.labelKey)}
          </a>
        ))}
      </nav>
      <div className="nav-drawer-foot">
        {FOOT_ENTRIES.map((e) => (
          <a key={e.route} className="nav-drawer-item" href={hrefFor(e.route)} aria-current={route === e.route ? "page" : undefined} onClick={onClose}>
            <span className="nav-drawer-glyph" aria-hidden="true">
              {e.route === "profile" ? <AccountGlyph /> : e.glyph}
            </span>
            {t(e.labelKey)}
            {e.route === "profile" && accountTitle ? <span className="nav-drawer-sub">{accountTitle}</span> : null}
          </a>
        ))}
        {offline ? (
          <span className="rail-offline" role="status">
            {t("shell.offline")}
          </span>
        ) : null}
        <div className="nav-drawer-theme" role="group" aria-label={t("theme.menuLabel")}>
          {PREFERENCES.map((p) => (
            <button key={p.value} type="button" className={theme.preference === p.value ? "sm primary" : "sm"} aria-pressed={theme.preference === p.value} onClick={() => theme.setPreference(p.value)}>
              {t(p.key)}
            </button>
          ))}
        </div>
      </div>
    </Sheet>
  );
}
