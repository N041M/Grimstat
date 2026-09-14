import type { ScenarioContext } from "@grimstat/schema";
import { PillChip, SelectBox } from "../kit";
import { t } from "../../i18n";

const PHASES = [
  { value: "shooting" as const, label: t("ctx.phase.shooting") },
  { value: "fight" as const, label: t("ctx.phase.fight") },
];

const RANGE_BANDS = [
  { value: "full" as const, label: t("dock.range.full") },
  { value: "half" as const, label: t("dock.range.half") },
];

/**
 * Which phase the numbers are worked out for, and at what range.
 *
 * These two sit above the headline figure rather than down the dock beside it. They are the
 * controls somebody changes most, and the phase alone decides which half of a unit's weapons are
 * read at all, so a reader who has just been told there is no result does not have to look
 * elsewhere for the control that explains it. Everything else about the situation — what each side
 * was doing, the rules toggles, the solver settings — stays in the dock.
 */
export function SituationBar({ context, onContext }: { context: ScenarioContext; onContext: (patch: Partial<ScenarioContext>) => void }) {
  return (
    <div className="situation" role="group" aria-label={t("dock.title")}>
      <div className="situation-field" role="group" aria-label={t("ctx.phase")}>
        <span className="situation-label">{t("dock.phase")}</span>
        <div className="situation-chips">
          {PHASES.map((o) => (
            <PillChip key={o.value} label={o.label} title={t("ctx.phase")} on={context.phase === o.value} onChange={() => onContext({ phase: o.value })} />
          ))}
        </div>
      </div>
      <div className="situation-field situation-range">
        <SelectBox label={t("dock.rangeBand")} title={t("ctx.rangeBand")} value={context.rangeBand} options={RANGE_BANDS} onChange={(rangeBand) => onContext({ rangeBand })} />
      </div>
    </div>
  );
}
