import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { binomial, compound, convolve, delta, dicePMF, diceMean, mean, thin, variance, run, runExact, runMonteCarlo, type EngineInput, type WeaponParams } from "./index";

const close = (a: number, b: number, tol = 1e-9) => expect(Math.abs(a - b)).toBeLessThanOrEqual(tol);

function weapon(partial: Partial<WeaponParams> & { groups: WeaponParams["groups"] }): WeaponParams {
  return {
    name: "w",
    count: 1,
    attacks: delta(1),
    hit: { pMiss: 1 / 3, pHit: 1 / 2, pCrit: 1 / 6 },
    autoHit: false,
    sustained: null,
    lethal: false,
    wound: { pFail: 1 / 2, pWound: 1 / 3, pCrit: 1 / 6 },
    devastating: false,
    singleRerollHit: false,
    singleRerollWound: false,
    precision: false,
    selfMortalsPerWeapon: 0,
    ...partial,
  };
}

describe("pmf primitives", () => {
  it("dice expressions", () => {
    close(diceMean("2D6"), 7);
    close(mean(dicePMF("2D6")), 7);
    close(mean(dicePMF("D3+1")), 3);
    expect(dicePMF("3")).toEqual([0, 0, 0, 1]);
    expect(dicePMF(2)).toEqual([0, 0, 1]);
    close(mean(dicePMF("d6")), 3.5);
  });
  it("binomial sums to one and thin matches binomial", () => {
    const b = binomial(5, 0.3);
    close(b.reduce((s, v) => s + v, 0), 1);
    expect(thin(delta(3), 0.5).map((v) => +v.toFixed(12))).toEqual(binomial(3, 0.5).map((v) => +v.toFixed(12)));
  });
  it("compound of fixed count equals power", () => {
    const per = [0.5, 0.5];
    const c = compound(delta(3), per);
    const p = convolve(convolve(per, per), per);
    c.forEach((v, i) => close(v, p[i] ?? 0));
    close(variance(binomial(10, 0.5)), 2.5);
  });
});

