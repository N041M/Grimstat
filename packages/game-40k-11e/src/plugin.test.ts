import { describe, expect, it } from "vitest";
import type { Scenario, ScenarioUnit, ScenarioWeapon } from "@grimstat/schema";
import { hitGate, woundGate, woundTarget, pUnsaved, runScenario, archetypes, listToggles, abilityEffects, RULES } from "./index";

const close = (a: number, b: number, tol = 1e-9) => expect(Math.abs(a - b)).toBeLessThanOrEqual(tol);

function unit(models: ScenarioUnit["models"], weapons: ScenarioWeapon[] = [], keywords: string[] = [], effects: ScenarioUnit["effects"] = []): ScenarioUnit {
  return { name: "u", keywords, models, weapons, attached: [], effects };
}
const gun = (over: Partial<ScenarioWeapon> = {}): ScenarioWeapon => ({ name: "gun", count: 10, kind: "ranged", range: 24, A: "1", skill: 3, S: 4, AP: 0, D: "1", keywords: [], enabled: true, ...over });
const marines = () => unit([{ name: "m", count: 10, T: 4, Sv: 3, W: 1, isCharacter: false, keywords: [] }], [], ["INFANTRY"]);

function scenario(attacker: ScenarioUnit, defender: ScenarioUnit, ctx: Partial<Scenario["context"]> = {}, enabledToggles: string[] = []): Scenario {
  return {
    id: "s",
    ownerId: "local",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
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
      mcIterations: 5000,
      backend: "exact",
      ...ctx,
    },
    enabledToggles,
    extraEffects: [],
  };
}

describe("gates", () => {
  it("wound target table", () => {
    expect(woundTarget(8, 4)).toBe(2);
    expect(woundTarget(5, 4)).toBe(3);
    expect(woundTarget(4, 4)).toBe(4);
    expect(woundTarget(3, 4)).toBe(5);
    expect(woundTarget(2, 4)).toBe(6);
    expect(woundTarget(4, 9)).toBe(6);
  });
  it("hit gate: BS3+, +1 capped, crit on 6, rerolls", () => {
    const g = hitGate({ target: 3, rollMod: 0, critThreshold: 6, snap: false, reroll: null });
    close(g.pMiss, 2 / 6);
    close(g.pHit, 3 / 6);
    close(g.pCrit, 1 / 6);
    const plus = hitGate({ target: 3, rollMod: 1, critThreshold: 6, snap: false, reroll: null });
    close(plus.pMiss, 1 / 6); // 1 always fails
    const ones = hitGate({ target: 3, rollMod: 0, critThreshold: 6, snap: false, reroll: "ones" });
    close(ones.pMiss, 2 / 6 - 1 / 6 + (1 / 6) * (2 / 6));
    const fish = hitGate({ target: 3, rollMod: 0, critThreshold: 6, snap: false, reroll: "non-crit" });
    close(fish.pCrit, 1 / 6 + (5 / 6) * (1 / 6));
    const snap = hitGate({ target: 3, rollMod: 1, critThreshold: 6, snap: true, reroll: "failed" });
    close(snap.pMiss, 5 / 6);
    close(snap.pCrit, 1 / 6);
  });
  it("wound gate with anti (crit on 4+) and -1", () => {
    const g = woundGate({ target: 4, rollMod: -1, critThreshold: 4, reroll: null });
    close(g.pCrit, 3 / 6);
    close(g.pWound, 0); // 4,5,6 are crits; 3-1=2 < 4 fails
    close(g.pFail, 3 / 6);
  });
  it("save: 3+ vs AP-2 with 4++ → best of; six always saves", () => {
    close(pUnsaved({ armourTarget: 5, invulnTarget: 4, rollMod: 0, reroll: null }), 3 / 6);
    close(pUnsaved({ armourTarget: 8, invulnTarget: null, rollMod: 0, reroll: null }), RULES.sixAlwaysSaves ? 5 / 6 : 1);
    close(pUnsaved({ armourTarget: 4, invulnTarget: null, rollMod: 0, reroll: "failed" }), (3 / 6) * (3 / 6));
  });
});

/**
 * A save modifier moves the armour save. An invulnerable save is taken on the unmodified roll and
 * the modifier never reaches it. A model takes whichever of its two saves comes out better. An
 * unmodified 6 always saves and an unmodified 1 always fails.
 *
 * `armourTarget` is the model's save plus the weapon's AP, so each row's AP is already folded into
 * that number. A 3+ save against AP-2 arrives here as `armourTarget: 5`. `saves` lists the
 * unmodified die faces that save, which is the derivation behind each expected probability.
 */
