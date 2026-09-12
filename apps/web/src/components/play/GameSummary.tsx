import { useMemo } from "react";
import { summarise, totalsFor, type Side } from "../../lib/game";
import { fmt, fmtInt } from "../../lib/format";
import { GridCell, GridHead, GridHeadCell, GridRow, GridTable, PanelHead } from "../kit";
import { Empty } from "../ui";
import { SIDE_LABEL } from "./labels";
import type { PlayContext } from "./types";
import { t, tn } from "../../i18n";

const COLUMNS = "60px repeat(3, 1fr)";

/**
 * How the game went, read back from the log rather than tracked separately: wounds dealt per round,
 * command points spent, and the score as it moved.
 *
 * The estimates block is the one thing no other tracker can show. Whenever the odds panel's figure
 * was accepted, the log kept both what the solver expected and what was actually applied, so a game
 * says how well the maths matched the dice.
 */
export function GameSummary({ ctx }: { ctx: PlayContext }) {
  const { state, log } = ctx.game;
  const sum = useMemo(() => summarise(log, state), [log, state]);
  const mine = totalsFor(state.you, state.secondaries);
  const theirs = totalsFor(state.them, state.secondaries);

  const unitName = (id: string | undefined): string | undefined => {
    if (!id) return undefined;
    return ctx.mine.find((u) => u.id === id)?.unit.name ?? ctx.foes.find((f) => f.id === id)?.foe.name;
  };

  const estimates = sum.estimates;
  const drift = estimates.length ? estimates.reduce((s, e) => s + (e.actual - e.predicted), 0) / estimates.length : undefined;

  if (log.length === 0) {
    return (
      <div className="play-summary">
        <Empty>{t("play.summary.empty")}</Empty>
      </div>
    );
  }

  const side = (s: Side) => t(SIDE_LABEL[s]);

  return (
    <div className="play-summary">
      <PanelHead title={t("play.summary.title")} aside={<span className="t-meta">{t("play.summary.final", { you: fmtInt(mine.total), them: fmtInt(theirs.total) })}</span>} />

      <div className="sum-tiles">
        <div className="sum-tile">
          <div className="sum-tile-k">{t("play.summary.dealt", { side: side("you") })}</div>
          <div className="sum-tile-v">{fmtInt(sum.dealt.you)}</div>
        </div>
        <div className="sum-tile">
          <div className="sum-tile-k">{t("play.summary.dealt", { side: side("them") })}</div>
          <div className="sum-tile-v">{fmtInt(sum.dealt.them)}</div>
        </div>
        <div className="sum-tile">
          <div className="sum-tile-k">{t("play.summary.cpSpent")}</div>
          <div className="sum-tile-v">{fmtInt(sum.cpSpent.you)}</div>
        </div>
      </div>

      <GridTable columns={COLUMNS} label={t("play.summary.byRound")} className="sum-table">
        <GridHead>
          <GridHeadCell>{t("play.summary.round")}</GridHeadCell>
          <GridHeadCell align="end">{t("play.summary.woundsYou")}</GridHeadCell>
          <GridHeadCell align="end">{t("play.summary.woundsThem")}</GridHeadCell>
          <GridHeadCell align="end">{t("play.summary.score")}</GridHeadCell>
        </GridHead>
        {sum.rounds.map((r) => (
          <GridRow key={r.round}>
            <GridCell mono tone="muted">
              {r.round}
            </GridCell>
            <GridCell align="end" mono>
              {fmtInt(r.dealt.you)}
            </GridCell>
            <GridCell align="end" mono>
              {fmtInt(r.dealt.them)}
            </GridCell>
            <GridCell align="end" mono tone="faint">
              {fmtInt(r.scored.you)} – {fmtInt(r.scored.them)}
            </GridCell>
          </GridRow>
        ))}
      </GridTable>

      <section className="sum-estimates" aria-labelledby="sum-est-h">
        <PanelHead id="sum-est-h" title={t("play.summary.estimates")} aside={<span className="t-meta">{tn(estimates.length, "play.summary.estimateCount.one", "play.summary.estimateCount.many", { n: estimates.length })}</span>} />
        {estimates.length === 0 ? (
          <p className="data-note">{t("play.summary.noEstimates")}</p>
        ) : (
          <>
            <p className="data-note">{drift !== undefined && drift >= 0 ? t("play.summary.driftOver", { v: fmt(Math.abs(drift), 1) }) : t("play.summary.driftUnder", { v: fmt(Math.abs(drift ?? 0), 1) })}</p>
            <ul className="sum-est-list">
              {estimates.map((e, i) => (
                <li key={i}>
                  <span className="sum-est-name">{unitName(e.unitId) ?? t("play.summary.unknownUnit")}</span>
                  <span className="sum-est-v mono">{t("play.summary.estimateLine", { predicted: fmt(e.predicted, 1), actual: fmtInt(e.actual) })}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}
