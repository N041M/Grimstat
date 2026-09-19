/**
 * Rules the pipeline once read wrongly, each held to the wording the snapshot's own glossary
 * carries. Every case here failed before the reading was corrected.
 */
import { describe, expect, it } from "vitest";
import type { Scenario, ScenarioUnit, ScenarioWeapon } from "@grimstat/schema";
import { PLUGIN_API_VERSION } from "@grimstat/schema";
import { abilityEffects, createGameSystem, RULES_10E, runScenario } from "./index";

// The 10e plugin lives in a package that depends on this one, so its rules are built here instead.
const tenth = createGameSystem({
  manifest: { id: "t", name: "t", version: "0", apiVersion: PLUGIN_API_VERSION, kind: "game-system", entry: "t", trusted: true },
  gameSystem: { id: "wh40k-10e", name: "Warhammer 40,000", edition: "10", costTypes: [{ id: "pts", name: "Points" }] },
  rules: RULES_10E,
});
const runScenario10e = tenth.runScenario;

const close = (a: number, b: number, tol = 1e-9): void => expect(Math.abs(a - b)).toBeLessThanOrEqual(tol);

const unit = (models: ScenarioUnit["models"], weapons: ScenarioWeapon[] = [], keywords: string[] = [], effects: ScenarioUnit["effects"] = []): ScenarioUnit => ({
  name: "u",
  keywords,
  models,
  weapons,
  attached: [],
  effects,
});

const gun = (over: Partial<ScenarioWeapon> = {}): ScenarioWeapon => ({ name: "gun", count: 1, kind: "ranged", range: 24, A: "1", skill: 3, S: 4, AP: 0, D: "1", keywords: [], enabled: true, ...over });

const bodies = (count: number, over: Partial<ScenarioUnit["models"][number]> = {}): ScenarioUnit["models"] => [{ name: "m", count, T: 4, Sv: 4, W: 1, isCharacter: false, keywords: [], ...over }];

function scenario(attacker: ScenarioUnit, defender: ScenarioUnit, ctx: Partial<Scenario["context"]> = {}): Scenario {
  return {
    id: "s",
    ownerId: "local",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    revision: 0,
    name: "t",
    gameSystemId: "wh40k-11e",
    attacker,
    defender,
    context: {
      rangeBand: "full",
      charged: false,
      stationary: false,
      inCover: false,
      snapShooting: false,
      phase: "shooting",
      flags: [],
      allocationPolicy: "protect-character",
      lethalChoice: "auto",
      weaponOrder: "listed",
      mcIterations: 0,
      backend: "exact",
      ...ctx,
    },
    enabledToggles: [],
    extraEffects: [],
  };
}

const damage = (s: Scenario): number => runScenario(s).expectedDamage;

describe("BLAST", () => {
  // "add X additional attack dice for every five models that were in the target unit".
  it("adds its printed value for every five models, not one", () => {
    const target = (): ScenarioUnit => unit(bodies(10));
    const blast = (value?: number): number => damage(scenario(unit([], [gun({ A: "3", keywords: [{ name: "BLAST", ...(value === undefined ? {} : { value }) }] })]), target()));
    const flat = (a: string): number => damage(scenario(unit([], [gun({ A: a })]), target()));
    // Against ten models: bare Blast gathers 3 + 2, Blast 2 gathers 3 + 4, Blast 3 gathers 3 + 6.
    close(blast(), flat("5"));
    close(blast(1), flat("5"));
    close(blast(2), flat("7"));
    close(blast(3), flat("9"));
    expect(blast(2)).toBeGreaterThan(blast());
  });

  it("adds nothing against a unit of fewer than five models", () => {
    const small = unit(bodies(4));
    close(damage(scenario(unit([], [gun({ A: "3", keywords: [{ name: "BLAST", value: 3 }] })]), small)), damage(scenario(unit([], [gun({ A: "3" })]), small)));
  });
});

describe("STEALTH", () => {
  // The glossary: "each time a ranged attack targets that unit, that unit has the benefit of cover
  // against that attack". IGNORES COVER names Stealth as one of the rules it cancels.
  const stealthy = (): ScenarioUnit => unit(bodies(10), [], ["INFANTRY"], [{ when: { stage: "hit", side: "defender" }, op: "flag", target: "stealth-ability", value: true, source: "Stealth" }]);
  const shots = (over: Partial<ScenarioWeapon> = {}): ScenarioUnit => unit([], [gun({ count: 12, A: "1", skill: 3, ...over })]);

  it("gives the target the benefit of cover in the eleventh edition", () => {
    const plain = damage(scenario(shots(), unit(bodies(10), [], ["INFANTRY"])));
    const stealth = damage(scenario(shots(), stealthy()));
    const cover = damage(scenario(shots(), unit(bodies(10), [], ["INFANTRY"]), { inCover: true }));
    close(stealth, cover);
    expect(stealth).toBeLessThan(plain);
  });

  it("does not stack with cover the target already has", () => {
    close(damage(scenario(shots(), stealthy(), { inCover: true })), damage(scenario(shots(), stealthy())));
  });

  it("is cancelled by IGNORES COVER", () => {
    const ignoring = shots({ keywords: [{ name: "IGNORES COVER" }] });
    close(damage(scenario(ignoring, stealthy())), damage(scenario(ignoring, unit(bodies(10), [], ["INFANTRY"]))));
  });

  it("is read from the core keyword as the ability, not as a hit penalty", () => {
    const effects = abilityEffects({ id: "a", name: "Stealth", text: "", scope: "datasheet", isLegends: false, coreKeyword: "STEALTH" }).effects;
    expect(effects.map((e) => `${e.op} ${e.target}`)).toEqual(["flag stealth-ability"]);
  });

  it("subtracts 1 from the hit roll in the tenth edition instead", () => {
    const s = scenario(shots(), stealthy());
    const plain = runScenario10e({ ...s, gameSystemId: "wh40k-10e", defender: unit(bodies(10), [], ["INFANTRY"]) }).expectedDamage;
    const stealth = runScenario10e({ ...s, gameSystemId: "wh40k-10e" }).expectedDamage;
    // BS3+ becomes BS4+: three quarters of the hits it had.
    close(stealth, (plain * 3) / 4, 1e-6);
  });
});