describe("save maths", () => {
  const cases: Array<{ name: string; opts: Parameters<typeof pUnsaved>[0]; saves: number[] }> = [
    // 3+ save against AP-2 needs a 5+, and the 4++ picks up the 4 as well.
    { name: "3+ save, AP-2, 4++ invulnerable, no modifier", opts: { armourTarget: 5, invulnTarget: 4, rollMod: 0, reroll: null }, saves: [4, 5, 6] },
    // The armour save is at 5+ and -2 puts it out of reach, so the unmodified 4++ carries the model.
    { name: "2+ save, AP-3, 4++ invulnerable, -2 to save", opts: { armourTarget: 5, invulnTarget: 4, rollMod: -2, reroll: null }, saves: [4, 5, 6] },
    // The same model without an invulnerable save is left with the automatic 6.
    { name: "2+ save, AP-3, no invulnerable, -2 to save", opts: { armourTarget: 5, invulnTarget: null, rollMod: -2, reroll: null }, saves: [6] },
    // A 3+ save, then the same save one worse and one better.
    { name: "3+ save, no modifier", opts: { armourTarget: 3, invulnTarget: null, rollMod: 0, reroll: null }, saves: [3, 4, 5, 6] },
    { name: "3+ save, -1 to save", opts: { armourTarget: 3, invulnTarget: null, rollMod: -1, reroll: null }, saves: [4, 5, 6] },
    { name: "3+ save, +1 to save", opts: { armourTarget: 3, invulnTarget: null, rollMod: 1, reroll: null }, saves: [2, 3, 4, 5, 6] },
    // The model takes the better of its two saves. A 6+ armour save is improved by a 5++, and a 3+
    // armour save keeps its own 3s and 4s alongside it.
    { name: "6+ armour with a 5++ invulnerable", opts: { armourTarget: 6, invulnTarget: 5, rollMod: 0, reroll: null }, saves: [5, 6] },
    { name: "3+ armour with a 5++ invulnerable", opts: { armourTarget: 3, invulnTarget: 5, rollMod: 0, reroll: null }, saves: [3, 4, 5, 6] },
    // An armour save of 7+ cannot be made at all, and the 6 still saves.
    { name: "3+ save, AP-4, -1 to save", opts: { armourTarget: 7, invulnTarget: null, rollMod: -1, reroll: null }, saves: [6] },
    // A 1 fails however generous the modifier or the invulnerable save is.
    { name: "2+ save, +3 to save", opts: { armourTarget: 2, invulnTarget: null, rollMod: 3, reroll: null }, saves: [2, 3, 4, 5, 6] },
    { name: "no armour save, 2++ invulnerable", opts: { armourTarget: 8, invulnTarget: 2, rollMod: 0, reroll: null }, saves: [2, 3, 4, 5, 6] },
    // One point of AP and one point of save penalty do the same thing to a 3+ armour save, and they stack.
    { name: "3+ save, AP-1, no modifier", opts: { armourTarget: 4, invulnTarget: null, rollMod: 0, reroll: null }, saves: [4, 5, 6] },
    { name: "3+ save, AP-1, -1 to save", opts: { armourTarget: 4, invulnTarget: null, rollMod: -1, reroll: null }, saves: [5, 6] },
    // AP and the penalty together push the armour save to 6+, and the 4++ is untouched by either.
    { name: "3+ save, AP-2, 4++ invulnerable, -1 to save", opts: { armourTarget: 5, invulnTarget: 4, rollMod: -1, reroll: null }, saves: [4, 5, 6] },
  ];

  for (const c of cases) {
    it(c.name, () => {
      close(pUnsaved(c.opts), (6 - c.saves.length) / 6);
    });
  }

  it("loses the automatic 6 when the rules do not grant one", () => {
    // A 5+ armour save under -2 is out of reach, so without the automatic 6 nothing saves at all.
    close(pUnsaved({ armourTarget: 5, invulnTarget: null, rollMod: -2, reroll: null, sixAlwaysSaves: false }), 1);
    close(pUnsaved({ armourTarget: 5, invulnTarget: null, rollMod: -2, reroll: null, sixAlwaysSaves: true }), 5 / 6);
  });
});

