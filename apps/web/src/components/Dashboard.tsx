import { useCallback, useEffect, useMemo, useState } from "react";
import ReactGridLayout, { WidthProvider, type Layout } from "react-grid-layout";
import { db, type DashboardLayoutRecord } from "../db";
import { widgetsFrom, type ReactWidgetDef, type WidgetProps } from "../widgets/registry";
import { host } from "../plugin";
import { ErrorBoundary } from "./ErrorBoundary";
import { t } from "../i18n";
import { nowIso } from "../lib/ids";

const Grid = WidthProvider(ReactGridLayout);
const COLS = 12;
const ROW_HEIGHT = 36;

/** Pack widgets left-to-right, top-to-bottom using their default sizes. */
export function defaultLayout(widgets: ReactWidgetDef[]): Layout[] {
  const out: Layout[] = [];
  let x = 0;
  let y = 0;
  let rowH = 0;
  for (const w of widgets) {
    const { w: ww, h } = w.defaultSize;
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
  const widgets = useMemo(() => widgetsFrom(host), []);
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

  const reset = useCallback(() => {
    const l = defaultLayout(widgets);
    setLayout(l);
    void db.layouts.delete(id);
  }, [id, widgets]);

  if (!loaded || !layout) return null;

  const effective: Layout[] = narrow
    ? [...layout]
        .sort((a, b) => a.y - b.y || a.x - b.x)
        .map((l, idx) => ({ ...l, x: 0, w: 1, minW: 1, maxW: 1, y: idx, static: true }))
    : layout;

  return (
    <div className="dashboard">
      <div className="row between" style={{ marginBottom: "0.5rem" }}>
        <span className="small muted">{narrow ? t("dashboard.narrowHint") : t("dashboard.hint")}</span>
        <button type="button" className="sm" onClick={reset}>
          {t("dashboard.reset")}
        </button>
      </div>
      <Grid className="layout" layout={effective} cols={narrow ? 1 : COLS} rowHeight={ROW_HEIGHT} margin={[12, 12]} draggableHandle=".widget-drag" onLayoutChange={onLayoutChange} isDraggable={!narrow} isResizable={!narrow} compactType="vertical">
        {widgets.map((w) => {
          const Render = w.render;
          return (
            <div key={w.id}>
              <section className="widget" aria-label={w.title}>
                <div className="widget-head">
                  <span className="widget-drag" title={w.description}>
                    {w.title}
                  </span>
                </div>
                <div className="widget-body">
                  <ErrorBoundary compact resetKey={inputs.result}>
                    <Render {...inputs} />
                  </ErrorBoundary>
                </div>
              </section>
            </div>
          );
        })}
      </Grid>
    </div>
  );
}
