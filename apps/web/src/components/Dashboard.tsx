import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactGridLayout, { WidthProvider, type Layout } from "react-grid-layout";
import { db, type DashboardLayoutRecord } from "../db";
import { analysisKeys, widgetAvailable, widgetsFrom, type ReactWidgetDef, type WidgetProps } from "../widgets/registry";
import { host } from "../plugin";
import { ErrorBoundary } from "./ErrorBoundary";
import { t } from "../i18n";
import { nowIso } from "../lib/ids";

const Grid = WidthProvider(ReactGridLayout);
const COLS = 12;
/** Space between panels, and between the panels and the region edge. */
const GUTTER = 14;
/**
 * Grid rows are shortened by the gutter so a panel of h rows keeps the height it had when panels
 * were flush: react-grid-layout sizes a panel h*ROW_HEIGHT + (h-1)*GUTTER.
 */
const ROW_HEIGHT = 36 - GUTTER;

/**
 * Widgets that draw their own section title (or, for the hero, no title at all) and therefore get
 * no widget header from the dashboard. They are the four panels of the designed composition; every
 * other widget keeps a plain section header.
 */
const HEADLESS = new Set(["core.summary", "core.damage-distribution", "core.models-slain", "core.damage-by-weapon"]);

/**
 * Pack widgets left-to-right, top-to-bottom using their default sizes.
 *
 * Widget order plus the default sizes are the designed composition: the hero full width, the damage
 * distribution full width, then models-slain and damage-by-weapon at half width each, with the
 * remaining widgets below. Dragging a panel by its title bar or resizing it from the bottom-right
 * corner overrides this, per device, and "Reset layout" returns to it.
 */
/**
 * Smallest size a panel stays legible at. A widget may declare its own `minSize`; otherwise it is
 * derived from the default size, because dense panels (tables, matrices, two-column lists) collide
 * with themselves long before a generic 2x2 floor.
 */
/** Row count a panel needs to be `px` tall: react-grid-layout sizes it h*ROW_HEIGHT + (h-1)*GUTTER. */
export function rowsForHeight(px: number): number {
  return Math.max(1, Math.ceil((px + GUTTER) / (ROW_HEIGHT + GUTTER)));
}

export function minSizeOf(w: ReactWidgetDef): { w: number; h: number } {
  if (w.minSize) return { w: Math.min(w.minSize.w, COLS), h: w.minSize.h };
  const dw = Math.min(w.defaultSize.w, COLS);
  return { w: Math.max(3, Math.min(dw, Math.ceil(dw / 2))), h: Math.max(3, Math.min(w.defaultSize.h, Math.ceil(w.defaultSize.h / 2))) };
}

export function defaultLayout(widgets: ReactWidgetDef[]): Layout[] {
  const out: Layout[] = [];
  let x = 0;
  let y = 0;
  let rowH = 0;
  for (const w of widgets) {
    const ww = Math.min(w.defaultSize.w, COLS);
    const h = w.defaultSize.h;
    if (x + ww > COLS) {
      x = 0;
      y += rowH;
      rowH = 0;
    }
    const min = minSizeOf(w);
    out.push({ i: w.id, x, y, w: Math.max(ww, min.w), h: Math.max(h, min.h), minW: min.w, minH: min.h });
    x += ww;
    rowH = Math.max(rowH, h);
  }
  return out;
}

/** Reconcile a stored layout with the current widget set (new widgets appended, missing ones dropped). */
function reconcile(stored: Layout[] | undefined, widgets: ReactWidgetDef[]): Layout[] {
  const base = defaultLayout(widgets);
  if (!stored) return base;
  const byId = new Map(stored.map((l) => [l.i, l] as const));
  const minById = new Map(widgets.map((w) => [w.id, minSizeOf(w)] as const));
  const maxY = stored.reduce((m, l) => Math.max(m, l.y + l.h), 0);
  return base.map((d) => {
    const s = byId.get(d.i);
    if (!s) return { ...d, y: maxY + d.y };
    // A layout saved before these minimums existed can be smaller than the panel needs; grow it back.
    const min = minById.get(d.i) ?? { w: d.minW ?? 3, h: d.minH ?? 3 };
    const w = Math.min(COLS, Math.max(s.w, min.w));
    return { ...s, w, h: Math.max(s.h, min.h), x: Math.min(s.x, COLS - w), minW: min.w, minH: min.h };
  });
}

function useMedia(query: string): boolean {
  const [m, setM] = useState(() => (typeof window !== "undefined" ? window.matchMedia(query).matches : false));
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setM(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [query]);
  return m;
}

