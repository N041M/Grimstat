import { useCallback, useRef, useState } from "react";
import { hrefFor, type Route } from "../../router";
import type { ThemePreference, useTheme } from "../../theme";
import { useApp } from "../../state/AppContext";
import { useDismiss } from "../ui";
import { t, type I18nKey } from "../../i18n";

export interface RailEntry {
  route: Route;
  /** The single mono letter shown in the rail — the item has no other label. */
  glyph: string;
  labelKey: I18nKey;
}

/** `C S A N B D ?` — the rail's whole vocabulary. Reused by the command palette's "Go to" group. */
export const RAIL_ENTRIES: readonly RailEntry[] = [
  { route: "calculator", glyph: "C", labelKey: "nav.calculator" },
  { route: "scenarios", glyph: "S", labelKey: "nav.scenarios" },
  { route: "armies", glyph: "A", labelKey: "nav.armies" },
  { route: "analyses", glyph: "N", labelKey: "nav.analyses" },
  { route: "battle", glyph: "B", labelKey: "nav.battle" },
  { route: "data", glyph: "D", labelKey: "nav.data" },
  { route: "about", glyph: "?", labelKey: "nav.about" },
];

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
        <span aria-hidden="true">{dark ? "☀" : "☾"}</span>
      </button>
      {open ? (
        <div className="rail-theme-menu menu" role="menu" aria-label={t("theme.menuLabel")}>
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
 * seven single-letter route items, theme control pinned to the bottom. Below 900px the same
 * markup lays itself out as a bottom bar (see `.shell.narrow .rail` in styles.css).
 */
export function IconRail({ route, theme }: { route: Route; theme: ReturnType<typeof useTheme> }) {
  const { solveState, openPalette } = useApp();
  const pending = solveState === "pending";
  return (
    <div className="rail">
      <button type="button" className="rail-mark" onClick={() => openPalette()} title={t("palette.openHint")} aria-label={t("palette.open")} aria-haspopup="dialog">
        <span className="rail-mark-diamond" aria-hidden="true" />
        <span className={`rail-dot ${pending ? "pending" : "current"}`} title={t(pending ? "solve.pending" : "solve.current")} />
      </button>
      <nav className="rail-nav" aria-label={t("nav.label")}>
        {RAIL_ENTRIES.map((e) => (
          <a key={e.route} className="rail-item" href={hrefFor(e.route)} title={t(e.labelKey)} aria-label={t(e.labelKey)} aria-current={route === e.route ? "page" : undefined}>
            <span aria-hidden="true">{e.glyph}</span>
          </a>
        ))}
      </nav>
      <div className="rail-spacer" />
      <ThemeControl theme={theme} />
    </div>
  );
}