describe("runScenario", () => {
  it("golden bolter squad vs marines: 10 × BS3+ S4 AP0 D1 vs T4 3+ → 1.111", () => {
    const r = runScenario(scenario(unit([{ name: "a", count: 10, T: 4, Sv: 3, W: 2, isCharacter: false, keywords: [] }], [gun()]), marines()));
    close(r.expectedDamage, 10 * (2 / 3) * (1 / 2) * (1 / 3), 1e-9);
    expect(r.backend).toBe("exact");
    expect(r.warnings).toEqual([]);
  });
  it("rapid fire doubles attacks at half range", () => {
    const w = gun({ keywords: [{ name: "RAPID FIRE", value: 1 }] });
    const full = runScenario(scenario(unit([], [w]), marines(), { rangeBand: "full" }));
    const half = runScenario(scenario(unit([], [w]), marines(), { rangeBand: "half" }));
    close(half.weapons[0]!.expectedAttacks, 2 * full.weapons[0]!.expectedAttacks);
    close(half.expectedDamage, 2 * full.expectedDamage, 1e-5);
  });
  it("11e cover is a BS penalty that stacks with -1 to hit; psychic ignores it; ignores cover ignores it", () => {
    const base = runScenario(scenario(unit([], [gun()]), marines()));
    const cover = runScenario(scenario(unit([], [gun()]), marines(), { inCover: true }));
    const coverMinus = runScenario(scenario(unit([], [gun()]), marines(), { inCover: true }, ["minus1-hit"]));
    // BS3+ → 4+ in cover: hit 3/6 ; with -1 to hit as well: 2/6 (stacks because the cover penalty is a stat modifier)
    close(cover.expectedDamage, 10 * (3 / 6) * (1 / 2) * (1 / 3));
    close(coverMinus.expectedDamage, 10 * (2 / 6) * (1 / 2) * (1 / 3));
    const psy = runScenario(scenario(unit([], [gun({ keywords: [{ name: "PSYCHIC" }] })]), marines(), { inCover: true }, ["minus1-hit"]));
    close(psy.expectedDamage, base.expectedDamage);
    const ic = runScenario(scenario(unit([], [gun({ keywords: [{ name: "IGNORES COVER" }] })]), marines(), { inCover: true }));
    close(ic.expectedDamage, base.expectedDamage);
  });
  it("anti-vehicle 4+ with devastating wounds vs a tank", () => {
    const tank = unit([{ name: "t", count: 1, T: 11, Sv: 2, W: 30, isCharacter: false, keywords: [] }], [], ["VEHICLE"]);
    const w = gun({ count: 6, S: 6, AP: 1, D: "3", keywords: [{ name: "ANTI", keyword: "VEHICLE", value: 4 }, { name: "DEVASTATING WOUNDS" }] });
    const r = runScenario(scenario(unit([], [w]), tank));
    // hits 6*2/3 = 4 ; wound target 6+ but crits on 4+ → pCrit = 3/6, pWound = 0, pFail = 3/6
    // crit → mortal 3 damage (no save); expected damage = 4 * 0.5 * 3 = 6
    close(r.weapons[0]!.expectedHits, 4);
    close(r.expectedDamage, 6, 1e-9);
  });
  it("anti-MONSTER/VEHICLE matches either printed keyword", () => {
    const w = gun({ count: 6, S: 6, AP: 1, D: "3", keywords: [{ name: "ANTI", keyword: "MONSTER/VEHICLE", value: 4 }, { name: "DEVASTATING WOUNDS" }] });
    const tank = unit([{ name: "t", count: 1, T: 11, Sv: 2, W: 30, isCharacter: false, keywords: [] }], [], ["VEHICLE"]);
    const beast = unit([{ name: "b", count: 1, T: 11, Sv: 2, W: 30, isCharacter: false, keywords: [] }], [], ["MONSTER"]);
    const walls = unit([{ name: "f", count: 1, T: 11, Sv: 2, W: 30, isCharacter: false, keywords: [] }], [], ["FORTIFICATION"]);
    close(runScenario(scenario(unit([], [w]), tank)).expectedDamage, 6, 1e-9);
    close(runScenario(scenario(unit([], [w]), beast)).expectedDamage, 6, 1e-9);
    // no match: crits stay on 6, so of 4 hits only 1/6 turn into mortal damage and 1/6 wound normally
    close(runScenario(scenario(unit([], [w]), walls)).expectedDamage, 4 * ((1 / 6) * 3 + (1 / 6) * (1 / 3) * 3), 1e-9);
  });
  it("a conditional keyword applies only against a target its condition admits", () => {
    const bodies = (): ScenarioUnit["models"] => [{ name: "m", count: 10, T: 10, Sv: 3, W: 1, isCharacter: false, keywords: [] }];
    const troops = unit(bodies(), [], ["INFANTRY"]);
    const tank = unit(bodies(), [], ["VEHICLE"]);
    const conditional = gun({ keywords: [{ name: "LETHAL HITS", keyword: "NON-MONSTER/VEHICLE", raw: "Lethal Hits: non-MONSTER/VEHICLE" }] });
    const plain = gun({ keywords: [{ name: "LETHAL HITS" }] });
    const always = { lethalChoice: "always" as const };
    const damage = (w: ScenarioWeapon, def: ScenarioUnit) => runScenario(scenario(unit([], [w]), def, always)).expectedDamage;
    // S4 vs T10 wounds on 6+, so the auto-wound from a critical hit carries most of the damage
    const withLethal = 10 * (1 / 6 + (3 / 6) * (1 / 6)) * (1 / 3);
    const withoutLethal = 10 * (4 / 6) * (1 / 6) * (1 / 3);
    close(damage(conditional, troops), withLethal, 1e-9);
    close(damage(conditional, tank), withoutLethal, 1e-9);
    // the unconditional keyword is unchanged, against either target
    close(damage(plain, troops), withLethal, 1e-9);
    close(damage(plain, tank), withLethal, 1e-9);
  });
  it("lethal hits auto choice prefers rolling when devastating + anti makes crits likely", () => {
    const tank = unit([{ name: "t", count: 1, T: 11, Sv: 2, W: 30, isCharacter: false, keywords: [] }], [], ["VEHICLE"]);
    const w = gun({ count: 6, S: 6, AP: 1, D: "3", keywords: [{ name: "ANTI", keyword: "VEHICLE", value: 2 }, { name: "DEVASTATING WOUNDS" }, { name: "LETHAL HITS" }] });
    const auto = runScenario(scenario(unit([], [w]), tank, { lethalChoice: "auto" }));
    const always = runScenario(scenario(unit([], [w]), tank, { lethalChoice: "always" }));
    const never = runScenario(scenario(unit([], [w]), tank, { lethalChoice: "never" }));
    close(auto.expectedDamage, Math.max(always.expectedDamage, never.expectedDamage), 1e-9);
    expect(never.expectedDamage).toBeGreaterThan(always.expectedDamage);
  });
  it("feel no pain and -1 damage from toggles", () => {
    const w = gun({ count: 6, S: 8, AP: 2, D: "2" });
    const w2 = unit([{ name: "m", count: 10, T: 4, Sv: 3, W: 2, isCharacter: false, keywords: [] }]);
    const w1 = gun({ count: 6, S: 8, AP: 2, D: "1" });
    const plain = runScenario(scenario(unit([], [w1]), w2));
    const fnp = runScenario(scenario(unit([], [w1]), w2, {}, ["fnp5"]));
    close(fnp.expectedDamage / plain.expectedDamage, 4 / 6, 1e-9);
    const m1 = runScenario(scenario(unit([], [w]), unit([{ name: "m", count: 10, T: 4, Sv: 3, W: 2, isCharacter: false, keywords: [] }]), {}, ["minus1-dmg"]));
    const m0 = runScenario(scenario(unit([], [w]), unit([{ name: "m", count: 10, T: 4, Sv: 3, W: 2, isCharacter: false, keywords: [] }])));
    close(m1.expectedDamage, m0.expectedDamage / 2, 1e-9);
  });
  it("hazardous self damage, blast bonus, melta, twin-linked", () => {
    const horde = unit([{ name: "b", count: 20, T: 4, Sv: 6, W: 1, isCharacter: false, keywords: [] }]);
    const blast = runScenario(scenario(unit([], [gun({ count: 1, A: "D6", keywords: [{ name: "BLAST" }] })]), horde));
    close(blast.weapons[0]!.expectedAttacks, 3.5 + 4);
    const haz = runScenario(scenario(unit([], [gun({ count: 3, keywords: [{ name: "HAZARDOUS" }] })]), horde));
    close(haz.expectedSelfMortals, 3 * (2 / 6));
    const melta = runScenario(scenario(unit([], [gun({ count: 1, S: 9, AP: 4, D: "D6", keywords: [{ name: "MELTA", value: 2 }] })]), unit([{ name: "t", count: 1, T: 9, Sv: 3, W: 20, isCharacter: false, keywords: [] }]), { rangeBand: "half" }));
    // hit 2/3, wound (S9 vs T9) 4+ → 1/2, save 3+4 = 7 → only 6 saves (5/6 unsaved), damage D6+2 mean 5.5
    close(melta.expectedDamage, (2 / 3) * (1 / 2) * (5 / 6) * 5.5, 1e-9);
    const tl = runScenario(scenario(unit([], [gun({ keywords: [{ name: "TWIN-LINKED" }] })]), marines()));
    close(tl.expectedDamage, 10 * (2 / 3) * (1 / 2 + (1 / 2) * (1 / 2)) * (1 / 3));
  });
  it("fight phase uses melee weapons; lance when charged", () => {
    const sword: ScenarioWeapon = { name: "sword", count: 5, kind: "melee", range: null, A: "2", skill: 3, S: 4, AP: 1, D: "1", keywords: [{ name: "LANCE" }], enabled: true };
    const noCharge = runScenario(scenario(unit([], [sword, gun()]), marines(), { phase: "fight" }));
    const charge = runScenario(scenario(unit([], [sword, gun()]), marines(), { phase: "fight", charged: true }));
    expect(noCharge.weapons.map((w) => w.name)).toEqual(["sword"]);
    close(noCharge.expectedDamage, 10 * (2 / 3) * (1 / 2) * (1 / 2));
    close(charge.expectedDamage, 10 * (2 / 3) * (4 / 6) * (1 / 2));
  });
  it("snap shooting applies to ranged weapons only", () => {
    const sword: ScenarioWeapon = { name: "sword", count: 5, kind: "melee", range: null, A: "2", skill: 3, S: 4, AP: 1, D: "1", keywords: [], enabled: true };
    const plain = runScenario(scenario(unit([], [sword]), marines(), { phase: "fight" }));
    const snapped = runScenario(scenario(unit([], [sword]), marines(), { phase: "fight", snapShooting: true }));
    close(snapped.expectedDamage, plain.expectedDamage);
    // The same control still holds for a ranged weapon: only unmodified 6s hit.
    const shot = runScenario(scenario(unit([], [gun()]), marines(), { snapShooting: true }));
    close(shot.expectedDamage, 10 * (1 / 6) * (1 / 2) * (1 / 3));
  });
  it("archetypes run and coverage reports unknown keywords", () => {
    const att = archetypes.find((a) => a.id === "bolter-squad")!.unit;
    const def = archetypes.find((a) => a.id === "led-squad")!.unit;
    const r = runScenario(scenario(att, def, { rangeBand: "half" }));
    expect(r.expectedDamage).toBeGreaterThan(1);
    expect(r.coverage.tier1).toBeGreaterThan(0);
    const weird = runScenario(scenario(unit([], [gun({ keywords: [{ name: "WOBBLY", raw: "Wobbly 3" }] })]), marines()));
    expect(weird.coverage.unmodelled.join(" ")).toContain("Wobbly 3");
    expect(weird.warnings.join(" ")).toContain("Wobbly 3");
  });
  it("precision shoots the character; falls back to Monte Carlo when forced", () => {
    const def = archetypes.find((a) => a.id === "led-squad")!.unit;
    const w = gun({ count: 4, S: 8, AP: 2, D: "3", keywords: [{ name: "PRECISION" }] });
    const ex = runScenario(scenario(unit([], [w]), def));
    const mc = runScenario(scenario(unit([], [w]), def, { backend: "mc", mcIterations: 30000 }));
    expect(mc.backend).toBe("mc");
    expect(Math.abs(ex.expectedDamage - mc.expectedDamage)).toBeLessThan(0.15);
  });
  it("toggles list contains generic and ability toggles", () => {
    const att = unit([], [gun()], [], [{ when: { stage: "hit", side: "attacker" }, op: "reroll", target: "reroll-hit", value: "ones", source: "Oath-like" }]);
    const t = listToggles(scenario(att, marines()));
    expect(t.some((x) => x.id === "cmd-reroll-hit")).toBe(true);
    expect(t.some((x) => x.label === "Oath-like" && x.defaultOn)).toBe(true);
    const on = runScenario(scenario(att, marines()));
    const off = runScenario(scenario(att, marines(), {}, ["-ability:attacker:Oath-like"]));
    expect(on.expectedDamage).toBeGreaterThan(off.expectedDamage);
  });
});

