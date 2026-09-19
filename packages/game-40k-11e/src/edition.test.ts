import { describe, expect, it } from "vitest";
import type { Ability, GameSystem, ScenarioUnit, ScenarioWeapon, Snapshot } from "@grimstat/schema";
import { abilityEffects, efficiencyRanking, incomingFire, makeScenario, runMatrix, runScenario } from "./index";

const close = (a: number, b: number, tol = 1e-9) => expect(Math.abs(a - b)).toBeLessThanOrEqual(tol);

const gun = (over: Partial<ScenarioWeapon> = {}): ScenarioWeapon => ({ name: "gun", count: 10, kind: "ranged", range: 24, A: "1", skill: 3, S: 4, AP: 0, D: "1", keywords: [], enabled: true, ...over });
const unit = (name: string, models: ScenarioUnit["models"], weapons: ScenarioWeapon[] = [], keywords: string[] = [], points?: number): ScenarioUnit => ({ name, keywords, models, weapons, attached: [], effects: [], ...(points !== undefined ? { points } : {}) });

/** Ten plain shots: BS 3+, S4, AP 0, damage 1. */
const shooter = (points?: number) => unit("Shooter", [], [gun()], [], points);
/** Power armour: T4, 3+ save, 2 wounds. Damage 1 against 2 wounds never wastes, so the damage is exactly attacks × p. */
const armoured = unit("Power armour ×5", [{ name: "Marine", count: 5, T: 4, Sv: 3, W: 2, isCharacter: false, keywords: [] }], [], ["INFANTRY"], 90);

/** A snapshot of one edition and nothing else. The units under test carry their own profiles. */
function snapshotOf(gameSystemId: string): Snapshot {
  const system: GameSystem = { id: gameSystemId, name: "Warhammer 40,000", edition: gameSystemId === "wh40k-10e" ? "10" : "11", costTypes: [{ id: "pts", name: "Points" }] };
  return {
    id: `snap-${gameSystemId}`,
    ownerId: "local",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    revision: 0,
    gameSystemId,
    sources: [],
    checksum: "test",
    conflicts: [],
    data: { gameSystem: system, factions: [], publications: [], datasheets: [], abilities: [], detachments: [], enhancements: [], stratagems: [], priceRules: [], wargearPrices: [] },
  };
}

const tenth = snapshotOf("wh40k-10e");
const eleventh = snapshotOf("wh40k-11e");

// Ten shots at a 3+ save in cover. 11e reads cover as a BS penalty, so it hits on 4+: 10 × 1/2 × 1/2 × 1/3.
// 10e reads cover as a save bonus that a 3+ save does not get against AP 0, so the shots hit on 3+ and
// nothing else changes: 10 × 2/3 × 1/2 × 1/3.
const COVER_11E = 10 * (1 / 2) * (1 / 2) * (1 / 3);
const COVER_10E = 10 * (2 / 3) * (1 / 2) * (1 / 3);

