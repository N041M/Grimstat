import { useCallback, useRef, useState } from "react";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { hrefFor, type Route } from "../../router";
import type { ThemePreference, useTheme } from "../../theme";
import { useApp } from "../../state/AppContext";
import { Sheet, menuKeys, useDismiss } from "../ui";
import { t, type I18nKey } from "../../i18n";

export interface RailEntry {
  route: Route;
  /** The single mono letter shown in the rail — the item has no other label. */
  glyph: string;
  labelKey: I18nKey;
}

/** `C S A M X N B P D ?` — the rail's whole vocabulary. Reused by the command palette's "Go to" group. */
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
  { route: "about", glyph: "?", labelKey: "nav.about" },
];

/**
 * What the bottom bar shows on a phone. Ten destinations and a theme control do not fit across a
 * phone, and the row used to run off the edge with the last item half drawn. These four sit in the
 * bar and the rest are one tap away under More; whichever page you are on joins them, so the bar
 * always says where you are.
 */
const PHONE_ROUTES: readonly Route[] = ["calculator", "armies", "collection", "battle"];

function phoneEntries(route: Route): readonly RailEntry[] {
  const primary = RAIL_ENTRIES.filter((e) => PHONE_ROUTES.includes(e.route));
  const here = RAIL_ENTRIES.find((e) => e.route === route);
  return here && !primary.includes(here) ? [...primary.slice(0, PHONE_ROUTES.length - 1), here] : primary;
}

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
 * little — see `.rail` in styles.css. Below 900px the same markup lays itself out as a bottom
 * bar, where every item keeps a permanent label under its glyph.
 */
export function IconRail({ route, theme, offline }: { route: Route; theme: ReturnType<typeof useTheme>; offline?: boolean }) {
  const { solveState, openPalette } = useApp();
  const phone = useMediaQuery("(max-width: 899px)");
  const [moreOpen, setMoreOpen] = useState(false);
  const pending = solveState === "pending";
  const entries = phone ? phoneEntries(route) : RAIL_ENTRIES;
  return (
    <div className="rail">
      <button type="button" className="rail-mark" onClick={() => openPalette()} title={t("palette.openHint")} aria-label={t("palette.open")} aria-haspopup="dialog">
        <span className="rail-mark-diamond" aria-hidden="true" />
        <span className={`rail-dot ${pending ? "pending" : "current"}`} title={t(pending ? "solve.pending" : "solve.current")} />
      </button>
      <nav className="rail-nav" aria-label={t("nav.label")}>
        {entries.map((e) => (
          <a key={e.route} className="rail-item" href={hrefFor(e.route)} aria-label={t(e.labelKey)} aria-current={route === e.route ? "page" : undefined}>
            <span className="rail-glyph" aria-hidden="true">
              {e.glyph}
            </span>
            <span className="rail-label" aria-hidden="true">
              {t(e.labelKey)}
            </span>
          </a>
        ))}
      </nav>
      <div className="rail-spacer" />
      {offline ? (
        <span className="rail-offline" role="status" title={t("shell.offlineHint")} aria-label={t("shell.offlineHint")}>
          {t("shell.offline")}
        </span>
      ) : null}
      {phone ? (
        <>
          <button type="button" className="rail-item rail-more" aria-haspopup="dialog" aria-expanded={moreOpen} onClick={() => setMoreOpen(true)}>
            <span className="rail-glyph" aria-hidden="true">
              ⋯
            </span>
            <span className="rail-label" aria-hidden="true">
              {t("nav.more")}
            </span>
          </button>
          <Sheet open={moreOpen} onClose={() => setMoreOpen(false)} label={t("nav.more")} className="rail-sheet">
            <nav className="rail-sheet-grid" aria-label={t("nav.label")}>
              {RAIL_ENTRIES.map((e) => (
                <a key={e.route} className="rail-sheet-item" href={hrefFor(e.route)} aria-current={route === e.route ? "page" : undefined} onClick={() => setMoreOpen(false)}>
                  <span className="rail-sheet-glyph" aria-hidden="true">
                    {e.glyph}
                  </span>
                  {t(e.labelKey)}
                </a>
              ))}
            </nav>
            <div className="rail-sheet-theme">
              {PREFERENCES.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  className={theme.preference === p.value ? "sm primary" : "sm"}
                  aria-pressed={theme.preference === p.value}
                  onClick={() => theme.setPreference(p.value)}
                >
                  {t(p.key)}
                </button>
              ))}
            </div>
          </Sheet>
        </>
      ) : (
        <ThemeControl theme={theme} />
      )}
    </div>
  );
}