describe("miracle dice toggles", () => {
  it("one wound roll set to 6 becomes a devastating mortal event; one hit set to 6 is a crit", () => {
    const tank = unit([{ name: "t", count: 1, T: 11, Sv: 2, W: 40, isCharacter: false, keywords: [] }], [], ["VEHICLE"]);
    const w = gun({ count: 4, S: 6, AP: 1, D: "3", keywords: [{ name: "DEVASTATING WOUNDS" }] });
    const plain = runScenario(scenario(unit([], [w]), tank));
    const mw = runScenario(scenario(unit([], [w]), tank, {}, ["miracle-wound-6"]));
    // 4 attacks, hits 2/3 each; plain: each hit crits on a 6 (1/6) → 3 mortal dmg; also normal wounds (5+) vs 2+ save with AP1 → 3+ save, 1/3 unsaved
    // with the fixed wound: 1 hit's wound roll becomes a crit for sure. E[hits] unchanged; difference = P(hit≥1)... exact value checked against MC-free reasoning below
    expect(mw.expectedDamage).toBeGreaterThan(plain.expectedDamage);
    const mh = runScenario(scenario(unit([], [w]), tank, {}, ["miracle-hit-6"]));
    close(mh.weapons[0]!.expectedHits, 3 * (2 / 3) + 1);
  });
});

