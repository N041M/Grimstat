import { useCallback, useEffect, useMemo, useState } from "react";
import ReactGridLayout, { WidthProvider, type Layout } from "react-grid-layout";
import { db, type DashboardLayoutRecord } from "../db";
import { analysisKeys, widgetAvailable, widgetsFrom, type ReactWidgetDef, type WidgetProps } from "../widgets/registry";
import { host } from "../plugin";
import { ErrorBoundary } from "./ErrorBoundary";
import { t } from "../i18n";
import { nowIso } from "../lib/ids";

const Grid = WidthProvider(ReactGridLayout);
const COLS = 12;
const ROW_HEIGHT = 36;

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
 * remaining widgets below. Rearranging (see the "Rearrange" affordance) overrides this per device.
 */
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
    out.push({ i: w.id, x, y, w: ww, h, minW: 2, minH: 2 });
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
  const maxY = stored.reduce((m, l) => Math.max(m, l.y + l.h), 0);
  return base.map((d) => byId.get(d.i) ?? { ...d, y: maxY + d.y });
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
  const [layout, setLayout] = useState<Layout[] | undefined>(undefined);
  const [loaded, setLoaded] = useState(false);
  // Drag/resize stays behind this affordance: the designed composition is the default, and the grid
  // only becomes malleable once the user asks for it.
  const [rearranging, setRearranging] = useState(false);
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

  useEffect(() => {
    if (narrow) setRearranging(false);
  }, [narrow]);

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

  const reset = useCallback(() => {
    const l = defaultLayout(widgets);
    setLayout(l);
    void db.layouts.delete(id);
  }, [id, widgets]);

  if (!loaded || !layout) return null;

  const xOf = new Map(layout.map((l) => [l.i, l.x] as const));
  const order = [...layout].sort((a, b) => a.y - b.y || a.x - b.x).map((l) => l.i);

  const panel = (w: ReactWidgetDef) => {
    const Render = w.render;
    const headless = HEADLESS.has(w.id);
    return (
      <section className={`widget ${headless ? "flush" : ""}`.trim()} aria-label={w.title}>
        {rearranging ? (
          <div className="widget-drag" title={t("dashboard.dragHint")}>
            <span aria-hidden="true">⠿</span>
            {w.title}
          </div>
        ) : null}
        {headless ? null : (
          <div className="widget-head">
            <h2 className="panel-title" title={w.description}>
              {w.title}
            </h2>
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
        <div className="dash-stack">
          {order.map((widgetId) => {
            const w = byId.get(widgetId);
            return w ? <div key={widgetId}>{panel(w)}</div> : null;
          })}
        </div>
        <div className="dash-bar">
          <span className="dash-hint">{t("dashboard.narrowHint")}</span>
        </div>
      </div>
    );
  }

  return (
    <div className={`dashboard ${rearranging ? "rearranging" : ""}`.trim()}>
      <Grid className="layout" layout={layout} cols={COLS} rowHeight={ROW_HEIGHT} margin={[0, 0]} containerPadding={[0, 0]} draggableHandle=".widget-drag" onLayoutChange={onLayoutChange} isDraggable={rearranging} isResizable={rearranging} compactType="vertical">
        {widgets.map((w) => (
          // Cells are separated by borders rather than gaps, so only cells away from the left edge
          // carry one; every cell carries the bottom rule.
          <div key={w.id} className={(xOf.get(w.id) ?? 0) > 0 ? "cell-inset" : ""}>
            {panel(w)}
          </div>
        ))}
      </Grid>
      <div className="dash-bar">
        <span className="dash-hint">{rearranging ? t("dashboard.hint") : t("dashboard.fixedHint")}</span>
        <span className="dash-actions">
          <button type="button" className={`dash-btn ${rearranging ? "on" : ""}`.trim()} aria-pressed={rearranging} onClick={() => setRearranging((v) => !v)}>
            {t("dashboard.rearrange")}
          </button>
          <button type="button" className="dash-btn" onClick={reset}>
            {t("dashboard.reset")}
          </button>
        </span>
      </div>
    </div>
  );
}
