import { useMemo } from "react";
import type { ManualToggle, Scenario, Snapshot } from "@grimstat/schema";
import { gameApi } from "../plugin";
import { isToggleOn, setToggle } from "../lib/scenario";
import { Switch } from "./ui";
import { t } from "../i18n";

const isAbility = (tg: ManualToggle) => tg.id.startsWith("ability:");

function Group({ title, toggles, enabled, onChange }: { title: string; toggles: ManualToggle[]; enabled: string[]; onChange: (next: string[]) => void }) {
  if (!toggles.length) return null;
  return (
    <div className="toggle-group">
      <h4>{title}</h4>
      {toggles.map((tg) => (
        <Switch key={tg.id} label={tg.label} description={tg.description} checked={isToggleOn(tg, enabled)} onChange={(on) => onChange(setToggle(enabled, tg, on))} />
      ))}
    </div>
  );
}

export function TogglesPanel({ scenario, snapshot, onChange }: { scenario: Scenario; snapshot: Snapshot | undefined; onChange: (enabledToggles: string[]) => void }) {
  const toggles = useMemo(() => gameApi().listToggles(scenario, snapshot), [scenario, snapshot]);
  const groups = useMemo(
    () => ({
      attAbility: toggles.filter((x) => x.side === "attacker" && isAbility(x)),
      attGeneric: toggles.filter((x) => x.side === "attacker" && !isAbility(x)),
      defAbility: toggles.filter((x) => x.side === "defender" && isAbility(x)),
      defGeneric: toggles.filter((x) => x.side === "defender" && !isAbility(x)),
    }),
    [toggles],
  );
  const enabled = scenario.enabledToggles;
  return (
    <div className="toggle-groups">
      <div>
        <Group title={t("toggles.attackerAbilities")} toggles={groups.attAbility} enabled={enabled} onChange={onChange} />
        <Group title={t("toggles.attackerGeneric")} toggles={groups.attGeneric} enabled={enabled} onChange={onChange} />
      </div>
      <div>
        <Group title={t("toggles.defenderAbilities")} toggles={groups.defAbility} enabled={enabled} onChange={onChange} />
        <Group title={t("toggles.defenderGeneric")} toggles={groups.defGeneric} enabled={enabled} onChange={onChange} />
      </div>
    </div>
  );
}
