import { useMemo, useRef, useState, type FocusEvent, type MouseEvent } from "react";
import type { MatrixResult } from "@grimstat/game-40k-11e";
import { heatColour, heatmapModel, metricIsAverage, type MatrixMetric } from "../../lib/heatmap";
import { fmt, fmtInt, pct } from "../../lib/format";
import { t } from "../../i18n";

export interface HeatmapProps {
  matrix: MatrixResult;
  metric: MatrixMetric;
  /** Points of each attacker / defender when known (for the header badges). */
  attackerPoints?: Array<number | undefined>;
  defenderPoints?: Array<number | undefined>;
  onSelect?: (attackerIndex: number, defenderIndex: number) => void;
}

export function metricLabel(metric: MatrixMetric): string {
  switch (metric) {
    case "damage":
      return t("analyses.metric.damage");
    case "slain":
      return t("analyses.metric.slain");
    case "pKill":
      return t("analyses.metric.pKill");
    case "damagePer100":
      return t("analyses.metric.damagePer100");
    case "pointsPer100":
      return t("analyses.metric.pointsPer100");
  }
}

export function formatMetric(metric: MatrixMetric, v: number | undefined): string {
  if (v === undefined) return "–";
  return metric === "pKill" ? pct(v, 0) : fmt(v, metric === "slain" ? 1 : 1);
}

interface Hover {
  a: number;
  d: number;
  left: number;
  top: number;
}

/** Attackers × defenders grid with a colour scale on the chosen metric. Cells are buttons (click = open pair). */
export function Heatmap({ matrix, metric, attackerPoints, defenderPoints, onSelect }: HeatmapProps) {
  const model = useMemo(() => heatmapModel(matrix, metric), [matrix, metric]);
  const [hover, setHover] = useState<Hover | undefined>(undefined);
  const outer = useRef<HTMLDivElement>(null);
  const D = matrix.defenders.length;
  const totalsLabel = metricIsAverage(metric) ? t("analyses.matrix.mean") : t("analyses.matrix.total");

  // The tooltip lives outside the horizontally scrolling grid so it is never clipped; position it
  // from viewport rects, clamped so it stays inside the outer box.
  const show = (a: number, d: number, el: HTMLElement) => {
    const o = outer.current?.getBoundingClientRect();
    const c = el.getBoundingClientRect();
    if (!o) return;
    const half = 120;
    const left = Math.max(half, Math.min(o.width - half, c.left - o.left + c.width / 2));
    setHover({ a, d, left, top: c.bottom - o.top });
  };
  const onEnter = (a: number, d: number) => (e: MouseEvent<HTMLButtonElement> | FocusEvent<HTMLButtonElement>) => show(a, d, e.currentTarget);

  if (!matrix.attackers.length || !D) return <div className="empty">{t("analyses.matrix.empty")}</div>;

  const cell = hover ? matrix.cells[hover.a]?.[hover.d] : undefined;
  const r = cell?.result;

  return (
    <div className="heatmap-outer" ref={outer}>
      <div className="heatmap-wrap">
      <div className="heatmap" role="table" aria-label={t("analyses.matrix.aria", { metric: metricLabel(metric) })} style={{ gridTemplateColumns: `minmax(140px, 220px) repeat(${D}, minmax(76px, 1fr)) 64px` }}>
        <div role="row" className="heatmap-r">
          <div role="columnheader" className="heatmap-corner">
            <span className="small muted">{t("analyses.matrix.corner")}</span>
          </div>
          {matrix.defenders.map((name, d) => (
            <div key={d} role="columnheader" className="heatmap-h" title={name}>
              <span className="heatmap-hname">{name}</span>
              {defenderPoints?.[d] !== undefined ? <span className="muted small">{t("unit.points", { v: fmtInt(defenderPoints[d]) })}</span> : null}
            </div>
          ))}
          <div role="columnheader" className="heatmap-h heatmap-tot">
            {totalsLabel}
          </div>
        </div>
        {matrix.attackers.map((name, a) => (
          <div key={a} role="row" className="heatmap-r">
            <div role="rowheader" className="heatmap-rh" title={name}>
              <span className="heatmap-hname">{name}</span>
              {attackerPoints?.[a] !== undefined ? <span className="muted small">{t("unit.points", { v: fmtInt(attackerPoints[a]) })}</span> : null}
            </div>
            {matrix.defenders.map((dname, d) => {
              const v = model.values[a]?.[d];
              const c = heatColour(v, model.min, model.max);
              return (
                <div key={d} role="cell" className="heatmap-c">
                  <button
                    type="button"
                    className="heatmap-btn"
                    style={{ background: c.background, color: c.color }}
                    aria-label={t("analyses.matrix.cellAria", { a: name, d: dname, metric: metricLabel(metric), v: formatMetric(metric, v) })}
                    onMouseEnter={onEnter(a, d)}
                    onFocus={onEnter(a, d)}
                    onMouseLeave={() => setHover(undefined)}
                    onBlur={() => setHover(undefined)}
                    onClick={() => onSelect?.(a, d)}
                  >
                    {formatMetric(metric, v)}
                  </button>
                </div>
              );
            })}
            <div role="cell" className="heatmap-c heatmap-tot num">
              {formatMetric(metric, model.rowTotals[a])}
            </div>
          </div>
        ))}
        <div role="row" className="heatmap-r">
          <div role="rowheader" className="heatmap-rh heatmap-tot">
            {totalsLabel}
          </div>
          {matrix.defenders.map((_, d) => (
            <div key={d} role="cell" className="heatmap-c heatmap-tot num">
              {formatMetric(metric, model.colTotals[d])}
            </div>
          ))}
          <div role="cell" className="heatmap-c heatmap-tot" />
        </div>
      </div>
      </div>
      {hover && cell && r ? (
        <div className="chart-tip heatmap-tip" style={{ left: hover.left, top: hover.top }} role="tooltip">
          <div>
            <strong>{cell.attacker}</strong> → <strong>{cell.defender}</strong>
          </div>
          <div>
            {t("analyses.metric.damage")}: {fmt(r.expectedDamage)}
          </div>
          <div>
            {t("analyses.metric.slain")}: {fmt(r.expectedSlain)}
          </div>
          <div>
            {t("analyses.metric.pKill")}: {pct(r.pKill)}
          </div>
          <div>
            {t("analyses.metric.damagePer100")}: {cell.damagePer100 !== undefined ? fmt(cell.damagePer100) : "–"}
          </div>
          <div>
            {t("analyses.metric.pointsPer100")}: {cell.pointsTradePer100 !== undefined ? fmt(cell.pointsTradePer100, 1) : "–"}
          </div>
          <div className="muted">{r.backend === "exact" ? t("results.backend.exact") : t("results.backend.mcShort")}</div>
          {onSelect ? <div className="muted">{t("analyses.matrix.clickHint")}</div> : null}
        </div>
      ) : null}
    </div>
  );
}
