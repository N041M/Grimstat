import { useMemo } from "react";
import type { CoverageReport } from "@grimstat/schema";
import { coverageFor } from "@grimstat/game-40k-11e";
import { defineWidget, type WidgetProps } from "./registry";
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
          <span className="sw" style={{ background: "var(--ok)" }} />
          {t("coverage.tier1", { n: c.tier1 })}
        </span>
        <span>
          <span className="sw" style={{ background: "var(--brass)" }} />
          {t("coverage.tier2", { n: c.tier2 })}
        </span>
        <span>
          <span className="sw" style={{ background: "var(--danger)" }} />
          {t("coverage.tier3", { n: c.tier3 })}
        </span>
      </div>
    </div>
  );
}

export function CoverageMeter({ scenario, snapshot, result }: WidgetProps) {
  const sides = useMemo(
    () => ({
      attacker: coverageFor(scenario.attacker, snapshot),
      defender: coverageFor(scenario.defender, snapshot),
    }),
    [scenario.attacker, scenario.defender, snapshot],
  );
  const total: CoverageReport = result?.coverage ?? {
    tier1: sides.attacker.tier1 + sides.defender.tier1,
    tier2: sides.attacker.tier2 + sides.defender.tier2,
    tier3: sides.attacker.tier3 + sides.defender.tier3,
    unmodelled: [...new Set([...sides.attacker.unmodelled, ...sides.defender.unmodelled])],
  };
  const all = total.tier1 + total.tier2 + total.tier3;
  return (
    <div className="stack">
      <Meter c={total} label={t("coverage.total")} />
      <div className="grid-2">
        <Meter c={sides.attacker} label={t("side.attacker")} />
        <Meter c={sides.defender} label={t("side.defender")} />
      </div>
      {total.unmodelled.length ? (
        <div>
          <div className="small muted">{t("coverage.unmodelled")}</div>
          <ul className="small" style={{ margin: "0.25rem 0 0", paddingLeft: "1.2rem" }}>
            {total.unmodelled.map((u) => (
              <li key={u}>{u}</li>
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
  defaultSize: { w: 4, h: 6 },
  render: CoverageMeter,
});