describe("analyses are scored under the edition of the data they are given", () => {
  it("the reproduction: the two editions disagree, and the Calculator already knew", () => {
    close(runScenario(makeScenario(shooter(), armoured, { inCover: true }, [], "wh40k-11e")).expectedDamage, COVER_11E);
    close(runScenario(makeScenario(shooter(), armoured, { inCover: true }, [], "wh40k-10e")).expectedDamage, COVER_10E);
    close(COVER_11E, 0.8333333333333333);
    close(COVER_10E, 1.1111111111111112);
  });

  it("runMatrix takes the edition from the snapshot", () => {
    const cell = (snapshot: Snapshot) => runMatrix([shooter()], [armoured], { inCover: true }, { snapshot }).cells[0]![0]!.result.expectedDamage;
    close(cell(tenth), COVER_10E);
    close(cell(eleventh), COVER_11E);
    // With no snapshot there is nothing to read the edition off, so the analysis stays on 11th edition.
    close(runMatrix([shooter()], [armoured], { inCover: true }).cells[0]![0]!.result.expectedDamage, COVER_11E);
    // An explicit id is the other way in, for a caller holding no snapshot.
    close(runMatrix([shooter()], [armoured], { inCover: true }, { gameSystemId: "wh40k-10e" }).cells[0]![0]!.result.expectedDamage, COVER_10E);
  });

  it("efficiencyRanking takes the edition from the snapshot", () => {
    const damage = (snapshot: Snapshot) => efficiencyRanking([shooter(100)], { snapshot, targetIds: ["marine-like"], context: { phase: "shooting", rangeBand: "half", inCover: true } })[0]!;
    close(damage(tenth).byTarget["Power armour ×5"]!, COVER_10E);
    close(damage(eleventh).byTarget["Power armour ×5"]!, COVER_11E);
    // 100 attacker points, so damage per 100 points is the damage itself.
    close(damage(tenth).damagePer100, COVER_10E);
  });

  it("incomingFire takes the edition from the snapshot", () => {
    // A single model with a 4+ save, in cover. 10e reads the cover as +1 to the save, so a bolt
    // rifle hits on 3+, wounds on 4+ and gets through a 3+ save: 2/3 × 1/2 × 1/3. 11e reads it as
    // one worse to hit, so 1/2 × 1/2 × 1/2. Forty wounds is more than one activation can take off,
    // so no damage is ever wasted.
    const slab = unit("Slab", [{ name: "Slab", count: 1, T: 4, Sv: 4, W: 40, isCharacter: false, keywords: [] }], [], [], 100);
    const row = (snapshot: Snapshot) => incomingFire([slab], { snapshot, attackerIds: ["bolter-squad"], context: { rangeBand: "half", inCover: true } })[0]!;
    // Twenty bolt-rifle shots at half range, which is what the archetype fires.
    close(row(tenth).entries[0]!.expectedDamage, 20 * (2 / 3) * (1 / 2) * (1 / 3));
    close(row(eleventh).entries[0]!.expectedDamage, 20 * (1 / 2) * (1 / 2) * (1 / 2));
    // Effective wounds are measured by the reference attack, which is never in cover, so the two
    // editions agree on them: 2/3 × 1/2 × 1/2 of the reference shots take a wound off.
    close(row(tenth).effectiveWounds, 40 / ((2 / 3) * (1 / 2) * (1 / 2)));
    close(row(eleventh).effectiveWounds, row(tenth).effectiveWounds);
  });
});

const ability = (over: Partial<Ability> & { name: string }): Ability => ({ id: over.name, scope: "datasheet", text: "", isLegends: false, ...over });
/** A defender carrying one ability, read through the same tiering the app uses. */
const carrying = (unitToCopy: ScenarioUnit, a: Ability): ScenarioUnit => ({ ...unitToCopy, effects: abilityEffects(a).effects });
const damage = (attacker: ScenarioUnit, defender: ScenarioUnit, context: Parameters<typeof makeScenario>[2], gameSystemId: string) => runScenario(makeScenario(attacker, defender, context, [], gameSystemId)).expectedDamage;