const ability = (name: string, text: string) => abilityEffects({ id: "a", name, scope: "datasheet", text, isLegends: false });

describe("pattern library", () => {
  it("derives tier-2 effects from generic phrasings", () => {
    const a = abilityEffects({ id: "x", name: "Test", scope: "datasheet", text: "Each time this unit makes a ranged attack, re-roll a hit roll of 1.", isLegends: false });
    expect(a.tier).toBe("tier2");
    expect(a.effects[0]).toMatchObject({ op: "reroll", target: "reroll-hit", value: "ones", if: { weaponKind: "ranged" } });
    const b = abilityEffects({ id: "y", name: "Tough", scope: "datasheet", text: "This model has a Feel No Pain 5+ ability against mortal wounds.", isLegends: false });
    expect(b.fnp).toBe(5);
    const c = abilityEffects({ id: "z", name: "Mystery", scope: "datasheet", text: "Once per battle, do something unusual.", isLegends: false });
    expect(c.tier).toBe("tier3");
    const d = abilityEffects({ id: "w", name: "Core", scope: "core", text: "", coreKeyword: "FEEL NO PAIN", coreValue: 6, isLegends: false });
    expect(d.tier).toBe("tier1");
    const e = abilityEffects({ id: "v", name: "Curated", scope: "datasheet", text: "Something narrative.", effects: [], isLegends: false });
    expect(e.tier).toBe("tier2");
    expect(e.notes).toEqual(["no combat effect"]);
  });

  it("reads a re-roll of 1s as a re-roll of 1s however the ability spells it", () => {
    for (const text of ["re-roll hit rolls of 1", "re-roll a hit roll of 1", "you can re-roll the hit rolls of 1"]) {
      const a = abilityEffects({ id: "r", name: "Steady", scope: "datasheet", text, isLegends: false });
      const rerolls = a.effects.filter((e) => e.op === "reroll");
      expect(rerolls.map((e) => e.value)).toEqual(["ones"]);
    }
    for (const text of ["re-roll wound rolls of 1", "re-roll a wound roll of 1"]) {
      const a = abilityEffects({ id: "r", name: "Steady", scope: "datasheet", text, isLegends: false });
      expect(a.effects.filter((e) => e.op === "reroll").map((e) => e.value)).toEqual(["ones"]);
    }
    // The unqualified phrasings still mean every failure.
    for (const text of ["re-roll hit rolls", "re-roll the wound roll"]) {
      const a = abilityEffects({ id: "r", name: "Sure", scope: "datasheet", text, isLegends: false });
      expect(a.effects.filter((e) => e.op === "reroll").map((e) => e.value)).toEqual(["failed"]);
    }
    // A named single die is the Command Re-roll's treatment, not a policy over every die.
    const one = ability("Called Shots", "Each time this model is selected to shoot, you can re-roll one Hit roll and you can re-roll one Wound roll.");
    expect(one.effects.filter((e) => e.op === "reroll").map((e) => e.value)).toEqual(["one-die", "one-die"]);
  });

  it("reads a keyword an ability grants the weapon", () => {
    const a = ability("Grav-talon", "The bearer's melee weapons have the [LANCE] ability.");
    expect(a.effects).toEqual([{ when: { stage: "hit", side: "attacker" }, op: "set", target: "grant-keyword", value: "LANCE", source: "Grav-talon", if: { weaponKind: "melee" } }]);
    // Several at once, with the condition the sentence carries.
    const b = ability("Purity of Execution", "Each time a model in this unit makes a ranged attack that targets a PSYKER unit, that attack has the [PRECISION] and [DEVASTATING WOUNDS] abilities.");
    expect(b.effects.map((e) => e.value)).toEqual(["PRECISION", "DEVASTATING WOUNDS"]);
    expect(b.effects[0]!.if).toEqual({ weaponKind: "ranged", targetKeyword: "PSYKER" });
    // A keyword the enemy's weapons gain is carried by the unit being attacked.
    const c = ability("Treacherous Illusion", "Melee weapons equipped by enemy models have the [HAZARDOUS] ability while targeting this model's unit.");
    expect(c.effects[0]!.when.side).toBe("defender");
  });

  it("reads each characteristic a single clause improves", () => {
    const a = ability("Sunderer", "Each time this model makes an attack, improve the Strength and Damage characteristics of that attack by 1.");
    expect(a.effects.map((e) => [e.target, e.value])).toEqual([["strength", 1], ["damage", 1]]);
    // BS and WS are stat modifiers on the uncapped skill channel, where up is worse.
    const b = ability("Mindlock", "Improve the Ballistic Skill characteristic of ranged weapons equipped by models in this unit by 1.");
    expect(b.effects).toEqual([{ when: { stage: "hit", side: "attacker" }, op: "add", target: "skill", value: -1, source: "Mindlock", if: { weaponKind: "ranged" } }]);
  });

  it("reads damage reduction once, however it is printed", () => {
    for (const text of ["Each time an attack is allocated to this model, subtract 1 from the Damage characteristic of that attack.", "Reduce the Damage characteristic of that attack by 1."]) {
      const a = ability("Resilient", text);
      expect(a.effects.filter((e) => e.target === "damage")).toHaveLength(1);
      expect(a.effects[0]).toMatchObject({ op: "add", target: "damage", value: -1 });
    }
  });

  it("reads a critical threshold written either way round", () => {
    const a = ability("Mandiblasters", "Each time a model in this unit makes a melee attack, if it made a Charge move this turn, an unmodified Hit roll of 5+ scores a Critical Hit.");
    expect(a.effects[0]).toMatchObject({ op: "cap", target: "crit-hit", value: 5, if: { weaponKind: "melee", charged: true } });
    const b = ability("Crits", "Critical hits on a 5+.");
    expect(b.effects[0]).toMatchObject({ op: "cap", target: "crit-hit", value: 5 });
  });

  it("separates ignoring Hit-roll modifiers from ignoring BS and WS ones", () => {
    const roll = ability("Searchlight", "Each time the bearer's unit makes a ranged attack, you can ignore any or all modifiers to the Hit roll.");
    expect(roll.effects.map((e) => e.target)).toEqual(["ignore-hit-mods"]);
    const both = ability("Talons", "Each time this model makes an attack with a ranged weapon, you can ignore any or all modifiers to the Hit roll and any or all modifiers to the Ballistic Skill characteristic of that weapon.");
    expect(both.effects.map((e) => e.target)).toEqual(["ignore-hit-mods", "ignore-skill-mods"]);
  });

  it("splits a menu into options and leaves one it cannot read unmodelled", () => {
    const pact = ability("Dark Pact", "Select one of the following abilities for that unit's weapons to gain until the end of the phase: - [LETHAL HITS] - [SUSTAINED HITS 1]");
    expect(pact.tier).toBe("tier2");
    expect(pact.effects).toEqual([]);
    expect(pact.options?.map((o) => o.label)).toEqual(["LETHAL HITS", "SUSTAINED HITS 1"]);
    // Read flat, a menu would hand the unit every option at once — the one answer it rules out.
    const prose = ability("Vows", "At the start of the first battle round, select one of the following Vows to be active. Abhor the Witch Each time a model in this unit makes an attack, add 1 to the Wound roll.");
    expect(prose.tier).toBe("tier3");
    expect(prose.effects).toEqual([]);
  });

  it("models an ability the datasheet spends, and leaves it off until it is spent", () => {
    const a = ability("No Foe Shall Stand", "Once per battle, at the start of your Shooting phase, this unit can use this ability. If it does, until the end of the phase, ranged weapons equipped by models in this unit have the [LETHAL HITS] ability.");
    expect(a.tier).toBe("tier2");
    expect(a.defaultOn).toBe(false);
    expect(a.effects.map((e) => e.value)).toEqual(["LETHAL HITS"]);
  });

  it("tells an ability with nothing to model apart from one that is not modelled", () => {
    const outside = ability("One Shot", "The bearer can only shoot with this weapon once per battle.");
    expect(outside.tier).toBe("tier1");
    expect(outside.effects).toEqual([]);
    expect(outside.notes).toEqual(["no effect on the attack sequence"]);
    // Healing is inside the sequence and is not modelled, so it keeps saying so.
    const healing = ability("Self Repair", "At the start of your Command phase, this model regains 1 lost wound.");
    expect(healing.tier).toBe("tier3");
  });
});

