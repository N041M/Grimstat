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

/**
 * The shell has three widths. App.tsx turns these two queries into the classes `compact`, `phone`
 * and `tablet` on `.shell`, and styles.css lays the shell out from those classes, so the markup
 * and the layout always agree about which width is in force.
 *
 * On a phone the navigation lives in a drawer and the context column opens as a bottom sheet,
 * which leaves the page the whole width. A phone turned sideways is 812px across but only 375px
 * tall, and ten destinations in a column need more height than that, so height decides this one
 * as well as width.
 *
 * On a tablet the rail stands in the page with each destination named under its letter, so
 * changing screen is one tap. The context column is still a sheet.
 *
 * From 1040px the rail, the context column and the page sit side by side. That is the width the
 * three of them need, so the layout is never wider than the window it is in.
 */
export const PHONE_QUERY = "(max-width: 759px), (max-height: 500px) and (max-width: 1039px)";

/** True on phones and tablets both: the width at which the context column becomes a sheet. */
export const COMPACT_QUERY = "(max-width: 1039px)";

/**
 * What the pages themselves do, rather than what the shell does: below this width the army builder
 * goes to one column with a bottom-sheet inspector, and the CSS stacks panels that were side by
 * side. A 1024px tablet keeps its two-column pages because the rail leaves them the room.
 */
export const NARROW_QUERY = "(max-width: 899px)";
