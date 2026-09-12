import type { Phase, Side } from "../../lib/game";
import type { I18nKey } from "../../i18n";

/** The shared vocabulary of the play screen, so every panel names a phase the same way. */
export const PHASE_LABEL: Record<Phase, I18nKey> = {
  command: "play.phase.command",
  movement: "play.phase.movement",
  shooting: "play.phase.shooting",
  charge: "play.phase.charge",
  fight: "play.phase.fight",
  end: "play.phase.end",
};

export const SIDE_LABEL: Record<Side, I18nKey> = { you: "play.side.you", them: "play.side.them" };

/**
 * Stratagem phase names come from the imported data as free text, so matching them to the tracked
 * phase is a substring test rather than a lookup. "Your Shooting phase" matches shooting.
 */
export function stratagemMatchesPhase(phases: readonly string[], phase: Phase): boolean {
  if (phases.length === 0) return true;
  const want = phase === "end" ? "end" : phase;
  return phases.some((p) => {
    const text = p.toLowerCase();
    return text.includes(want) || text.includes("any");
  });
}
