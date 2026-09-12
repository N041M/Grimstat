import { attachmentLine, hasAttached, type MaybeAttached } from "../lib/attachment";
import { UnitArt } from "./UnitArt";

/**
 * Who is leading this unit, as its own line under the unit's name.
 *
 * Deliberately not a parenthesis after the name. A led squad is two things a player tracks at once —
 * the squad and the character in it — and the name is already the longest string on most of these
 * rows, so a suffix is the first thing to be truncated away. Its own line with the character mark
 * in front of it survives a narrow column and reads at a glance across a table.
 *
 * Renders nothing when nothing is attached, so it can be dropped into any unit row unconditionally.
 */
export function Attached({ unit, className }: { unit: MaybeAttached; className?: string }) {
  if (!hasAttached(unit)) return null;
  const line = attachmentLine(unit);
  if (!line) return null;
  return (
    <span className={`attached ${className ?? ""}`.trim()}>
      <UnitArt id="character" className="attached-mark" />
      <span className="attached-text">{line}</span>
    </span>
  );
}
