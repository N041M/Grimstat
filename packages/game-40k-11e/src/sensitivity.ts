import type { Scenario, ScenarioContext, Snapshot } from "@grimstat/schema";
import { runScenario } from "./scenario";
import { CH } from "./channels";

/** What-if analysis: re-run the scenario under one change at a time and report the deltas. */
export interface SensitivityVariantDef {
  id: string;
  label: string;
  side: "attacker" | "defender";
  toggles?: string[];
  context?: Partial<ScenarioContext>;
}

export const SENSITIVITY_VARIANTS: SensitivityVariantDef[] = [
  { id: "plus1-hit", label: "+1 to hit", side: "attacker", toggles: ["plus1-hit"] },
  { id: "plus1-wound", label: "+1 to wound", side: "attacker", toggles: ["plus1-wound"] },
  { id: "plus1-ap", label: "Improve AP by 1", side: "attacker", toggles: ["plus1-ap"] },
  { id: "reroll-hits-ones", label: "Re-roll hit rolls of 1", side: "attacker", toggles: ["reroll-hits-ones"] },
  { id: "reroll-hits", label: "Re-roll all failed hits", side: "attacker", toggles: ["reroll-hits"] },
  { id: "reroll-wounds-ones", label: "Re-roll wound rolls of 1", side: "attacker", toggles: ["reroll-wounds-ones"] },
  { id: "reroll-wounds", label: "Re-roll all failed wounds", side: "attacker", toggles: ["reroll-wounds"] },
  { id: "lethal-all", label: "Lethal Hits", side: "attacker", toggles: ["lethal-all"] },
  { id: "sustained-all", label: "Sustained Hits 1", side: "attacker", toggles: ["sustained-all"] },
  { id: "dev-all", label: "Devastating Wounds", side: "attacker", toggles: ["dev-all"] },
  { id: "crit5", label: "Critical hits on 5+", side: "attacker", toggles: ["crit5"] },
  { id: "cmd-reroll-hit", label: "Command Re-roll (hit)", side: "attacker", toggles: ["cmd-reroll-hit"] },
  { id: "half-range", label: "Within half range", side: "attacker", context: { rangeBand: "half" } },
  { id: "charged", label: "Charged this turn", side: "attacker", context: { charged: true } },
  { id: "stationary", label: "Remained stationary", side: "attacker", context: { stationary: true } },
  { id: "minus1-hit", label: "-1 to be hit", side: "defender", toggles: ["minus1-hit"] },
  { id: "minus1-wound", label: "-1 to be wounded", side: "defender", toggles: ["minus1-wound"] },
  { id: "minus1-dmg", label: "-1 Damage", side: "defender", toggles: ["minus1-dmg"] },
  { id: "half-dmg", label: "Halve Damage", side: "defender", toggles: ["half-dmg"] },
  { id: "ap-worse", label: "Worsen AP by 1", side: "defender", toggles: ["ap-worse"] },
  { id: "fnp5", label: "Feel No Pain 5+", side: "defender", toggles: ["fnp5"] },
  { id: "fnp6", label: "Feel No Pain 6+", side: "defender", toggles: ["fnp6"] },
  { id: "inv4", label: "4+ invulnerable", side: "defender", toggles: ["inv4"] },
  { id: "inv5", label: "5+ invulnerable", side: "defender", toggles: ["inv5"] },
  { id: "cover", label: "Benefit of cover", side: "defender", context: { inCover: true } },
  { id: "snap", label: "Snap shooting", side: "defender", context: { snapShooting: true } },
];

export interface SensitivityVariant {
  id: string;
  label: string;
  side: "attacker" | "defender";
  expectedDamage: number;
  expectedSlain: number;
  pKill: number;
  deltaDamage: number;
  deltaSlain: number;
  deltaPKill: number;
}

export interface SensitivityResult {
  base: { expectedDamage: number; expectedSlain: number; pKill: number };
  variants: SensitivityVariant[];
}

