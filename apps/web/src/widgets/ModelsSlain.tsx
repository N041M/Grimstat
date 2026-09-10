import { defineWidget, type WidgetProps } from "./registry";
import { PanelHead, ProportionBar } from "../components/kit";
import { Empty } from "../components/ui";
import { slainRows } from "../lib/distribution";
import { fmt, pct } from "../lib/format";
import { t } from "../i18n";

/**
 * Rows of `18px | 1fr | 46px`: the model count, a proportional bar in a `--fill` trough and the
 * probability. Outcomes at the mode are drawn in `--ink`, the rest in `--dim`.
 */
export function ModelsSlain({ result, running }: WidgetProps) {
  if (!result)
    return (
      <div className="w-pad">
        <PanelHead title={t("widget.slain")} />
        <Empty>{running ? t("results.running") : t("results.none")}</Empty>
      </div>
    );
  const rows = slainRows(result.slainPMF);
  const meta = [t("slain.mean", { v: fmt(result.expectedSlain, 2) }), t("slain.wasted", { v: fmt(result.expectedWasted, 1) }), ...(result.pointsSlain === undefined ? [] : [t("slain.points", { v: fmt(result.pointsSlain, 0) })]), ...(result.expectedSelfMortals > 0 ? [t("slain.selfMortals", { v: fmt(result.expectedSelfMortals, 2) })] : [])].join(" · ");
  return (
    <div className="w-pad slain">
      <PanelHead title={t("widget.slain")} />
      <div className="slain-rows">
        {rows.map((r) => (
          <div className="slain-row" key={r.n} title={t("slain.rowTitle", { n: r.n, p: pct(r.p, 1), atLeast: pct(result.pAtLeastSlain[r.n] ?? 0, 1) })}>
            <span className="slain-n">{r.n}</span>
            <ProportionBar value={r.width} tone={r.modal ? "ink" : "dim"} height={11} />
            <span className="slain-p">{fmt(r.p, 2)}</span>
          </div>
        ))}
      </div>
      <div className="slain-meta">{meta}</div>
    </div>
  );
}

export const modelsSlainWidget = defineWidget({
  id: "core.models-slain",
  title: t("widget.slain"),
  description: t("widget.slain.desc"),
  inputs: ["result"],
  defaultSize: { w: 6, h: 6 },
  render: ModelsSlain,
});