describe("granted keywords in a resolved attack", () => {
  const grant = (value: string) => ({ when: { stage: "hit" as const, side: "attacker" as const }, op: "set" as const, target: "grant-keyword", value, source: "Dark Pact" });

  it("a granted keyword is resolved by the registry that reads a printed one", () => {
    const plain = runScenario(scenario(unit([], [gun({ count: 10 })]), marines()));
    const twin = runScenario(scenario(unit([], [gun({ count: 10 })], [], [grant("Twin-linked")]), marines()));
    const printed = runScenario(scenario(unit([], [gun({ count: 10, keywords: [{ name: "TWIN-LINKED" }] })]), marines()));
    close(twin.expectedDamage, printed.expectedDamage);
    expect(twin.expectedDamage).toBeGreaterThan(plain.expectedDamage);
  });

  it("a granted keyword keeps the value it is printed with", () => {
    const anti = runScenario(scenario(unit([], [gun({ count: 10, D: "2" })], [], [grant("Anti-infantry 4+")]), marines()));
    const printed = runScenario(scenario(unit([], [gun({ count: 10, D: "2", keywords: [{ name: "ANTI", keyword: "INFANTRY", value: 4 }] })]), marines()));
    close(anti.expectedDamage, printed.expectedDamage);
  });

  it("a keyword nothing knows is still reported, granted or printed", () => {
    const r = runScenario(scenario(unit([], [gun()], [], [grant("Wobbly 3")]), marines()));
    expect(r.warnings.join(" ")).toContain("Wobbly 3");
  });
});

