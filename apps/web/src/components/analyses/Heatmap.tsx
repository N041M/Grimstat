import { useMemo, type CSSProperties } from "react";
import type { MatrixResult } from "@grimstat/game-40k-11e";
import { heatColour, heatRamp, heatmapModel, type MatrixMetric } from "../../lib/heatmap";
import { fmt, fmtInt, pct } from "../../lib/format";
import { useHover } from "../charts/HoverLayer";
import { t } from "../../i18n";

export interface HeatmapProps {
  matrix: MatrixResult;
  metric: MatrixMetric;
  /** "values" prints the number in each cell; "swatches" shows the colour alone (the Heatmap tab). */
  view?: "values" | "swatches";
  /** Points of each attacker / defender when known (shown under the labels). */
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

/** The notation behind a metric label ("E[damage]"), shown as a title only. */
export function metricNotation(metric: MatrixMetric): string {
  switch (metric) {
    case "damage":
      return t("analyses.metric.damage.notation");
    case "slain":
      return t("analyses.metric.slain.notation");
    case "pKill":
      return t("analyses.metric.pKill.notation");
    case "damagePer100":
      return t("analyses.metric.damagePer100.notation");
    case "pointsPer100":
      return t("analyses.metric.pointsPer100.notation");
  }
}

export function formatMetric(metric: MatrixMetric, v: number | undefined): string {
  if (v === undefined) return "–";
  return metric === "pKill" ? pct(v, 0) : fmt(v, 1);
}

/**
 * Attackers × defenders grid on the ink ramp: `170px repeat(N, minmax(74px,1fr))`, one clipped
 * panel. Cells are buttons — clicking one loads that pair into the calculator.
 */
export function Heatmap({ matrix, metric, view = "values", attackerPoints, defenderPoints, onSelect }: HeatmapProps) {
  const hover = useHover();
  const model = useMemo(() => heatmapModel(matrix, metric), [matrix, metric]);
  const D = matrix.defenders.length;
  if (!matrix.attackers.length || !D) return <div className="empty">{t("analyses.matrix.empty")}</div>;

  return (
    <div className="mx-scroll">
      <div className={`mx ${view === "swatches" ? "swatches" : ""}`.trim()} role="table" aria-label={t("analyses.matrix.aria", { metric: metricLabel(metric) })} style={{ "--mx-cols": `170px repeat(${D}, minmax(74px,1fr))` } as CSSProperties}>
        <div role="row" className="mx-row">
          <div role="columnheader" className="mx-corner">
            {t("analyses.matrix.corner")}
          </div>
          {matrix.defenders.map((name, d) => (
            <div key={d} role="columnheader" className="mx-colhead" title={name}>
              {name}
              {defenderPoints?.[d] !== undefined ? <span className="mx-pts">{t("unit.points", { v: fmtInt(defenderPoints[d]) })}</span> : null}
            </div>
          ))}
        </div>
        {matrix.attackers.map((name, a) => (
          <div key={a} role="row" className={`mx-row ${a % 2 ? "alt" : ""}`.trim()}>
            <div role="rowheader" className="mx-rowhead" title={name}>
              {name}
              {attackerPoints?.[a] !== undefined ? <span className="mx-pts">{t("unit.points", { v: fmtInt(attackerPoints[a]) })}</span> : null}
            </div>
            {matrix.defenders.map((dname, d) => {
              const v = model.values[a]?.[d];
              const c = heatColour(v, model.min, model.max);
              const shown = formatMetric(metric, v);
              const title = t("analyses.matrix.cellTitle", { a: name, d: dname, v: shown, metric: metricLabel(metric) });
              return (
                <div key={d} role="cell" className="mx-cell">
                  <button
                    type="button"
                    style={{ background: c.background, color: c.color }}
                    aria-label={title}
                    onClick={() => onSelect?.(a, d)}
                    {...hover.bind({
                      title: `${name} → ${dname}`,
                      rows: [{ label: metricLabel(metric), value: shown }],
                      note: t("analyses.matrix.cellNote"),
                    })}
                  >
                    {view === "values" ? shown : <span className="sr-only">{shown}</span>}
                  </button>
                </div>
              );
            })}
          </div>
        ))}
      </div>
      {hover.layer}
    </div>
  );
}

/** One swatch per shade class, with the numeric range beside them. */
export function HeatLegend({ matrix, metric }: { matrix: MatrixResult; metric: MatrixMetric }) {
  const model = useMemo(() => heatmapModel(matrix, metric), [matrix, metric]);
  const swatches = useMemo(() => heatRamp(model.min, model.max), [model.min, model.max]);
  return (
    <div className="mx-legend">
      <span className="t-micro mx-legend-label" title={metricNotation(metric)}>
        {metricLabel(metric)}
      </span>
      <span className="mx-legend-strip" aria-hidden="true">
        {swatches.map((s, i) => (
          <span key={i} style={{ background: s.background }} />
        ))}
      </span>
      <span className="mx-legend-range">{t("analyses.matrix.range", { lo: formatMetric(metric, model.min), hi: formatMetric(metric, model.max) })}</span>
    </div>
  );
}
