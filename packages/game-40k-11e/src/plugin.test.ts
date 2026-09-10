import { describe, expect, it } from "vitest";
import type { Scenario, ScenarioUnit, ScenarioWeapon } from "@grimstat/schema";
import { hitGate, woundGate, woundTarget, pUnsaved, runScenario, archetypes, listToggles, abilityEffects, RULES } from "./index";

const close = (a: number, b: number, tol = 1e-9) => expect(Math.abs(a - b)).toBeLessThanOrEqual(tol);

function unit(models: ScenarioUnit["models"], weapons: ScenarioWeapon[] = [], keywords: string[] = [], effects: ScenarioUnit["effects"] = []): ScenarioUnit {
  return { name: "u", keywords, models, weapons, effects };
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
});
