import { useMemo } from "react";
import type { ManualToggle, Scenario, ScenarioContext, Snapshot } from "@grimstat/schema";
import { gameApi } from "../../plugin";
import { isToggleOn, setToggle } from "../../lib/scenario";
import type { SimulationState } from "../../hooks/useSimulation";
import { Dock, DockSection, NumberBox, PillChip, SelectBox, SwitchRow } from "../kit";
import { fmtInt } from "../../lib/format";
import { t, type I18nKey } from "../../i18n";

/** The four booleans of `scenario.context` that are drawn as pill chips. */
const FLAGS: Array<{ key: "charged" | "stationary" | "inCover" | "snapShooting"; label: I18nKey; title: I18nKey }> = [
  { key: "charged", label: "dock.flag.charged", title: "ctx.charged" },
  { key: "stationary", label: "dock.flag.stationary", title: "ctx.stationary" },
  { key: "inCover", label: "dock.flag.inCover", title: "ctx.inCover" },
  { key: "snapShooting", label: "dock.flag.snapShot", title: "ctx.snapShooting" },
];

/** Short, dock-width labels for the select boxes; the full wording stays in the control's `title`. */
function fields(context: ScenarioContext) {
  return {
    rangeBand: [
      { value: "full" as const, label: t("dock.range.full") },
      { value: "half" as const, label: t("dock.range.half") },
    ],
    phase: [
      { value: "shooting" as const, label: t("ctx.phase.shooting") },
      { value: "fight" as const, label: t("ctx.phase.fight") },
    ],
    allocationPolicy: [
      { value: "protect-character" as const, label: t("dock.alloc.protect") },
      { value: "in-order" as const, label: t("dock.alloc.inOrder") },
    ],
    lethalChoice: [
      { value: "auto" as const, label: t("dock.lethal.auto") },
      { value: "always" as const, label: t("dock.lethal.always") },
      { value: "never" as const, label: t("dock.lethal.never") },
    ],
    weaponOrder: [
      { value: "heuristic" as const, label: t("dock.order.heuristic") },
      { value: "listed" as const, label: t("dock.order.listed") },
    ],
    backend: [
      { value: "auto" as const, label: t("ctx.backend.auto") },
      { value: "exact" as const, label: t("ctx.backend.exact") },
      { value: "mc" as const, label: t("dock.backend.mc") },
    ],
    showIterations: context.backend !== "exact",
  };
}

/** "exact · 4 ms", or the pending state while the worker is busy. */
function statusLine(sim: SimulationState): string {
  if (sim.error) return t("results.error");
  if (sim.stale || !sim.result) return t("dock.computing");
  const backend = sim.result.backend === "exact" ? t("results.backend.exact") : t("dock.backend.mcWith", { n: fmtInt(sim.result.iterations) });
  return t("dock.status", { backend, ms: fmtInt(sim.elapsedMs ?? 0) });
}

export function ContextDock({ scenario, snapshot, sim, onContext, onToggles }: { scenario: Scenario; snapshot: Snapshot | undefined; sim: SimulationState; onContext: (patch: Partial<ScenarioContext>) => void; onToggles: (next: string[]) => void }) {
  const ctx = scenario.context;
  const opts = fields(ctx);
  const toggles: ManualToggle[] = useMemo(() => gameApi().listToggles(scenario, snapshot), [scenario, snapshot]);
  const on = toggles.filter((tg) => isToggleOn(tg, scenario.enabledToggles)).length;

  return (
    <Dock label={t("dock.title")} meta={statusLine(sim)}>
      <DockSection className="dock-fields">
        <SelectBox label={t("dock.rangeBand")} title={t("ctx.rangeBand")} value={ctx.rangeBand} options={opts.rangeBand} onChange={(rangeBand) => onContext({ rangeBand })} />
        <SelectBox label={t("dock.phase")} title={t("ctx.phase")} value={ctx.phase} options={opts.phase} onChange={(phase) => onContext({ phase })} />
        <SelectBox label={t("dock.allocation")} title={t("ctx.allocation")} value={ctx.allocationPolicy} options={opts.allocationPolicy} onChange={(allocationPolicy) => onContext({ allocationPolicy })} />
        <SelectBox label={t("dock.lethal")} title={t("ctx.lethal")} value={ctx.lethalChoice} options={opts.lethalChoice} onChange={(lethalChoice) => onContext({ lethalChoice })} />
        <SelectBox label={t("dock.weaponOrder")} title={t("ctx.weaponOrder")} value={ctx.weaponOrder} options={opts.weaponOrder} onChange={(weaponOrder) => onContext({ weaponOrder })} />
        <SelectBox label={t("dock.backend")} title={t("ctx.backend")} value={ctx.backend} options={opts.backend} onChange={(backend) => onContext({ backend })} />
        {opts.showIterations ? <NumberBox label={t("dock.iterations")} title={t("ctx.mcIterations")} value={ctx.mcIterations} min={1000} step={1000} onChange={(v) => onContext({ mcIterations: Math.max(1000, Math.floor(v)) })} /> : null}
      </DockSection>

      <DockSection className="dock-chips">
        {FLAGS.map((f) => (
          <PillChip key={f.key} label={t(f.label)} title={t(f.title)} on={ctx[f.key]} onChange={(v) => onContext({ [f.key]: v } as Partial<ScenarioContext>)} />
        ))}
      </DockSection>

      <DockSection title={t("dock.rules")} count={t("dock.rulesOn", { n: on })} className="dock-toggles">
        {toggles.length === 0 ? <p className="dock-empty">{t("dock.noToggles")}</p> : null}
        {toggles.map((tg) => (
          <SwitchRow
            key={tg.id}
            name={tg.label}
            meta={t("dock.provenance", { source: tg.provenance ?? t("dock.source.manual"), side: t(tg.side === "attacker" ? "side.attacker" : "side.defender").toLowerCase() })}
            title={tg.description ?? tg.label}
            checked={isToggleOn(tg, scenario.enabledToggles)}
            onChange={(v) => onToggles(setToggle(scenario.enabledToggles, tg, v))}
          />
        ))}
      </DockSection>
    </Dock>
  );
}