describe("exact engine", () => {
  it("golden: 10 shots, hit 2/3, wound 1/2, save 3+, D1 vs 10 x W1 → 1.111 damage", () => {
    const input: EngineInput = {
      weapons: [weapon({ count: 10, groups: [{ pUnsaved: 1 / 3, damage: delta(1), mortalDamage: delta(1) }] })],
      groups: [{ id: "g", name: "g", models: 10, wounds: 1, isCharacter: false }],
      allocation: "protect-character",
      backend: "exact",
      mcIterations: 0,
    };
    const out = run(input);
    expect(out.backend).toBe("exact");
    close(out.expectedDamage, 10 * (2 / 3) * (1 / 2) * (1 / 3), 1e-9);
    close(out.expectedSlain, out.expectedDamage);
    close(out.weapons[0]!.expectedHits, 10 * (2 / 3));
    close(out.weapons[0]!.expectedWounds, 10 * (2 / 3) * (1 / 2));
    close(out.weapons[0]!.expectedUnsaved, out.expectedDamage);
    close(out.damagePMF.reduce((s, v) => s + v, 0), 1);
  });

  it("allocation with overkill: 3 auto-wound D2 events vs 2 models of W3", () => {
    const input: EngineInput = {
      weapons: [
        weapon({
          count: 3,
          autoHit: true,
          wound: { pFail: 0, pWound: 1, pCrit: 0 },
          groups: [{ pUnsaved: 1, damage: delta(2), mortalDamage: delta(2) }],
        }),
      ],
      groups: [{ id: "g", name: "g", models: 2, wounds: 3, isCharacter: false }],
      allocation: "in-order",
      backend: "exact",
      mcIterations: 0,
    };
    const out = run(input);
    close(out.expectedSlain, 1);
    close(out.expectedDamage, 5);
    close(out.expectedWasted, 1);
    close(out.pKill, 0);
  });

  it("devastating wounds skip saves; lethal skips wound roll", () => {
    const base = { groups: [{ pUnsaved: 0, damage: delta(1), mortalDamage: delta(1) }] };
    const g = [{ id: "g", name: "g", models: 10, wounds: 1, isCharacter: false }];
    const dev = run({ weapons: [weapon({ count: 6, devastating: true, ...base })], groups: g, allocation: "in-order", backend: "exact", mcIterations: 0 });
    // only crit wounds get through: 6 * P(hit) * P(critWound) = 6 * 2/3 * 1/6
    close(dev.expectedDamage, 6 * (2 / 3) * (1 / 6));
    const lethal = run({
      weapons: [weapon({ count: 6, lethal: true, groups: [{ pUnsaved: 1, damage: delta(1), mortalDamage: delta(1) }] })],
      groups: g,
      allocation: "in-order",
      backend: "exact",
      mcIterations: 0,
    });
    // crit hits auto-wound: 6 * (1/6 + 1/2 * 1/2)
    close(lethal.expectedDamage, 6 * (1 / 6 + (1 / 2) * (1 / 2)));
  });

  it("sustained hits add extra rolling hits", () => {
    const out = run({
      weapons: [weapon({ count: 6, sustained: delta(1), groups: [{ pUnsaved: 1, damage: delta(1), mortalDamage: delta(1) }] })],
      groups: [{ id: "g", name: "g", models: 20, wounds: 1, isCharacter: false }],
      allocation: "in-order",
      backend: "exact",
      mcIterations: 0,
    });
    // hits = 6*(1/2 + 2*1/6) = 5 ; wounds = 5 * 1/2
    close(out.weapons[0]!.expectedHits, 5);
    close(out.expectedDamage, 2.5);
  });

  it("single re-roll of a failed hit", () => {
    const out = run({
      weapons: [weapon({ count: 2, singleRerollHit: true, wound: { pFail: 0, pWound: 1, pCrit: 0 }, groups: [{ pUnsaved: 1, damage: delta(1), mortalDamage: delta(1) }] })],
      groups: [{ id: "g", name: "g", models: 5, wounds: 1, isCharacter: false }],
      allocation: "in-order",
      backend: "exact",
      mcIterations: 0,
    });
    // E[hits] = 2*(2/3) + P(at least one miss among 2)*(2/3) = 4/3 + (1 - 4/9) * 2/3
    close(out.expectedDamage, 4 / 3 + (5 / 9) * (2 / 3));
  });

  it("fixed dice (Miracle dice): one die set to a critical hit / wound", () => {
    const g = [{ id: "g", name: "g", models: 20, wounds: 1, isCharacter: false }];
    const base = { count: 3, wound: { pFail: 0, pWound: 1, pCrit: 0 }, groups: [{ pUnsaved: 1, damage: delta(1), mortalDamage: delta(1) }] };
    const crit = run({ weapons: [weapon({ ...base, fixedHit: "crit" })], groups: g, allocation: "in-order", backend: "exact", mcIterations: 0 });
    close(crit.weapons[0]!.expectedHits, 2 * (2 / 3) + 1);
    const sus = run({ weapons: [weapon({ ...base, fixedHit: "crit", sustained: delta(1) })], groups: g, allocation: "in-order", backend: "exact", mcIterations: 0 });
    close(sus.weapons[0]!.expectedHits, 2 * (1 / 2 + 2 * (1 / 6)) + 2);
    const w = run({ weapons: [weapon({ count: 3, autoHit: true, fixedWound: "crit", devastating: true, groups: [{ pUnsaved: 0, damage: delta(1), mortalDamage: delta(1) }] })], groups: g, allocation: "in-order", backend: "exact", mcIterations: 0 });
    // 2 rolled hits: crit wound 1/6 each → mortal; plus one fixed crit
    close(w.expectedDamage, 2 * (1 / 6) + 1);
    const input: EngineInput = { weapons: [weapon({ count: 4, attacks: dicePMF("D3"), fixedHit: "crit", fixedWound: "wound", sustained: delta(1), singleRerollHit: true, groups: [{ pUnsaved: 0.5, damage: dicePMF("D3"), mortalDamage: dicePMF("D3") }] })], groups: [{ id: "g", name: "g", models: 6, wounds: 3, isCharacter: false }], allocation: "in-order", backend: "exact", mcIterations: 40000, seed: 7 };
    const ex = runExact(input)!;
    const mc = runMonteCarlo(input);
    expect(Math.abs(ex.expectedDamage - mc.expectedDamage)).toBeLessThan(3 * (mc.ciHalfWidth ?? 0.1) + 0.02);
    expect(Math.abs(ex.weapons[0]!.expectedHits - mc.weapons[0]!.expectedHits)).toBeLessThan(0.1);
  });

  it("precision allocates to the character first", () => {
    const groups = [
      { id: "b", name: "bodyguard", models: 5, wounds: 2, isCharacter: false },
      { id: "c", name: "character", models: 1, wounds: 4, isCharacter: true },
    ];
    const mk = (precision: boolean) =>
      run({
        weapons: [
          weapon({
            count: 2,
            autoHit: true,
            wound: { pFail: 0, pWound: 1, pCrit: 0 },
            precision,
            groups: [
              { pUnsaved: 1, damage: delta(2), mortalDamage: delta(2) },
              { pUnsaved: 1, damage: delta(2), mortalDamage: delta(2) },
            ],
          }),
        ],
        groups,
        allocation: "protect-character",
        backend: "exact",
        mcIterations: 0,
      });
    const noPrec = mk(false);
    const prec = mk(true);
    close(noPrec.expectedSlain, 2); // two bodyguards
    close(prec.expectedSlain, 1); // character dies (4 wounds, 2 events of 2)
    close(prec.pKill, 0);
  });
});