export function sensitivity(scenario: Scenario, opts: { snapshot?: Snapshot; variantIds?: string[] } = {}): SensitivityResult {
  const base = runScenario(scenario, { snapshot: opts.snapshot });
  const defs = opts.variantIds ? SENSITIVITY_VARIANTS.filter((v) => opts.variantIds!.includes(v.id)) : SENSITIVITY_VARIANTS;
  const variants = defs.map((v) => {
    const s: Scenario = {
      ...scenario,
      context: { ...scenario.context, ...(v.context ?? {}) },
      enabledToggles: [...scenario.enabledToggles, ...(v.toggles ?? [])],
    };
    const r = runScenario(s, { snapshot: opts.snapshot });
    return {
      id: v.id,
      label: v.label,
      side: v.side,
      expectedDamage: r.expectedDamage,
      expectedSlain: r.expectedSlain,
      pKill: r.pKill,
      deltaDamage: r.expectedDamage - base.expectedDamage,
      deltaSlain: r.expectedSlain - base.expectedSlain,
      deltaPKill: r.pKill - base.pKill,
    };
  });
  return { base: { expectedDamage: base.expectedDamage, expectedSlain: base.expectedSlain, pKill: base.pKill }, variants };
}

/** Human labels for effect-record targets (for override editors). */
export const CHANNEL_INFO: Array<{ channel: string; label: string; kind: "number" | "flag" | "reroll" | "threshold" }> = [
  { channel: CH.attacks, label: "Attacks (+/−)", kind: "number" },
  { channel: CH.skill, label: "BS/WS penalty (+1 = one worse, uncapped)", kind: "number" },
  { channel: CH.hitRoll, label: "Hit roll modifier (capped ±1)", kind: "number" },
  { channel: CH.critHit, label: "Critical hit threshold (cap, e.g. 5)", kind: "threshold" },
  { channel: CH.rerollHit, label: "Re-roll hits", kind: "reroll" },
  { channel: CH.strength, label: "Strength (+/−)", kind: "number" },
  { channel: CH.toughness, label: "Toughness of the target (+/−)", kind: "number" },
  { channel: CH.woundRoll, label: "Wound roll modifier (capped ±1)", kind: "number" },
  { channel: CH.critWound, label: "Critical wound threshold (cap, e.g. 4)", kind: "threshold" },
  { channel: CH.rerollWound, label: "Re-roll wounds", kind: "reroll" },
  { channel: CH.ap, label: "AP (+1 = better)", kind: "number" },
  { channel: CH.saveRoll, label: "Save roll modifier (capped ±1)", kind: "number" },
  { channel: CH.save, label: "Armour save stat (+1 = worse)", kind: "number" },
  { channel: CH.invuln, label: "Invulnerable save (cap, e.g. 4)", kind: "threshold" },
  { channel: CH.rerollSave, label: "Re-roll saves", kind: "reroll" },
  { channel: CH.damage, label: "Damage (+/−, ×, cap)", kind: "number" },
  { channel: CH.fnp, label: "Feel No Pain (set, e.g. 5)", kind: "threshold" },
  { channel: CH.sustained, label: "Sustained Hits (set X or dice)", kind: "number" },
  { channel: CH.autoHit, label: "Automatically hits (Torrent)", kind: "flag" },
  { channel: CH.lethal, label: "Lethal Hits", kind: "flag" },
  { channel: CH.devastating, label: "Devastating Wounds", kind: "flag" },
  { channel: CH.precision, label: "Precision", kind: "flag" },
  { channel: CH.ignoresCover, label: "Ignores Cover", kind: "flag" },
  { channel: CH.psychic, label: "Psychic (ignores hit penalties)", kind: "flag" },
  { channel: CH.indirect, label: "Indirect Fire", kind: "flag" },
  { channel: CH.hazardous, label: "Hazardous", kind: "flag" },
  { channel: CH.stealth, label: "Stealth / benefit of cover", kind: "flag" },
];
