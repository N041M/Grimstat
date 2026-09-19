import { defineWidget, type WidgetProps } from "./registry";
import { SituationBar } from "../components/calc/SituationBar";
import { fmt, pct, fmtInt } from "../lib/format";
import { headlineOf, signed, type Headline } from "../lib/headline";
import { matchupOf } from "../lib/matchup";
import { MatchupMark } from "../components/MatchupMark";
import { IDLE_MESSAGE } from "../hooks/useSimulation";
import { t } from "../i18n";

/**
 * The Calculator's hero header: the eyebrow, the 56px expected-damage figure with its 95% CI, and
 * five secondary metrics right-aligned in one nowrap row that wraps as a unit. While a result is
 * pinned, every figure carries the change against the pinned one beneath it.
 *
 * It is a widget (so it takes part in the rearrangeable dashboard) but renders flush — no card
 * chrome, no widget title; see HEADLESS in Dashboard.tsx.
 */
export function SummaryTiles({ scenario, result, running, pinned, idle, onContext }: WidgetProps) {
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
    { k: t("hero.slain"), v: now ? fmt(now.slain, 1) : dash, d: delta((h) => h.slain, (x) => fmt(x, 1)), title: t("hero.slain.title") },
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
  /*
   * What sits beside the figure: the confidence interval while there is a result, and otherwise why
   * there is none.
   *
   * The reason shares the figure's line rather than taking one of its own. It appears only when
   * there is no figure to read, so a line of its own made the panel taller in the one state with
   * the least in it, and the dashboard gives every panel a fixed height — the hero's was 130px
   * against the 157px two lines of reason needed, so the sentence was cut in half and the panel had
   * to be scrolled to finish reading it. On this line it costs no height at all. It also replaces
   * "no result" here, which it already says itself.
   */
  const ci = result?.ciHalfWidth;
  const note = ci !== undefined ? t("hero.ci", { v: fmt(ci, 2) }) : result ? "" : running ? t("results.running") : idle ? t(IDLE_MESSAGE[idle]) : t("hero.noResult");
  return (
    <div className="hero" aria-live="polite">
      <div className="hero-lead">
        <div className="hero-eyebrow">
          {t("hero.expectedDamage")}
          {result ? <MatchupMark grade={matchupOf(result)} label /> : null}
        </div>
        <div className="hero-value-row">
          <span className="hero-value">{now ? fmt(now.expectedDamage, 1) : dash}</span>
          {/* The exact backend has no confidence interval; the backend and timing live in the dock.
              The one place the reason for an empty result is written — the panels below say only
              that there is no result. */}
          <span className={`hero-ci ${idle && !result ? "hero-why" : ""}`.trim()} {...(ci !== undefined ? { title: t("hero.ci.title", { v: fmt(ci, 2) }) } : {})}>{note}</span>
        </div>
        {heroDelta !== undefined ? (
          <div className="hero-delta mono" title={t("hero.pinDelta.title")}>
            {t("hero.vsPinned", { v: heroDelta })}
          </div>
        ) : null}
      </div>
      {/* The controls and the tiles are one column down the right of the panel, so they take the
          same width and line up on both edges. The situation is up here rather than down the dock
          because these are the controls somebody changes most, and the phase alone decides whether
          there is a result at all. Only the calculator passes the setter. */}
      <div className="hero-side">
        {onContext ? <SituationBar context={scenario.context} onContext={onContext} /> : null}
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
    </div>
  );
}

export const summaryTilesWidget = defineWidget({
  id: "core.summary",
  title: t("widget.summary"),
  description: t("widget.summary.desc"),
  inputs: ["result"],
  /*
   * Four rows is 130px, against the 121px the panel draws: the 68px figure on the left, and the
   * controls over the tiles on the right. The same height covers every state, because the reason
   * for an empty result shares the figure's line rather than adding one of its own. Before that it
   * took a line of its own and needed 157px in this same 130px panel, which is why the sentence was
   * cut in half and the panel had to be scrolled to read it.
   *
   * The minimum matches the default, so no stored layout can leave the panel shorter than what it
   * draws (see reconcile in Dashboard.tsx).
   */
  defaultSize: { w: 12, h: 4 },
  minSize: { w: 8, h: 4 },
  render: SummaryTiles,
});
