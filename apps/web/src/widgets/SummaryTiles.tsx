import { defineWidget, type WidgetProps } from "./registry";
import { fmt, pct, fmtInt } from "../lib/format";
import { headlineOf, signed, type Headline } from "../lib/headline";
import { t } from "../i18n";

/**
 * The Calculator's hero header: the eyebrow, the 56px expected-damage figure with its 95% CI, and
 * four secondary metrics right-aligned in one nowrap row that wraps as a unit. While a result is
 * pinned, every figure carries the change against the pinned one beneath it.
 *
 * It is a widget (so it takes part in the rearrangeable dashboard) but renders flush — no card
 * chrome, no widget title; see HEADLESS in Dashboard.tsx.
 */
export function SummaryTiles({ result, running, pinned }: WidgetProps) {
  const now: Headline | undefined = result ? headlineOf(result) : undefined;
  const dash = "–";
  // The change against the pinned result, or nothing when either side is missing.
  const delta = (pick: (h: Headline) => number | undefined, f: (x: number) => string): string | undefined => {
    if (!pinned || !now) return undefined;
    const a = pick(now);
    const b = pick(pinned);
    return a === undefined || b === undefined ? undefined : signed(a - b, f);
  };
  const stats: Array<{ k: string; v: string; d?: string | undefined; title?: string }> = [
    { k: t("hero.pKill"), v: now ? pct(now.pKill, 0) : dash, d: delta((h) => h.pKill, (x) => pct(x, 0)), title: t("hero.pKill.title") },
    { k: t("hero.median"), v: now ? fmtInt(now.median) : dash, d: delta((h) => h.median, (x) => fmtInt(x)), title: t("hero.median.title") },
    { k: t("hero.p95"), v: now ? fmtInt(now.p95) : dash, d: delta((h) => h.p95, (x) => fmtInt(x)), title: t("hero.p95.title") },
    {
      k: t("hero.per100"),
      v: now?.per100 === undefined ? dash : fmt(now.per100, 1),
      d: delta((h) => h.per100, (x) => fmt(x, 1)),
      title: result?.attackerPoints === undefined ? t("hero.per100.noPoints") : `${t("hero.per100.title")} · ${t("summary.attackerPoints", { v: fmtInt(result.attackerPoints) })}`,
    },
  ];
  const heroDelta = delta((h) => h.expectedDamage, (x) => fmt(x, 1));
  return (
    <div className="hero" aria-live="polite">
      <div className="hero-lead">
        <div className="hero-eyebrow">{t("hero.expectedDamage")}</div>
        <div className="hero-value-row">
          <span className="hero-value">{now ? fmt(now.expectedDamage, 1) : dash}</span>
          {/* The exact backend has no confidence interval; the backend and timing live in the dock. */}
          <span className="hero-ci">{result?.ciHalfWidth !== undefined ? t("hero.ci", { v: fmt(result.ciHalfWidth, 2) }) : result ? "" : running ? t("results.running") : t("hero.noResult")}</span>
        </div>
        {heroDelta !== undefined ? (
          <div className="hero-delta mono" title={t("hero.pinDelta.title")}>
            {t("hero.vsPinned", { v: heroDelta })}
          </div>
        ) : null}
      </div>
      <div className="hero-stats">
        {stats.map((s) => (
          <div className="hero-stat" key={s.k} title={s.title}>
            <div className="hero-stat-k">{s.k}</div>
            <div className="hero-stat-v">{s.v}</div>
            {s.d !== undefined ? (
              <div className="hero-stat-d" title={t("hero.pinDelta.title")}>
                {t("hero.vsPinned", { v: s.d })}
              </div>
            ) : null}
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
