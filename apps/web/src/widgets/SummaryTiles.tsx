import { defineWidget, type WidgetProps } from "./registry";
import { fmt, pct, fmtInt } from "../lib/format";
import { t } from "../i18n";
import { Badge, Empty } from "../components/ui";

function Tile({ k, v, sub }: { k: string; v: string; sub?: string }) {
  return (
    <div className="tile">
      <div className="k">{k}</div>
      <div className="v">{v}</div>
      {sub ? <div className="sub">{sub}</div> : null}
    </div>
  );
}

export function SummaryTiles({ result, running }: WidgetProps) {
  if (!result) return <Empty>{running ? t("results.running") : t("results.none")}</Empty>;
  const perPoint = result.damagePerPoint ?? (result.attackerPoints ? result.expectedDamage / result.attackerPoints : undefined);
  const p1 = result.pAtLeastSlain[1] ?? (result.slainPMF[0] !== undefined ? 1 - result.slainPMF[0] : undefined);
  const backend = result.backend === "exact" ? t("results.backend.exact") : t("results.backend.mc", { n: fmtInt(result.iterations) });
  return (
    <div className="stack">
      <div className="tiles">
        <Tile k={t("summary.expectedDamage")} v={fmt(result.expectedDamage)} sub={result.ciHalfWidth !== undefined ? `± ${fmt(result.ciHalfWidth, 3)} (95% CI)` : undefined} />
        <Tile k={t("summary.expectedSlain")} v={fmt(result.expectedSlain)} />
        <Tile k={t("summary.pKill")} v={pct(result.pKill)} />
        <Tile k={t("summary.pAtLeastOne")} v={pct(p1)} />
        <Tile k={t("summary.medianDamage")} v={fmtInt(result.damagePercentiles.p50)} sub={t("summary.p95", { v: fmtInt(result.damagePercentiles.p95) })} />
        <Tile k={t("summary.wasted")} v={fmt(result.expectedWasted)} />
        {perPoint !== undefined ? <Tile k={t("summary.perHundredPoints")} v={fmt(perPoint * 100)} sub={t("summary.attackerPoints", { v: fmtInt(result.attackerPoints) })} /> : null}
        {result.pointsSlain !== undefined ? <Tile k={t("summary.pointsSlain")} v={fmt(result.pointsSlain, 1)} /> : null}
        {result.expectedSelfMortals > 0 ? <Tile k={t("summary.selfMortals")} v={fmt(result.expectedSelfMortals)} /> : null}
      </div>
      <div className="row small muted">
        <Badge tone={result.backend === "exact" ? "ok" : "warn"}>{backend}</Badge>
        {result.defenderPoints !== undefined ? <span>{t("summary.defenderPoints", { v: fmtInt(result.defenderPoints) })}</span> : null}
      </div>
    </div>
  );
}

export const summaryTilesWidget = defineWidget({
  id: "core.summary",
  title: t("widget.summary"),
  description: t("widget.summary.desc"),
  inputs: ["result"],
  defaultSize: { w: 12, h: 4 },
  render: SummaryTiles,
});
