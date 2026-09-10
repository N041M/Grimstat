import { useCallback, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * A hover readout for chart marks.
 *
 * The browser's own `title` attribute waits about a second, cannot be styled, shows one line, and
 * does not exist on a touch screen — so the numbers a chart hides behind it are effectively lost.
 * This puts them in a positioned panel that follows the pointer, appears at once, and is also
 * opened by keyboard focus.
 */

export interface HoverContent {
  title: ReactNode;
  /** Label and value pairs, values already formatted. */
  rows?: Array<{ label: ReactNode; value: ReactNode }>;
  note?: ReactNode;
}

interface Anchored {
  content: HoverContent;
  x: number;
  y: number;
}

export function useHover(): {
  hovered: Anchored | undefined;
  /** Spread onto a mark: pointer and focus open the readout, leaving closes it. */
  bind: (content: HoverContent) => {
    onPointerEnter: (e: React.PointerEvent) => void;
    onPointerMove: (e: React.PointerEvent) => void;
    onPointerLeave: () => void;
    onFocus: (e: React.FocusEvent) => void;
    onBlur: () => void;
  };
  layer: ReactNode;
} {
  const [hovered, setHovered] = useState<Anchored | undefined>(undefined);
  const raf = useRef<number | undefined>(undefined);

  const place = useCallback((content: HoverContent, x: number, y: number) => {
    if (raf.current) cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => setHovered({ content, x, y }));
  }, []);

  const bind = useCallback(
    (content: HoverContent) => ({
      onPointerEnter: (e: React.PointerEvent) => place(content, e.clientX, e.clientY),
      onPointerMove: (e: React.PointerEvent) => place(content, e.clientX, e.clientY),
      onPointerLeave: () => setHovered(undefined),
      onFocus: (e: React.FocusEvent) => {
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
        place(content, r.left + r.width / 2, r.top);
      },
      onBlur: () => setHovered(undefined),
    }),
    [place],
  );

  return { hovered, bind, layer: <HoverPanel anchored={hovered} /> };
}

function HoverPanel({ anchored }: { anchored: Anchored | undefined }) {
  if (!anchored || typeof document === "undefined") return null;
  const { content, x, y } = anchored;
  // Flip across the pointer near the viewport edges so the panel is never clipped.
  const flipX = x > window.innerWidth - 240;
  const flipY = y < 140;
  const style: React.CSSProperties = {
    left: flipX ? undefined : x + 14,
    right: flipX ? window.innerWidth - x + 14 : undefined,
    top: flipY ? y + 18 : undefined,
    bottom: flipY ? undefined : window.innerHeight - y + 12,
  };
  return createPortal(
    <div className="hover-panel" role="tooltip" style={style}>
      <div className="hover-title">{content.title}</div>
      {content.rows?.length ? (
        <dl className="hover-rows">
          {content.rows.map((r, i) => (
            <div key={i}>
              <dt>{r.label}</dt>
              <dd className="mono">{r.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {content.note ? <div className="hover-note">{content.note}</div> : null}
    </div>,
    document.body,
  );
}