describe("a unit's own abilities", () => {
  const rifles = () => unit([{ name: "m", count: 5, T: 4, Sv: 3, W: 1, isCharacter: false, keywords: [] }], [gun({ count: 5, A: "2" })], ["INFANTRY"]);
  const effect = (over: Record<string, unknown>) => ({ when: { stage: "attacks", side: "attacker" }, op: "add", target: "attacks", value: 1, source: "Extra Shot", ...over }) as ScenarioUnit["effects"][number];

  it("apply once, and switching the ability off removes them", () => {
    const plain = runScenario(scenario(rifles(), marines()));
    expect(plain.weapons[0]!.expectedAttacks).toBe(10);

    const buffed = runScenario(scenario(unit(rifles().models, rifles().weapons, ["INFANTRY"], [effect({})]), marines()));
    expect(buffed.weapons[0]!.expectedAttacks).toBe(15);

    const off = runScenario(scenario(unit(rifles().models, rifles().weapons, ["INFANTRY"], [effect({})]), marines(), {}, ["-ability:attacker:Extra Shot"]));
    expect(off.weapons[0]!.expectedAttacks).toBe(10);
  });

  it("reach the side that carries them and no other", () => {
    const plain = runScenario(scenario(rifles(), marines()));
    const plus1Hit = { when: { stage: "hit", side: "attacker" }, op: "add", target: "hit-roll", value: 1, source: "Keen Eye" } as ScenarioUnit["effects"][number];
    const minus1Hit = { when: { stage: "hit", side: "defender" }, op: "add", target: "hit-roll", value: -1, source: "Hard to See" } as ScenarioUnit["effects"][number];

    // "+1 to hit" is an attacking ability. The defender carrying it must not lend it to the attacker.
    const defenderHasPlus = runScenario(scenario(rifles(), unit(marines().models, [], ["INFANTRY"], [plus1Hit])));
    close(defenderHasPlus.expectedDamage, plain.expectedDamage);

    // "-1 to be hit" protects whoever carries it. The attacker carrying it must not worsen its own shooting.
    const attackerHasMinus = runScenario(scenario(unit(rifles().models, rifles().weapons, ["INFANTRY"], [minus1Hit]), marines()));
    close(attackerHasMinus.expectedDamage, plain.expectedDamage);

    // Each still works on the side it belongs to.
    expect(runScenario(scenario(unit(rifles().models, rifles().weapons, ["INFANTRY"], [plus1Hit]), marines())).expectedDamage).toBeGreaterThan(plain.expectedDamage);
    expect(runScenario(scenario(rifles(), unit(marines().models, [], ["INFANTRY"], [minus1Hit]))).expectedDamage).toBeLessThan(plain.expectedDamage);
  });
});
