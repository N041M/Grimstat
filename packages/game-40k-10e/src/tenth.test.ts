import { describe, expect, it } from "vitest";
import type { ScenarioUnit, ScenarioWeapon } from "@grimstat/schema";
import { CH, makeScenario, registerKeyword, runScenario as run11 } from "@grimstat/game-40k-11e";
import { plugin, runScenario as run10 } from "./index";

const close = (a: number, b: number, tol = 1e-9) => expect(Math.abs(a - b)).toBeLessThanOrEqual(tol);
const gun = (over: Partial<ScenarioWeapon> = {}): ScenarioWeapon => ({ name: "gun", count: 10, kind: "ranged", range: 24, A: "1", skill: 3, S: 4, AP: 0, D: "1", keywords: [], enabled: true, ...over });
const unit = (models: ScenarioUnit["models"], weapons: ScenarioWeapon[] = [], keywords: string[] = []): ScenarioUnit => ({ name: "u", keywords, models, weapons, attached: [], effects: [] });
const target = (Sv: number) => unit([{ name: "m", count: 10, T: 4, Sv, W: 1, isCharacter: false, keywords: [] }]);

describe("10th edition plugin", () => {
  it("has its own ids and rules while sharing the pipeline", () => {
    expect(plugin.gameSystem.id).toBe("wh40k-10e");
    expect(plugin.rules.coverAsSaveBonus).toBe(true);
    expect(plugin.rules.lethalOptional).toBe(false);
  });
  it("cover improves the save by one (not a 3+ vs AP0), and never penalises BS", () => {
    const att = unit([], [gun({ AP: 1 })]);
    const open10 = run10(makeScenario(att, target(4)));
    const cover10 = run10(makeScenario(att, target(4), { inCover: true }));
    // 4+ save vs AP-1 → 5+ in the open (unsaved 4/6, no auto-6 save in 10e) ; in cover → 4+ (unsaved 3/6)
    close(open10.expectedDamage, 10 * (2 / 3) * (1 / 2) * (4 / 6));
    close(cover10.expectedDamage, 10 * (2 / 3) * (1 / 2) * (3 / 6));
    const ap0 = unit([], [gun({ AP: 0 })]);
    close(run10(makeScenario(ap0, target(3), { inCover: true })).expectedDamage, run10(makeScenario(ap0, target(3))).expectedDamage);
    // 11e instead penalises BS and always saves on a 6
    const cover11 = run11(makeScenario(att, target(4), { inCover: true }));
    close(cover11.expectedDamage, 10 * (3 / 6) * (1 / 2) * (4 / 6));
  });
  it("lethal hits are automatic; hazardous fails on 1s only", () => {
    const tank = unit([{ name: "t", count: 1, T: 11, Sv: 2, W: 40, isCharacter: false, keywords: [] }], [], ["VEHICLE"]);
    const w = gun({ count: 6, S: 6, AP: 1, D: "3", keywords: [{ name: "ANTI", keyword: "VEHICLE", value: 2 }, { name: "DEVASTATING WOUNDS" }, { name: "LETHAL HITS" }] });
    const never11 = run11(makeScenario(unit([], [w]), tank, { lethalChoice: "never" }));
    const always11 = run11(makeScenario(unit([], [w]), tank, { lethalChoice: "always" }));
    const tenth = run10(makeScenario(unit([], [w]), tank, { lethalChoice: "never" }));
    expect(never11.expectedDamage).toBeGreaterThan(always11.expectedDamage);
    // 10e ignores the "never" choice. Lethal Hits is mandatory there, so the result matches 11e
    // "always". A single-group target saves the same way under both editions.
    close(tenth.expectedDamage, always11.expectedDamage, 1e-9);
    // 10e fails a Hazardous test on a 1 only, and every failed test costs three mortal wounds.
    const haz = run10(makeScenario(unit([], [gun({ count: 3, keywords: [{ name: "HAZARDOUS" }] })]), target(4)));
    close(haz.expectedSelfMortals, 3 * (1 / 6) * 3);
  });
  it("the app's path through the 11e package resolves 10e keywords the same way this plugin does", () => {
    // Cleave 2 against a target of 10 models is +4 attacks in 11e and nothing at all in 10e.
    const cleaver = unit([], [gun({ name: "axe", count: 1, kind: "melee", range: null, A: "2", keywords: [{ name: "CLEAVE", value: 2, raw: "Cleave 2" }] })]);
    const mob = unit([{ name: "Boy", count: 10, T: 4, Sv: 7, W: 2, isCharacter: false, keywords: [] }]);
    const scenario = makeScenario(cleaver, mob, { phase: "fight" }, [], plugin.gameSystem.id);
    const viaApp = run11(scenario);
    const viaPlugin = run10(scenario);
    close(viaApp.expectedDamage, 2 * (2 / 3) * (1 / 2));
    close(viaPlugin.expectedDamage, viaApp.expectedDamage);
    expect(viaApp.warnings).toEqual(viaPlugin.warnings);
    expect(viaApp.warnings).toContain("CLEAVE is not an ability in this edition.");
  });
  it("a keyword added through the extension point reaches 10th edition as well as 11th", () => {
    registerKeyword("SPARE ROUNDS", (_kw, c) => c.mods.add({ channel: CH.attacks, op: "add", value: 1, source: "Spare rounds" }));
    const att = unit([], [gun({ count: 1, keywords: [{ name: "SPARE ROUNDS" }] })]);
    // Two attacks rather than one, at a 4+ save with no unmodified-6 save behind it.
    close(run10(makeScenario(att, target(4))).expectedDamage, 2 * (2 / 3) * (1 / 2) * (3 / 6));
    close(run11(makeScenario(att, target(4), {}, [], "wh40k-10e")).expectedDamage, 2 * (2 / 3) * (1 / 2) * (3 / 6));
    expect(run10(makeScenario(att, target(4))).warnings).toEqual([]);
  });
});
