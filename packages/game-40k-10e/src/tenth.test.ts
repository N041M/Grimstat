import { describe, expect, it } from "vitest";
import type { ScenarioUnit, ScenarioWeapon } from "@grimstat/schema";
import { makeScenario, runScenario as run11 } from "@grimstat/game-40k-11e";
import { plugin, runScenario as run10 } from "./index";

const close = (a: number, b: number, tol = 1e-9) => expect(Math.abs(a - b)).toBeLessThanOrEqual(tol);
const gun = (over: Partial<ScenarioWeapon> = {}): ScenarioWeapon => ({ name: "gun", count: 10, kind: "ranged", range: 24, A: "1", skill: 3, S: 4, AP: 0, D: "1", keywords: [], enabled: true, ...over });
const unit = (models: ScenarioUnit["models"], weapons: ScenarioWeapon[] = [], keywords: string[] = []): ScenarioUnit => ({ name: "u", keywords, models, weapons, effects: [] });
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
    // 10e ignores the "never" choice: lethal is mandatory, so the result matches 11e "always"
    // (save maths differ only on unmodified 6s, which do not matter for a 6+ save here)
    close(tenth.expectedDamage, always11.expectedDamage, 1e-9);
    const haz = run10(makeScenario(unit([], [gun({ count: 3, keywords: [{ name: "HAZARDOUS" }] })]), target(4)));
    close(haz.expectedSelfMortals, 3 * (1 / 6));
  });
});
