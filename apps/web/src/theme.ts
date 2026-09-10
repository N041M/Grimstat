import { useEffect, useState } from "react";

export type ThemePreference = "dark" | "light" | "system";
export type ResolvedTheme = "dark" | "light";

const KEY = "grimstat.theme";
const mq = () => (typeof window !== "undefined" && window.matchMedia ? window.matchMedia("(prefers-color-scheme: light)") : undefined);

export function readThemePreference(): ThemePreference {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "dark" || v === "light" || v === "system") return v;
  } catch {
    /* storage unavailable */
  }
  return "system";
}

export function resolveTheme(p: ThemePreference): ResolvedTheme {
  if (p !== "system") return p;
  return mq()?.matches ? "light" : "dark";
}

export function applyTheme(p: ThemePreference): ResolvedTheme {
  const r = resolveTheme(p);
  document.documentElement.setAttribute("data-theme", r);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", r === "dark" ? "#131417" : "#fbfaf8");
  return r;
}

export function useTheme(): { preference: ThemePreference; resolved: ResolvedTheme; setPreference: (p: ThemePreference) => void; cycle: () => void } {
  const [preference, setPref] = useState<ThemePreference>(() => readThemePreference());
  const [resolved, setResolved] = useState<ResolvedTheme>(() => resolveTheme(preference));

  useEffect(() => {
    setResolved(applyTheme(preference));
    try {
      localStorage.setItem(KEY, preference);
    } catch {
      /* ignore */
    }
    if (preference !== "system") return;
    const m = mq();
    if (!m) return;
    const onChange = () => setResolved(applyTheme("system"));
    m.addEventListener("change", onChange);
    return () => m.removeEventListener("change", onChange);
  }, [preference]);

  const cycle = () => setPref((p) => (p === "dark" ? "light" : p === "light" ? "system" : "dark"));
  return { preference, resolved, setPreference: setPref, cycle };
}