describe("monte carlo agrees with exact", () => {
  it("complex mixed scenario within CI", () => {
    const groups = [
      { id: "b", name: "bodyguard", models: 5, wounds: 2, isCharacter: false, pointsPerModel: 20 },
      { id: "c", name: "character", models: 1, wounds: 5, isCharacter: true, pointsPerModel: 80 },
    ];
    const weapons: WeaponParams[] = [
      weapon({
        name: "gun",
        count: 4,
        attacks: dicePMF("D3"),
        sustained: dicePMF("D3"),
        lethal: false,
        devastating: true,
        singleRerollWound: true,
        groups: [
          { pUnsaved: 0.5, damage: thin(dicePMF("D3"), 5 / 6), mortalDamage: thin(dicePMF("D3"), 5 / 6) },
          { pUnsaved: 0.25, damage: thin(dicePMF("D3"), 5 / 6), mortalDamage: thin(dicePMF("D3"), 5 / 6) },
        ],
      }),
      weapon({
        name: "sword",
        count: 3,
        attacks: delta(3),
        hit: { pMiss: 1 / 6, pHit: 2 / 3, pCrit: 1 / 6 },
        lethal: true,
        precision: true,
        singleRerollHit: true,
        groups: [
          { pUnsaved: 2 / 3, damage: delta(2), mortalDamage: delta(2) },
          { pUnsaved: 1 / 2, damage: delta(2), mortalDamage: delta(2) },
        ],
      }),
    ];
    const base: EngineInput = { weapons, groups, allocation: "protect-character", backend: "exact", mcIterations: 60000, seed: 42 };
    const ex = runExact(base)!;
    const mc = runMonteCarlo(base);
    expect(Math.abs(ex.expectedDamage - mc.expectedDamage)).toBeLessThan(3 * (mc.ciHalfWidth ?? 0.1) + 0.02);
    expect(Math.abs(ex.expectedSlain - mc.expectedSlain)).toBeLessThan(0.05);
    expect(Math.abs(ex.pKill - mc.pKill)).toBeLessThan(0.02);
    expect(Math.abs(ex.expectedWasted - mc.expectedWasted)).toBeLessThan(0.08);
    expect(Math.abs(ex.expectedPointsSlain - mc.expectedPointsSlain)).toBeLessThan(2);
    for (let i = 0; i < ex.weapons.length; i++) {
      expect(Math.abs(ex.weapons[i]!.expectedHits - mc.weapons[i]!.expectedHits)).toBeLessThan(0.1);
      expect(Math.abs(ex.weapons[i]!.expectedWounds - mc.weapons[i]!.expectedWounds)).toBeLessThan(0.1);
    }
  });

  it("property: more attacks never reduces expected damage; pmfs sum to 1", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 12 }), fc.integer({ min: 1, max: 12 }), fc.double({ min: 0.05, max: 0.95, noNaN: true }), (n1, n2, pu) => {
        const mk = (n: number) =>
          runExact({
            weapons: [weapon({ count: n, groups: [{ pUnsaved: pu, damage: dicePMF("D3"), mortalDamage: dicePMF("D3") }] })],
            groups: [{ id: "g", name: "g", models: 6, wounds: 3, isCharacter: false }],
            allocation: "in-order",
            backend: "exact",
            mcIterations: 0,
          })!;
        const a = mk(Math.min(n1, n2));
        const b = mk(Math.max(n1, n2));
        const sum = a.damagePMF.reduce((s, v) => s + v, 0);
        return b.expectedDamage + 1e-9 >= a.expectedDamage && Math.abs(sum - 1) < 1e-9;
      }),
      { numRuns: 40 },
    );
  });
});

describe("chained runs", () => {
  it("running two weapons in one run equals running them in two chained runs", () => {
    const groups = [{ id: "g", name: "g", models: 4, wounds: 3, isCharacter: false, pointsPerModel: 10 }];
    const w1 = weapon({ name: "a", count: 4, groups: [{ pUnsaved: 0.5, damage: dicePMF("D3"), mortalDamage: dicePMF("D3") }] });
    const w2 = weapon({ name: "b", count: 3, attacks: dicePMF("D6"), groups: [{ pUnsaved: 0.7, damage: delta(2), mortalDamage: delta(2) }] });
    const both = runExact({ weapons: [w1, w2], groups, allocation: "in-order", backend: "exact", mcIterations: 0 })!;
    const first = runExact({ weapons: [w1], groups, allocation: "in-order", backend: "exact", mcIterations: 0 })!;
    const second = runExact({ weapons: [w2], groups, allocation: "in-order", backend: "exact", mcIterations: 0, initialState: first.finalState! })!;
    close(first.expectedDamage + second.expectedDamage, both.expectedDamage, 1e-9);
    close(first.expectedSlain + second.expectedSlain, both.expectedSlain, 1e-9);
    close(second.pKill, both.pKill, 1e-9);
    close(first.expectedPointsSlain + second.expectedPointsSlain, both.expectedPointsSlain, 1e-9);
    both.slainPMF.forEach((v, i) => close(v, second.slainPMF[i] ?? 0, 1e-9));
    const mc = runMonteCarlo({ weapons: [w2], groups, allocation: "in-order", backend: "mc", mcIterations: 40000, seed: 3, initialState: first.finalState! });
    expect(Math.abs(mc.expectedDamage - second.expectedDamage)).toBeLessThan(3 * (mc.ciHalfWidth ?? 0.1) + 0.03);
    expect(Math.abs(mc.pKill - second.pKill)).toBeLessThan(0.02);
  });
});
