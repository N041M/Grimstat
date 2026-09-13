import { describe, expect, it } from "vitest";
import type { ScenarioUnit } from "@grimstat/schema";
import { defaultContext, defaultModel, defaultWeapon, emptyUnit, newScenario } from "../lib/scenario";
import { idleReason } from "./useSimulation";

const attacker = (kinds: Array<"ranged" | "melee">): ScenarioUnit => ({ ...emptyUnit("Attacker"), models: [defaultModel()], weapons: kinds.map((k) => defaultWeapon(k)) });
const defender = (): ScenarioUnit => ({ ...emptyUnit("Defender"), models: [defaultModel()] });
const scenario = (unit: ScenarioUnit, phase: "shooting" | "fight") => newScenario({ attacker: unit, defender: defender(), context: { ...defaultContext(), phase } });

describe("idleReason", () => {
  it("names the phase when the attacker's weapons are of the other kind", () => {
    expect(idleReason(scenario(attacker(["melee"]), "shooting"))).toBe("melee-only");
    expect(idleReason(scenario(attacker(["melee"]), "fight"))).toBeUndefined();
    expect(idleReason(scenario(attacker(["ranged"]), "fight"))).toBe("ranged-only");
    expect(idleReason(scenario(attacker(["ranged"]), "shooting"))).toBeUndefined();
  });

  it("a unit carrying both kinds runs in either phase", () => {
    const both = attacker(["ranged", "melee"]);
    expect(idleReason(scenario(both, "shooting"))).toBeUndefined();
    expect(idleReason(scenario(both, "fight"))).toBeUndefined();
  });

  it("a weapon switched off does not keep the phase alive", () => {
    const off = attacker(["ranged", "melee"]);
    off.weapons[0]!.enabled = false;
    expect(idleReason(scenario(off, "shooting"))).toBe("melee-only");
    off.weapons[0]!.enabled = true;
    off.weapons[1]!.count = 0;
    expect(idleReason(scenario(off, "fight"))).toBe("ranged-only");
  });

  it("nothing to attack with, or nothing to attack, still come first", () => {
    expect(idleReason(scenario(emptyUnit("Attacker"), "fight"))).toBe("no-weapons");
    expect(idleReason(newScenario({ attacker: attacker(["melee"]), defender: emptyUnit("Defender"), context: { ...defaultContext(), phase: "shooting" } }))).toBe("no-models");
  });
});
