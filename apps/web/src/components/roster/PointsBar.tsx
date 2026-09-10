import type { PointsBarModel } from "../../lib/pointsBar";
import { fmtInt } from "../../lib/format";
import { t, type I18nKey } from "../../i18n";

/** Points read as bare digits here ("1955 / 2000"); thousands separators break the 13px line. */
const n = (v: number) => String(Math.round(v));

const SECTION_KEY: Record<string, I18nKey> = {
  character: "roster.section.character",
  battleline: "roster.section.battleline",
  transport: "roster.section.transport",
  other: "roster.section.other",
  allied: "roster.section.allied",
};

/**
 * The army's points as one 8px track segmented by role, then "1955 / 2000" and the spare points.
 * Each segment carries a `title` so the roles are readable without a legend.
 */
export function PointsBar({ model }: { model: PointsBarModel }) {
  const over = model.over > 0;
  return (
    <div className="points-bar">
      <div className="points-track" role="img" aria-label={t("roster.meter.aria", { points: fmtInt(model.total), limit: fmtInt(model.limit) })}>
        {model.segments.map((s) => (
          <span key={s.section} className={`points-seg tone-${s.tone}`} style={{ width: `${s.fraction * 100}%` }} title={t("roster.points.segment", { role: t(SECTION_KEY[s.section] ?? "roster.section.other"), points: n(s.points) })} />
        ))}
      </div>
      <span className={`points-total ${over ? "over" : ""}`.trim()}>
        {n(model.total)} / {n(model.limit)}
      </span>
      <span className={`points-spare ${over ? "over" : ""}`.trim()}>{over ? t("roster.points.over", { n: n(model.over) }) : t("roster.points.spare", { n: n(model.spare) })}</span>
    </div>
  );
}
