import { Icon, type IconName } from "./ui";
import { t } from "../i18n";
import type { Matchup } from "../lib/matchup";

/** A tick for a good match-up, a warning triangle for a fair one and a cross for a poor one. */
const ICON: Record<Matchup, IconName> = { good: "check", fair: "warn", poor: "close" };

/**
 * One glyph in one colour for how the attack fares against the unit. The shape carries the reading
 * on its own, so the mark reads the same to someone who cannot tell the colours apart. `label`
 * writes the reading out beside the glyph.
 */
export function MatchupMark({ grade, label, className }: { grade: Matchup; label?: boolean; className?: string }) {
  const name = t(`matchup.${grade}`);
  return (
    <span className={`matchup matchup-${grade} ${className ?? ""}`.trim()} title={t(`matchup.${grade}.title`)} role="img" aria-label={name}>
      <Icon name={ICON[grade]} />
      {label ? <span className="matchup-label">{name}</span> : null}
    </span>
  );
}
