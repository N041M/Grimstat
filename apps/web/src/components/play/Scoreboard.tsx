import { FINAL_ROUND, totalsFor, type Side } from "../../lib/game";
import { fmtInt } from "../../lib/format";
import { SIDE_LABEL } from "./labels";
import type { PlayContext } from "./types";
import { t } from "../../i18n";

/**
 * The strip that stays on screen for the whole game: which round it is, whose turn, both scores and
 * the player's command points. It is the thing glanced at between dice rolls, so every figure is
 * large and every control is a thumb-sized tap.
 */
export function Scoreboard({ ctx }: { ctx: PlayContext }) {
  const { state, dispatch } = ctx.game;
  const mine = totalsFor(state.you, state.secondaries);
  const theirs = totalsFor(state.them, state.secondaries);

  const cp = (delta: number) => {
    dispatch({ kind: "cp", side: "you", delta }, "cp", delta > 0 ? t("play.log.cpGain", { n: delta }) : t("play.log.cpSpend", { n: Math.abs(delta) }));
  };

  const score = (side: Side, total: number) => (
    <div className={`sb-score ${side === "you" ? "mine" : "theirs"} ${total > (side === "you" ? theirs.total : mine.total) ? "ahead" : ""}`.trim()}>
      <div className="sb-score-k">{t(SIDE_LABEL[side])}</div>
      <div className="sb-score-v">{fmtInt(total)}</div>
    </div>
  );

  return (
    <header className="play-scoreboard">
      <div className="sb-rounds" role="group" aria-label={t("play.round.aria")}>
        {Array.from({ length: Math.max(FINAL_ROUND, state.round) }, (_, i) => i + 1).map((r) => (
          <span key={r} className={`sb-pip ${r === state.round ? "on" : ""} ${r < state.round ? "past" : ""}`.trim()} aria-current={r === state.round ? "true" : undefined}>
            {r}
          </span>
        ))}
        <span className="sb-turn">{state.active === "you" ? t("play.turn.yours") : t("play.turn.theirs")}</span>
      </div>

      <div className="sb-scores">
        {score("you", mine.total)}
        <span className="sb-dash" aria-hidden="true">
          –
        </span>
        {score("them", theirs.total)}
      </div>

      <div className="sb-cp">
        <button type="button" className="sb-cp-btn" onClick={() => cp(-1)} disabled={state.you.cp === 0} aria-label={t("play.cp.spend")}>
          −
        </button>
        <span className="sb-cp-value">
          <span className="sb-cp-n">{fmtInt(state.you.cp)}</span>
          <span className="sb-cp-k">{t("play.cp.label")}</span>
        </span>
        <button type="button" className="sb-cp-btn" onClick={() => cp(1)} aria-label={t("play.cp.gain")}>
          +
        </button>
      </div>
    </header>
  );
}
