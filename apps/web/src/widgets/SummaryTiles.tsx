import { defineWidget, type WidgetProps } from "./registry";
import { fmt, pct, fmtInt } from "../lib/format";
import { t } from "../i18n";

/**
 * The Calculator's hero header: the eyebrow, the 56px expected-damage figure with its 95% CI, and
 * four secondary metrics right-aligned in one nowrap row that wraps as a unit.
 *
 * It is a widget (so it takes part in the rearrangeable dashboard) but renders flush — no card
 * chrome, no widget title; see HEADLESS in Dashboard.tsx.
 */
export function SummaryTiles({ result, running }: WidgetProps) {
  const perPoint = result?.damagePerPoint ?? (result?.attackerPoints ? result.expectedDamage / result.attackerPoints : undefined);
  const dash = "–";
  const stats: Array<{ k: string; v: string; title?: string }> = [
    { k: t("hero.pKill"), v: result ? pct(result.pKill, 0) : dash, title: t("hero.pKill.title") },
    { k: t("hero.median"), v: result ? fmtInt(result.damagePercentiles.p50) : dash },
    { k: t("hero.p95"), v: result ? fmtInt(result.damagePercentiles.p95) : dash },
    { k: t("hero.per100"), v: perPoint === undefined ? dash : fmt(perPoint * 100, 1), title: result?.attackerPoints === undefined ? t("hero.per100.noPoints") : t("summary.attackerPoints", { v: fmtInt(result.attackerPoints) }) },
  ];
  return (
    <div className="hero" aria-live="polite">
      <div className="hero-lead">
        <div className="hero-eyebrow">{t("hero.expectedDamage")}</div>
        <div className="hero-value-row">
          <span className="hero-value">{result ? fmt(result.expectedDamage, 1) : dash}</span>
          {/* The exact backend has no confidence interval; the backend and timing live in the dock. */}
          <span className="hero-ci">{result?.ciHalfWidth !== undefined ? t("hero.ci", { v: fmt(result.ciHalfWidth, 2) }) : result ? "" : running ? t("results.running") : t("hero.noResult")}</span>
        </div>
      </div>
      <div className="hero-stats">
        {stats.map((s) => (
          <div className="hero-stat" key={s.k} title={s.title}>
            <div className="hero-stat-k">{s.k}</div>
            <div className="hero-stat-v">{s.v}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export const summaryTilesWidget = defineWidget({
  id: "core.summary",
  title: t("widget.summary"),
  description: t("widget.summary.desc"),
  inputs: ["result"],
  defaultSize: { w: 12, h: 3 },
  minSize: { w: 8, h: 4 },
  render: SummaryTiles,
});