describe("the attacks channel", () => {
  // Only a plain number was read. A rule that set, multiplied or rolled for the characteristic was
  // dropped without a word, and the toggle for it changed nothing.
  const target = (): ScenarioUnit => unit(bodies(40, { Sv: 7 }));
  const withEffect = (op: "set" | "mul" | "add", value: number | string): number =>
    damage(scenario(unit([], [gun({ A: "2", count: 10 })], [], [{ when: { stage: "hit", side: "attacker" }, op, target: "attacks", value, source: "Rule" }]), target()));
  const printed = (a: string): number => damage(scenario(unit([], [gun({ A: a, count: 10 })]), target()));

  it("reads a rule that sets the characteristic outright", () => {
    close(withEffect("set", 6), printed("6"));
  });

  it("reads a rule that multiplies it", () => {
    close(withEffect("mul", 2), printed("4"));
  });

  it("still reads a plain number", () => {
    close(withEffect("add", 2), printed("4"));
  });

  it("rolls a rule that adds dice rather than dropping it", () => {
    const rolled = withEffect("add", "D3");
    // Two plus D3 averages four, and it is a roll, so the spread is wider than a flat 4's.
    close(rolled, printed("4"));
    const spread = (pmf: number[], mean: number): number => pmf.reduce((s2, p, k) => s2 + p * (k - mean) ** 2, 0);
    const rolledRun = runScenario(scenario(unit([], [gun({ A: "2", count: 10 })], [], [{ when: { stage: "hit", side: "attacker" }, op: "add", target: "attacks", value: "D3", source: "Rule" }]), target()));
    const flatRun = runScenario(scenario(unit([], [gun({ A: "4", count: 10 })]), target()));
    expect(spread(rolledRun.damagePMF, rolledRun.expectedDamage)).toBeGreaterThan(spread(flatRun.damagePMF, flatRun.expectedDamage));
  });
});

describe("the invulnerable channel", () => {
  const attacker = (): ScenarioUnit => unit([], [gun({ count: 12, S: 8, AP: -4, skill: 2 })]);
  const naked = (): ScenarioUnit => unit(bodies(10, { Sv: 6 }));
  const shifted = (value: number): ScenarioUnit => unit(bodies(10, { Sv: 6 }), [], [], [{ when: { stage: "save", side: "defender" }, op: "add", target: "invuln", value, source: "Rule" }]);

  it("does not hand a save to a model that has none", () => {
    // A rule that shifts an invulnerable save says nothing about a model without one. Resolved
    // under the critical-wound channel's ceiling of 6, either direction granted a 6+ out of nothing.
    close(damage(scenario(attacker(), shifted(1))), damage(scenario(attacker(), naked())));
    close(damage(scenario(attacker(), shifted(-1))), damage(scenario(attacker(), naked())));
  });

  it("still shifts a save the model does have", () => {
    const has = unit(bodies(10, { Sv: 6, InvSv: 5 }));
    const better = unit(bodies(10, { Sv: 6, InvSv: 5 }), [], [], [{ when: { stage: "save", side: "defender" }, op: "add", target: "invuln", value: -1, source: "Rule" }]);
    close(damage(scenario(attacker(), better)), damage(scenario(attacker(), unit(bodies(10, { Sv: 6, InvSv: 4 })))));
    expect(damage(scenario(attacker(), better))).toBeLessThan(damage(scenario(attacker(), has)));
  });

  it("still lets a rule name one outright", () => {
    const given = unit(bodies(10, { Sv: 6 }), [], [], [{ when: { stage: "save", side: "defender" }, op: "cap", target: "invuln", value: 4, source: "Rule" }]);
    close(damage(scenario(attacker(), given)), damage(scenario(attacker(), unit(bodies(10, { Sv: 6, InvSv: 4 })))));
    expect(damage(scenario(attacker(), given))).toBeLessThan(damage(scenario(attacker(), naked())));
  });
});
