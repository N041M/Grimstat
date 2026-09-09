import { Scenario, ScenarioContext, type ScenarioUnit, type ScenarioModel, type ScenarioWeapon, type ManualToggle } from "@grimstat/schema";
import { archetypes, gameSystem } from "@grimstat/game-40k-11e";
import { newId, nowIso } from "./ids";

export type Side = "attacker" | "defender";

export function defaultContext(): Scenario["context"] {
  return ScenarioContext.parse({});
}

export function emptyUnit(name: string): ScenarioUnit {
  return { name, keywords: [], models: [], weapons: [], effects: [] };
}

export function cloneUnit(u: ScenarioUnit): ScenarioUnit {
  return JSON.parse(JSON.stringify(u)) as ScenarioUnit;
}

export function archetypeUnit(id: string): ScenarioUnit | undefined {
  const a = archetypes.find((x) => x.id === id);
  return a ? cloneUnit(a.unit) : undefined;
}

export function newScenario(partial: Partial<Scenario> = {}): Scenario {
  const now = nowIso();
  const attacker = partial.attacker ?? archetypeUnit("bolter-squad") ?? emptyUnit("Attacker");
  const defender = partial.defender ?? archetypeUnit("marine-like") ?? emptyUnit("Defender");
  return Scenario.parse({
    id: newId("sc"),
    name: "Untitled scenario",
    gameSystemId: gameSystem.id,
    ownerId: "local",
    createdAt: now,
    updatedAt: now,
    revision: 0,
    attacker,
    defender,
    context: defaultContext(),
    enabledToggles: [],
    extraEffects: [],
    ...partial,
  });
}

export function defaultModel(): ScenarioModel {
  return { name: "Model", count: 1, T: 4, Sv: 3, InvSv: null, W: 2, fnp: null, isCharacter: false, keywords: [] };
}

export function defaultWeapon(kind: ScenarioWeapon["kind"] = "ranged"): ScenarioWeapon {
  return { name: kind === "ranged" ? "Weapon" : "Melee weapon", count: 1, kind, range: kind === "ranged" ? 24 : null, A: "1", skill: 3, S: 4, AP: 0, D: "1", keywords: [], enabled: true };
}

/** Toggle state resolution: "-id" disables a default-on toggle, "id" enables a default-off one. */
export function isToggleOn(toggle: ManualToggle, enabledToggles: string[]): boolean {
  if (enabledToggles.includes(`-${toggle.id}`)) return false;
  if (enabledToggles.includes(toggle.id)) return true;
  return toggle.defaultOn;
}

export function setToggle(enabledToggles: string[], toggle: ManualToggle, on: boolean): string[] {
  const without = enabledToggles.filter((x) => x !== toggle.id && x !== `-${toggle.id}`);
  if (on === toggle.defaultOn) return without;
  return [...without, on ? toggle.id : `-${toggle.id}`];
}

/** A unit's total model count. */
export function modelCount(u: ScenarioUnit): number {
  return u.models.reduce((s, m) => s + m.count, 0);
}

export function touch(s: Scenario): Scenario {
  return { ...s, updatedAt: nowIso(), revision: s.revision + 1 };
}

/** Strip transient noise before persisting/sharing (keeps the schema-valid shape). */
export function forStorage(s: Scenario): Scenario {
  return Scenario.parse(s);
}
