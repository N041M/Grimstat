import { useEffect, useState } from "react";

/** Reactive `window.matchMedia(query).matches`; false during SSR/tests without a window. */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => (typeof window !== "undefined" && window.matchMedia ? window.matchMedia(query).matches : false));
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia(query);
    const on = () => setMatches(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [query]);
  return matches;
}

/** Below this width the army builder switches to the single-column layout with a bottom-sheet inspector. */
export const NARROW_QUERY = "(max-width: 899px)";
