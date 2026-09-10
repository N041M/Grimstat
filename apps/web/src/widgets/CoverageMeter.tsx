import { useMemo } from "react";
import type { CoverageReport, Snapshot } from "@grimstat/schema";
import { coverageFor } from "@grimstat/game-40k-11e";
import { defineWidget, type WidgetProps } from "./registry";
import { useApp } from "../state/AppContext";
import { hrefFor } from "../router";
import { t } from "../i18n";

function Meter({ c, label }: { c: CoverageReport; label: string }) {
  const total = c.tier1 + c.tier2 + c.tier3;
  const w = (n: number) => (total ? `${(n / total) * 100}%` : "0%");
  return (
    <div className="stack" style={{ gap: "0.3rem" }}>
      <div className="row between small">
        <strong>{label}</strong>
        <span className="muted">{t("coverage.summary", { modelled: c.tier1 + c.tier2, total })}</span>
      </div>
      <div className="meter" role="img" aria-label={t("coverage.aria", { t1: c.tier1, t2: c.tier2, t3: c.tier3 })}>
        <span className="t1" style={{ width: w(c.tier1) }} />
        <span className="t2" style={{ width: w(c.tier2) }} />
        <span className="t3" style={{ width: w(c.tier3) }} />
      </div>
      <div className="chart-legend">
        <span>
          <span className="sw" style={{ background: "var(--good)" }} />
          {t("coverage.tier1", { n: c.tier1 })}
        </span>
        <span>
          <span className="sw" style={{ background: "var(--mid)" }} />
          {t("coverage.tier2", { n: c.tier2 })}
        </span>
        <span>
          <span className="sw" style={{ background: "var(--accent)" }} />
          {t("coverage.tier3", { n: c.tier3 })}
        </span>
      </div>
    </div>
  );
}

/** Ability names the user marked as "no combat effect" (an override with an explicit empty effect list). */
function noEffectNames(snapshot: Snapshot | undefined): Set<string> {
  const out = new Set<string>();
  for (const a of snapshot?.data.abilities ?? []) if (Array.isArray(a.effects) && a.effects.length === 0) out.add(a.name);
  return out;
}

/**
 * The engine still files an ability with an explicit empty effect list under tier 3 (see NOTES.md); treat it as
 * tier 1 here ("no effect on the attack sequence"), like the core no-op keywords.
 */
function reclassify(c: CoverageReport, none: Set<string>): { report: CoverageReport; marked: number } {
  const marked = c.unmodelled.filter((u) => none.has(u));
  if (!marked.length) return { report: c, marked: 0 };
  return { report: { tier1: c.tier1 + marked.length, tier2: c.tier2, tier3: Math.max(0, c.tier3 - marked.length), unmodelled: c.unmodelled.filter((u) => !none.has(u)) }, marked: marked.length };
}

export function CoverageMeter({ scenario, snapshot, result }: WidgetProps) {
  const { overrides, overrideStatus } = useApp();
  const none = useMemo(() => noEffectNames(snapshot), [snapshot]);
  const abilityNames = useMemo(() => new Set((snapshot?.data.abilities ?? []).map((a) => a.name)), [snapshot]);
  const sides = useMemo(
    () => ({
      attacker: reclassify(coverageFor(scenario.attacker, snapshot), none).report,
      defender: reclassify(coverageFor(scenario.defender, snapshot), none).report,
    }),
    [scenario.attacker, scenario.defender, snapshot, none],
  );
  const raw: CoverageReport = result?.coverage ?? {
    tier1: sides.attacker.tier1 + sides.defender.tier1,
    tier2: sides.attacker.tier2 + sides.defender.tier2,
    tier3: sides.attacker.tier3 + sides.defender.tier3,
    unmodelled: [...new Set([...sides.attacker.unmodelled, ...sides.defender.unmodelled])],
  };
  const { report: total, marked } = reclassify({ ...raw, unmodelled: [...new Set(raw.unmodelled)] }, none);
  const all = total.tier1 + total.tier2 + total.tier3;
  return (
    <div className="stack">
      {overrides.length ? (
        <div className="row small">
          <span className="badge accent">{t("coverage.overridesApplied", { n: overrideStatus.applied })}</span>
          {marked ? <span className="muted">{t("coverage.markedNone", { n: marked })}</span> : null}
        </div>
      ) : null}
      <Meter c={total} label={t("coverage.total")} />
      <div className="grid-2">
        <Meter c={sides.attacker} label={t("side.attacker")} />
        <Meter c={sides.defender} label={t("side.defender")} />
      </div>
      {total.unmodelled.length ? (
        <div>
          <div className="small muted">{t("coverage.unmodelled")}</div>
          <ul className="small unmodelled-list" style={{ margin: "0.25rem 0 0", paddingLeft: "1.2rem" }}>
            {total.unmodelled.map((u) => (
              <li key={u}>
                <span>{u}</span>
                {abilityNames.has(u) ? (
                  <>
                    {" "}
                    <a href={`${hrefFor("data", "overrides")}?q=${encodeURIComponent(u)}`}>{t("coverage.override")}</a>
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <p className="small muted" style={{ margin: 0 }}>
        {all === 0 ? t("coverage.hint.none") : total.tier3 > 0 ? t("coverage.hint.some", { n: total.tier3 }) : t("coverage.hint.full")}
      </p>
    </div>
  );
}

export const coverageMeterWidget = defineWidget({
  id: "core.coverage",
  title: t("widget.coverage"),
  description: t("widget.coverage.desc"),
  inputs: ["scenario", "result", "snapshot"],
  defaultSize: { w: 6, h: 9 },
  minSize: { w: 4, h: 5 },
  render: CoverageMeter,
});