export function Dashboard({ id, inputs }: { id: string; inputs: WidgetProps }) {
  const provided = analysisKeys(inputs.analyses);
  // Analysis widgets are gated on the inputs this dashboard provides (see widgetAvailable).
  const widgets = useMemo(() => widgetsFrom(host).filter((w) => widgetAvailable(w, inputs.analyses)), [provided]); // eslint-disable-line react-hooks/exhaustive-deps
  const gridRef = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<Layout[] | undefined>(undefined);
  const [loaded, setLoaded] = useState(false);
  const narrow = useMedia("(max-width: 899px)");

  useEffect(() => {
    let alive = true;
    db.layouts
      .get(id)
      .then((rec) => {
        if (!alive) return;
        setLayout(reconcile(rec?.layout, widgets));
      })
      .catch(() => setLayout(defaultLayout(widgets)))
      .finally(() => alive && setLoaded(true));
    return () => {
      alive = false;
    };
  }, [id, widgets]);

  const persist = useCallback(
    (l: Layout[]) => {
      const rec: DashboardLayoutRecord = { id, layout: l.map(({ i, x, y, w, h, minW, minH }) => ({ i, x, y, w, h, minW, minH })), hidden: [], updatedAt: nowIso() };
      void db.layouts.put(rec);
    },
    [id],
  );

  const onLayoutChange = useCallback(
    (l: Layout[]) => {
      if (narrow) return; // never overwrite the desktop layout from the single-column view
      setLayout(l);
      persist(l);
    },
    [narrow, persist],
  );

  /**
   * Size every panel to the height its content actually needs.
   *
   * Panel bodies scroll, so a panel that is too tall reports no overflow and a panel that is too
   * short reports the same height as its box: neither reveals the natural height. Measuring instead
   * releases the fixed heights for one synchronous reflow, reads each panel, and puts them back.
   */
  const autoFit = useCallback(() => {
    const root = gridRef.current;
    if (!root || !layout) return;
    const minH = new Map(widgets.map((w) => [w.id, minSizeOf(w).h] as const));
    root.classList.add("measuring");
    const needed = new Map<string, number>();
    for (const cell of root.querySelectorAll<HTMLElement>("[data-widget-id]")) {
      const id = cell.dataset.widgetId;
      if (id) needed.set(id, cell.getBoundingClientRect().height);
    }
    root.classList.remove("measuring");
    // A panel with a long list would otherwise grow to thousands of pixels; nothing may end up
    // taller than one screenful, and those panels keep scrolling internally.
    const capRows = rowsForHeight(Math.max(320, root.clientHeight - 2 * GUTTER));
    setLayout((cur) => {
      if (!cur) return cur;
      const next = cur.map((l) => {
        const px = needed.get(l.i);
        if (!px) return l;
        // react-grid-layout sizes a panel h*ROW_HEIGHT + (h-1)*GUTTER; invert that for the row count.
        const rows = Math.min(capRows, rowsForHeight(px));
        return { ...l, h: Math.max(minH.get(l.i) ?? l.minH ?? 3, rows) };
      });
      persist(next);
      return next;
    });
  }, [layout, persist, widgets]);

  const reset = useCallback(() => {
    const l = defaultLayout(widgets);
    setLayout(l);
    void db.layouts.delete(id);
  }, [id, widgets]);

  if (!loaded || !layout) return null;

  const order = [...layout].sort((a, b) => a.y - b.y || a.x - b.x).map((l) => l.i);

  const panel = (w: ReactWidgetDef) => {
    const Render = w.render;
    const headless = HEADLESS.has(w.id);
    return (
      <section className={`widget ${headless ? "flush" : ""}`.trim()} aria-label={w.title}>
        {/* Every panel has exactly one draggable title area: the slim strip for panels that draw
            their own heading, otherwise the panel header itself. */}
        {headless ? (
          // These panels draw their own heading, so the handle is a slim grip rather than a second title.
          <div className="widget-drag bare" title={`${w.title} — ${t("dashboard.dragHint")}`} aria-label={`${w.title} — ${t("dashboard.dragHint")}`}>
            <span aria-hidden="true">⠿</span>
          </div>
        ) : (
          <div className="widget-head widget-drag" title={t("dashboard.dragHint")}>
            <h2 className="panel-title" title={w.description}>
              {w.title}
            </h2>
            <span className="drag-dots" aria-hidden="true">
              ⠿
            </span>
          </div>
        )}
        <div className="widget-body">
          <ErrorBoundary compact resetKey={inputs.result}>
            <Render {...inputs} />
          </ErrorBoundary>
        </div>
      </section>
    );
  };

  // Phones drop the grid entirely: one column, panels sized by their own content. Positions stay
  // untouched, so the desktop arrangement survives a trip through a narrow window.
  if (narrow) {
    const byId = new Map(widgets.map((w) => [w.id, w] as const));
    return (
      <div className="dashboard narrow">
        <div className="dash-bar">
          <span className="dash-hint">{t("dashboard.narrowHint")}</span>
        </div>
        <div className="dash-stack">
          {order.map((widgetId) => {
            const w = byId.get(widgetId);
            return w ? <div key={widgetId}>{panel(w)}</div> : null;
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="dashboard" ref={gridRef}>
      <div className="dash-bar">
        <span className="dash-hint">{t("dashboard.hint")}</span>
        <span className="dash-actions">
          <button type="button" className="dash-btn" onClick={autoFit} title={t("dashboard.autoFitHint")}>
            {t("dashboard.autoFit")}
          </button>
          <button type="button" className="dash-btn" onClick={reset}>
            {t("dashboard.reset")}
          </button>
        </span>
      </div>
      <Grid className="layout" layout={layout} cols={COLS} rowHeight={ROW_HEIGHT} margin={[GUTTER, GUTTER]} containerPadding={[GUTTER, GUTTER]} draggableHandle=".widget-drag" onLayoutChange={onLayoutChange} isDraggable isResizable compactType="vertical">
        {widgets.map((w) => (
          <div key={w.id} data-widget-id={w.id}>
            {panel(w)}
          </div>
        ))}
      </Grid>
    </div>
  );
}
