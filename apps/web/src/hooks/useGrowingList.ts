import { useCallback, useEffect, useRef, useState } from "react";

/** How far below the last drawn row the next batch starts being drawn. */
const AHEAD = "600px";

export interface GrowingList {
  /** How many rows to draw. */
  limit: number;
  /** Put this on an element after the last row; reaching it draws the next batch. */
  moreRef: (el: HTMLElement | null) => void;
}

/**
 * A list drawn a batch at a time, the next batch drawn as the reader scrolls towards it.
 *
 * The codex covers every faction until one is picked, so its lists run to well over a thousand
 * rows. Building them all costs about half a second before anything appears, and nobody reads past
 * the first screen, so the list starts at `page` rows and grows by `page` each time the reader
 * comes within a screen of the end.
 *
 * `reset` is whatever makes the list a different list — the faction, the search — and starts it
 * over at the first batch. Picking a row is not one of those: the list is the same list, and the
 * reader keeps their place in it.
 */
export function useGrowingList(page: number, reset: unknown, total: number): GrowingList {
  const [limit, setLimit] = useState(page);
  const marker = useRef<HTMLElement | null>(null);

  useEffect(() => {
    setLimit(page);
  }, [page, reset]);

  const moreRef = useCallback((el: HTMLElement | null) => {
    marker.current = el;
  }, []);

  // Rebuilt at each limit, because an observer that is already reporting the marker as in view
  // reports nothing further when the list grows under it. A fresh one looks again, so a screen
  // deep enough to show several batches at once fills in one go rather than one batch per scroll.
  useEffect(() => {
    const el = marker.current;
    if (!el || limit >= total) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setLimit((n) => n + page);
      },
      { rootMargin: AHEAD },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [page, limit, total]);

  return { limit, moreRef };
}
