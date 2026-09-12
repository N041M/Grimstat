import { PHASES, type Phase } from "../../lib/game";
import { PHASE_LABEL } from "./labels";
import type { PlayContext } from "./types";
import { t } from "../../i18n";

/**
 * The phase sequence, with the current one marked. Tapping a phase jumps straight to it, because a
 * game does not always run in order and correcting a mis-tap has to be one action. The next control
 * is the one used most, so it is also in the phone bar.
 */
export function PhaseStrip({ ctx, onNext }: { ctx: PlayContext; onNext: () => void }) {
  const { state, dispatch } = ctx.game;

  const jump = (phase: Phase) => {
    if (phase === state.phase) return;
    dispatch({ kind: "setPhase", phase }, "phase", t("play.log.setPhase", { phase: t(PHASE_LABEL[phase]) }));
  };

  return (
    <nav className="play-phases" aria-label={t("play.phases")}>
      <ol className="ph-list">
        {PHASES.map((p) => (
          <li key={p}>
            <button type="button" className={`ph-step ${p === state.phase ? "on" : ""}`.trim()} aria-current={p === state.phase ? "step" : undefined} onClick={() => jump(p)}>
              {t(PHASE_LABEL[p])}
            </button>
          </li>
        ))}
      </ol>
      <button type="button" className="ph-next" onClick={onNext}>
        {t("play.nextPhase")}
      </button>
    </nav>
  );
}