describe("10th-edition rules", () => {
  it("CLEAVE is flagged rather than granting attacks", () => {
    // Two attacks, plus Cleave 2 for every 5 models in a target of 10, is 6 attacks in 11e.
    const cleaver = unit("Cleaver", [], [gun({ name: "axe", count: 1, kind: "melee", range: null, A: "2", keywords: [{ name: "CLEAVE", value: 2, raw: "Cleave 2" }] })]);
    const mob = unit("Mob ×10", [{ name: "Boy", count: 10, T: 4, Sv: 7, W: 2, isCharacter: false, keywords: [] }]);
    const fight = { phase: "fight" as const };
    close(damage(cleaver, mob, fight, "wh40k-10e"), 2 * (2 / 3) * (1 / 2));
    close(damage(cleaver, mob, fight, "wh40k-11e"), 6 * (2 / 3) * (1 / 2));
    expect(runScenario(makeScenario(cleaver, mob, fight, [], "wh40k-10e")).warnings).toContain("CLEAVE is not an ability in this edition.");
    expect(runScenario(makeScenario(cleaver, mob, fight, [], "wh40k-11e")).warnings).toEqual([]);
  });

  it("resolves one profile's saves lowest first in 11e and one wound at a time in 10e", () => {
    // Twenty AP-2 D2 shots that hit on 2+ and wound on 2+, into five 3+ bodyguards led by a 4++
    // character. Under 11e the sorted results reach the character only after the bodyguards have
    // absorbed the low ones, so the unit is wiped out far less often than a fresh die per wound says.
    const guns = unit("Heavy bolt rifles", [], [gun({ count: 20, skill: 2, S: 8, AP: 2, D: "2" })]);
    const led = unit("Led squad", [
      { name: "Bodyguard", count: 5, T: 4, Sv: 3, W: 2, isCharacter: false, keywords: [] },
      { name: "Captain", count: 1, T: 4, Sv: 3, InvSv: 4, W: 5, isCharacter: true, keywords: [] },
    ]);
    const pKill = (gameSystemId: string) => runScenario(makeScenario(guns, led, {}, [], gameSystemId)).pKill;
    expect(pKill("wh40k-11e")).toBeLessThan(pKill("wh40k-10e") * 0.7);
    // With no invulnerable save the two groups save on the same results and the order changes nothing.
    const plain = unit("Led squad", [
      { name: "Bodyguard", count: 5, T: 4, Sv: 3, W: 2, isCharacter: false, keywords: [] },
      { name: "Captain", count: 1, T: 4, Sv: 3, W: 5, isCharacter: true, keywords: [] },
    ]);
    close(runScenario(makeScenario(guns, plain, {}, [], "wh40k-11e")).pKill, runScenario(makeScenario(guns, plain, {}, [], "wh40k-10e")).pKill);
  });

  it("STEALTH subtracts 1 from the Hit roll of ranged attacks", () => {
    const core = carrying(armoured, ability({ name: "Stealth", coreKeyword: "STEALTH" }));
    const fromText = carrying(armoured, ability({ name: "Shrouded", text: "This unit has the Stealth ability." }));
    // Ten shots at a 3+ save: 10 × 2/3 × 1/2 × 1/3 without the penalty, 10 × 1/2 × 1/2 × 1/3 with it.
    close(damage(shooter(), armoured, {}, "wh40k-10e"), 10 * (2 / 3) * (1 / 2) * (1 / 3));
    close(damage(shooter(), core, {}, "wh40k-10e"), 10 * (1 / 2) * (1 / 2) * (1 / 3));
    close(damage(shooter(), fromText, {}, "wh40k-10e"), 10 * (1 / 2) * (1 / 2) * (1 / 3));
    close(damage(shooter(), core, {}, "wh40k-11e"), 10 * (1 / 2) * (1 / 2) * (1 / 3));
    // It is a ranged penalty, so a melee attack is unaffected.
    const swords = unit("Swords", [], [gun({ name: "sword", kind: "melee", range: null })]);
    close(damage(swords, core, { phase: "fight" }, "wh40k-10e"), 10 * (2 / 3) * (1 / 2) * (1 / 3));
  });

  it("Indirect Fire at a target that cannot be seen is -1 to hit plus the Benefit of Cover", () => {
    const mortars = unit("Mortars", [], [gun({ keywords: [{ name: "INDIRECT FIRE" }] })]);
    const unseen = { flags: ["target-not-visible"] };
    close(damage(mortars, armoured, {}, "wh40k-10e"), 10 * (2 / 3) * (1 / 2) * (1 / 3));
    close(damage(mortars, armoured, unseen, "wh40k-10e"), 10 * (1 / 2) * (1 / 2) * (1 / 3));
    // 11e answers with Snap Shooting instead: only an unmodified 6 hits.
    close(damage(mortars, armoured, unseen, "wh40k-11e"), 10 * (1 / 6) * (1 / 2) * (1 / 3));
    // A 4+ save does gain from the cover, which is what tells the cover apart from the hit penalty.
    const lightly = unit("Flak armour ×5", [{ name: "Trooper", count: 5, T: 4, Sv: 4, W: 2, isCharacter: false, keywords: [] }]);
    close(damage(mortars, lightly, unseen, "wh40k-10e"), 10 * (1 / 2) * (1 / 2) * (2 / 6));
    close(damage(mortars, lightly, {}, "wh40k-10e"), 10 * (2 / 3) * (1 / 2) * (3 / 6));
  });

  it("Hazardous costs every model three mortal wounds in 10e", () => {
    const hazardous = (keywords: string[]) => unit("Gunner", [], [gun({ count: 1, keywords: [{ name: "HAZARDOUS" }] })], keywords);
    const selfMortals = (keywords: string[], gameSystemId: string) => runScenario(makeScenario(hazardous(keywords), armoured, {}, [], gameSystemId)).expectedSelfMortals;
    // 10e fails the test on a 1 only, and the bearer suffers three mortal wounds whatever it is.
    close(selfMortals(["CHARACTER"], "wh40k-10e"), (1 / 6) * 3);
    close(selfMortals(["VEHICLE"], "wh40k-10e"), (1 / 6) * 3);
    close(selfMortals(["INFANTRY"], "wh40k-10e"), (1 / 6) * 3);
    // 11e fails on a 1 or a 2, and names only MONSTER and VEHICLE.
    close(selfMortals(["CHARACTER"], "wh40k-11e"), (2 / 6) * 1);
    close(selfMortals(["VEHICLE"], "wh40k-11e"), (2 / 6) * 3);
  });
});
