import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { bcompoundOneReroll, bcompoundOneRerollTable, binomial, compound, convolve, delta, dicePMF, diceMean, makeStateSpace, mapPMF, mean, mulberry32, percentile, percentiles, thin, variance, run, runExact, runMonteCarlo, type EngineInput, type PMF, type TargetGroup, type WeaponParams } from "./index";

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
  it("averages a negative bonus the way the distribution floors it", () => {
    // `dicePMF` caps each shifted roll at zero, so "D6-2" rolls 0, 0, 1, 2, 3, 4 and averages 1.667.
    // Subtracting the bonus from 3.5 gives 1.5, which is the mean of a distribution nothing samples.
    close(diceMean("D6-2"), 5 / 3);
    close(diceMean("D3-2"), 1 / 3);
    for (const expr of ["1", "2", "D3", "D6", "2D6", "D3+1", "D6+2", "D6-1", "D6-2", "D3-2", "2D6-2", "2D6-4", "3D3-5", "0-2"]) {
      close(diceMean(expr), mean(dicePMF(expr)));
    }
    close(diceMean(3), mean(dicePMF(3)));
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

/**
 * `percentile` uses the nearest-rank convention: the smallest value whose running total reaches the
 * asked-for probability. Every answer is a value the distribution can take, with no interpolation.
 */
describe("percentiles", () => {
  it("takes the first value whose running total reaches the quantile", () => {
    //   k        0     1     2     3     4     5
    //   P(X=k)  0.1   0.0   0.2   0.3   0.3   0.1
    //   P(X≤k)  0.1   0.1   0.3   0.6   0.9   1.0
    // 0.05 is reached at 0, 0.25 at 2, 0.5 at 3, 0.75 at 4 and 0.95 at 5.
    const p = [0.1, 0, 0.2, 0.3, 0.3, 0.1];
    // The two quarters are the ends of the band the chart shades, and they are two damage apart here.
    expect(percentiles(p)).toEqual({ p5: 0, p25: 2, p50: 3, p75: 4, p95: 5 });
  });

  it("counts a running total that lands exactly on the quantile", () => {
    //   k        0     1     2     3
    //   P(X≤k)  0.25  0.50  0.75  1.00
    // A running total equal to the quantile is enough, so 0.25 answers 0 rather than 1. An
    // interpolating convention would put the median at 1.5 and the quarters at 0.75 and 2.25.
    const p = [0.25, 0.25, 0.25, 0.25];
    expect(percentiles(p)).toEqual({ p5: 0, p25: 0, p50: 1, p75: 2, p95: 3 });
    expect(percentile(p, 0.5)).toBe(1);
    expect(percentile(p, 0.5000001)).toBe(2);
  });

  it("gives one value five times for a distribution with no spread", () => {
    expect(percentiles(delta(3))).toEqual({ p5: 3, p25: 3, p50: 3, p75: 3, p95: 3 });
  });

  it("never puts a lower quantile above a higher one on the engine's own output", () => {
    const spread = (models: number, wounds: number, damage: PMF, count: number, pUnsaved: number) =>
      run({
        weapons: [weapon({ count, attacks: dicePMF("D3"), groups: [{ pUnsaved, damage, mortalDamage: damage }] })],
        groups: [{ id: "g", name: "g", models, wounds, isCharacter: false }],
        allocation: "in-order",
        backend: "exact",
        mcIterations: 0,
      });
    const outputs = [
      spread(10, 1, delta(1), 10, 1 / 3),
      spread(5, 2, dicePMF("D3"), 6, 1 / 2),
      spread(3, 4, dicePMF("D6"), 4, 2 / 3),
      spread(1, 12, dicePMF("D6"), 8, 5 / 6),
      spread(20, 1, delta(2), 12, 1),
    ];
    let anySpread = false;
    for (const out of outputs) {
      for (const pmf of [out.damagePMF, out.slainPMF]) {
        const q = percentiles(pmf);
        expect(q.p5).toBeLessThanOrEqual(q.p25);
        expect(q.p25).toBeLessThanOrEqual(q.p50);
        expect(q.p50).toBeLessThanOrEqual(q.p75);
        expect(q.p75).toBeLessThanOrEqual(q.p95);
        if (q.p25 < q.p75) anySpread = true;
      }
    }
    // The ordering above only says anything while some scenario has a quarter-to-quarter spread.
    expect(anySpread).toBe(true);
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

/**
 * The identities below hold for every weapon and every defender, so they are checked against
 * randomly built profiles rather than chosen ones. The generators cover the keyword combinations
 * the hand-written cases above take one at a time: torrent, sustained hits, lethal hits, devastating
 * wounds, a single re-roll on either roll, precision, a fixed die on either roll, and two weapons
 * firing into one or two defending groups. A weapon deals the same damage to every group it can
 * hit, which keeps the damage accounting below to a single equation.
 */
describe("property: arbitrary weapon profiles and defender statlines", () => {
  /** A hit or wound gate built from a target number and the roll a critical starts on. */
  const gateArb = fc.tuple(fc.integer({ min: 2, max: 5 }), fc.constantFrom(5, 6)).map(([target, crit]) => {
    const faces = [1, 2, 3, 4, 5, 6];
    const pCrit = faces.filter((r) => r >= crit).length / 6;
    const pOk = faces.filter((r) => r >= target && r < crit).length / 6;
    return { ok: pOk, crit: pCrit, fail: 1 - pOk - pCrit };
  });

  const diceArb = fc.constantFrom("1", "2", "D3", "D6");

  const profileArb = fc.record({
    count: fc.integer({ min: 1, max: 3 }),
    attacks: diceArb,
    hit: gateArb,
    wound: gateArb,
    autoHit: fc.boolean(),
    sustained: fc.constantFrom(null, "1", "D3"),
    lethal: fc.boolean(),
    devastating: fc.boolean(),
    singleRerollHit: fc.boolean(),
    singleRerollWound: fc.boolean(),
    precision: fc.boolean(),
    fixedHit: fc.constantFrom(undefined, "miss" as const, "hit" as const, "crit" as const),
    fixedWound: fc.constantFrom(undefined, "fail" as const, "wound" as const, "crit" as const),
    pUnsaved: fc.constantFrom(0, 1 / 6, 2 / 6, 3 / 6, 4 / 6, 5 / 6, 1),
    damage: diceArb,
  });

  const statlineArb = fc.record({
    models: fc.integer({ min: 1, max: 5 }),
    wounds: fc.integer({ min: 1, max: 3 }),
    isCharacter: fc.boolean(),
    pointsPerModel: fc.integer({ min: 0, max: 40 }),
  });

  type Profile = typeof profileArb extends fc.Arbitrary<infer T> ? T : never;
  type Statline = typeof statlineArb extends fc.Arbitrary<infer T> ? T : never;

  const build = (profiles: Profile[], statlines: Statline[]) => {
    const groups: TargetGroup[] = statlines.map((s, i) => ({ id: `g${i}`, name: `g${i}`, ...s }));
    const weapons = profiles.map((p, i) => {
      const damage = dicePMF(p.damage);
      return weapon({
        name: `w${i}`,
        count: p.count,
        attacks: dicePMF(p.attacks),
        hit: { pMiss: p.hit.fail, pHit: p.hit.ok, pCrit: p.hit.crit },
        wound: { pFail: p.wound.fail, pWound: p.wound.ok, pCrit: p.wound.crit },
        autoHit: p.autoHit,
        sustained: p.sustained === null ? null : dicePMF(p.sustained),
        lethal: p.lethal,
        devastating: p.devastating,
        singleRerollHit: p.singleRerollHit,
        singleRerollWound: p.singleRerollWound,
        precision: p.precision,
        ...(p.fixedHit ? { fixedHit: p.fixedHit } : {}),
        ...(p.fixedWound ? { fixedWound: p.fixedWound } : {}),
        groups: groups.map(() => ({ pUnsaved: p.pUnsaved, damage, mortalDamage: damage })),
      });
    });
    return { weapons, groups };
  };

  it("holds the engine's identities whatever the profile and the statline", () => {
    fc.assert(
      fc.property(
        fc.array(profileArb, { minLength: 1, maxLength: 2 }),
        fc.array(statlineArb, { minLength: 1, maxLength: 2 }),
        fc.constantFrom("in-order" as const, "protect-character" as const),
        (profiles, statlines, allocation) => {
          const { weapons, groups } = build(profiles, statlines);
          const out = runExact({ weapons, groups, allocation, backend: "exact", mcIterations: 0 })!;
          expect(out).not.toBeNull();

          // Both outputs are distributions. Every entry is a real number between 0 and 1 and the
          // whole of the mass is accounted for.
          for (const pmf of [out.damagePMF, out.slainPMF]) {
            for (const v of pmf) {
              expect(Number.isFinite(v)).toBe(true);
              expect(v).toBeGreaterThanOrEqual(0);
            }
            close(pmf.reduce((s, v) => s + v, 0), 1, 1e-9);
          }

          // The reported expectation is the mean of the distribution it is reported beside.
          close(out.expectedDamage, mean(out.damagePMF), 1e-9);
          close(out.expectedSlain, mean(out.slainPMF), 1e-9);

          // Every model dead is the top of the slain distribution, and that is what pKill counts.
          const allModels = groups.reduce((s, g) => s + g.models, 0);
          close(out.pKill, out.slainPMF[allModels] ?? 0, 1e-12);

          // A hit is needed for a wound roll and a wound for a save, so the trace narrows at every step.
          for (const t of out.weapons) {
            expect(t.expectedWounds).toBeLessThanOrEqual(t.expectedHits + 1e-9);
            expect(t.expectedUnsaved).toBeLessThanOrEqual(t.expectedWounds + 1e-9);
            expect(t.expectedDamage).toBeGreaterThanOrEqual(-1e-9);
          }

          // Damage that is rolled either comes off the defending unit or is wasted on overkill, so
          // the two together are the damage the dice produced. A weapon without devastating wounds
          // rolls damage once per wound that beats the save, which is the equality below. A
          // devastating weapon also rolls mortal damage for its critical wounds, and those skip the
          // save, so its total sits between the two rates instead.
          let rolledIfSaved = 0;
          let rolledIfNotSaved = 0;
          let everyEventSaveable = true;
          profiles.forEach((p, i) => {
            const per = diceMean(p.damage);
            const wounds = out.weapons[i]!.expectedWounds;
            rolledIfSaved += wounds * p.pUnsaved * per;
            rolledIfNotSaved += wounds * per;
            if (p.devastating) everyEventSaveable = false;
          });
          const total = out.expectedDamage + out.expectedWasted;
          const tol = 1e-9 * Math.max(1, rolledIfNotSaved);
          if (everyEventSaveable) close(total, rolledIfSaved, tol);
          else {
            expect(total).toBeGreaterThanOrEqual(rolledIfSaved - tol);
            expect(total).toBeLessThanOrEqual(rolledIfNotSaved + tol);
          }
        },
      ),
      { numRuns: 300 },
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

  it("sizes a chained run's confidence interval on the damage that run adds", () => {
    const groups = [{ id: "g", name: "g", models: 4, wounds: 3, isCharacter: false, pointsPerModel: 10 }];
    const w1 = weapon({ name: "a", count: 4, groups: [{ pUnsaved: 0.5, damage: dicePMF("D3"), mortalDamage: dicePMF("D3") }] });
    const w2 = weapon({ name: "b", count: 3, attacks: dicePMF("D6"), groups: [{ pUnsaved: 0.7, damage: delta(2), mortalDamage: delta(2) }] });
    const first = runExact({ weapons: [w1], groups, allocation: "in-order", backend: "exact", mcIterations: 0 })!;
    const chained = (seed: number, mcIterations: number) =>
      runMonteCarlo({ weapons: [w2], groups, allocation: "in-order", backend: "mc", mcIterations, seed, initialState: first.finalState! });

    // Independent runs scatter about the answer by the standard error the interval quotes, so the
    // spread of two hundred of them is what the quote has to match.
    const runs = Array.from({ length: 200 }, (_, i) => chained(i + 1, 4000));
    const means = runs.map((r) => r.expectedDamage);
    const centre = means.reduce((a, b) => a + b, 0) / means.length;
    const spread = Math.sqrt(means.reduce((a, b) => a + (b - centre) * (b - centre), 0) / (means.length - 1));
    const quoted = runs.reduce((a, r) => a + (r.ciHalfWidth ?? 0), 0) / runs.length / 1.96;
    expect(quoted / spread).toBeGreaterThan(0.8);
    expect(quoted / spread).toBeLessThan(1.25);

    // One run of that set, pinned: 2.33 of per-iteration spread behind the interval, where the
    // cumulative total gave 4.35.
    const one = chained(3, 20000);
    expect((one.ciHalfWidth! * Math.sqrt(20000)) / 1.96).toBeCloseTo(2.33, 1);
  });
});

describe("the confidence interval is only offered when the sample can support one", () => {
  // Against a target the attack always wipes, every run deals the same damage. The half-width
  // formula then reports zero, which would read as an exact answer, so no interval is offered.
  const overkill = (mcIterations: number) =>
    runMonteCarlo({
      weapons: [weapon({ count: 12, autoHit: true, wound: { pFail: 0.05, pWound: 0.95, pCrit: 0 }, groups: [{ pUnsaved: 0.95, damage: delta(2), mortalDamage: delta(2) }] })],
      groups: [{ id: "g", name: "g", models: 3, wounds: 2, isCharacter: false }],
      allocation: "in-order",
      backend: "mc",
      mcIterations,
      seed: 1,
    });

  it("offers none when every run dealt the same damage", () => {
    const r = overkill(1000);
    expect(r.expectedDamage).toBe(6);
    expect(r.ciHalfWidth).toBeUndefined();
  });

  it("still offers one whenever the runs differ", () => {
    const r = runMonteCarlo({
      weapons: [weapon({ count: 5, groups: [{ pUnsaved: 1 / 3, damage: delta(1), mortalDamage: delta(1) }] })],
      groups: [{ id: "g", name: "g", models: 5, wounds: 2, isCharacter: false }],
      allocation: "in-order",
      backend: "mc",
      mcIterations: 2000,
      seed: 1,
    });
    expect(r.ciHalfWidth).toBeGreaterThan(0);
  });
});

describe("a single re-roll costs about what the same attack costs without one", () => {
  /**
   * The table of wound-die powers is the same for every rolling hit, so it is built once. Building
   * it per hit is quadratic in the number of hits.
   *
   * A re-roll costs about five times what no re-roll costs on this scenario. The threshold is four
   * times that, which leaves room for a slow or busy machine and still catches the quadratic term.
   */
  const scenario = (singleRerollWound: boolean): EngineInput => ({
    weapons: [
      weapon({
        count: 12,
        attacks: dicePMF("D6+2"),
        sustained: dicePMF("D3"),
        devastating: true,
        singleRerollWound,
        groups: [{ pUnsaved: 2 / 3, damage: dicePMF("D3"), mortalDamage: dicePMF("D3") }],
      }),
    ],
    groups: [{ id: "g", name: "g", models: 10, wounds: 3, isCharacter: false }],
    allocation: "in-order",
    backend: "exact",
    mcIterations: 0,
  });

  const time = (reroll: boolean): number => {
    const t0 = performance.now();
    runExact(scenario(reroll));
    return performance.now() - t0;
  };

  it("stays within a small multiple of the same attack without the re-roll", () => {
    // Two goes at each and the quicker one taken, so that the first run's warm-up and a machine
    // that is busy for a moment do not decide the answer.
    const off = Math.min(time(false), time(false));
    const on = Math.min(time(true), time(true));
    expect(on).toBeLessThan(off * 20);
  });

  it("builds the same table as one call for each number of dice", () => {
    // The shared table has to give the same numbers as the call it replaced, to the last bit, for
    // every wound gate the game can produce. The last gate here never fails, which is the case that
    // has no die to re-roll.
    const gate = (pFail: number, pWound: number, pCrit: number) => {
      const full = [
        [pFail, pCrit],
        [pWound, 0],
      ];
      const z = 1 - pFail;
      const givenNotFail = z > 0 ? [[0, pCrit / z], [pWound / z, 0]] : [[1]];
      return { full, givenNotFail };
    };
    for (const [pFail, pWound, pCrit] of [
      [1 / 2, 1 / 3, 1 / 6],
      [1 / 6, 4 / 6, 1 / 6],
      [5 / 6, 0, 1 / 6],
      [0, 5 / 6, 1 / 6],
    ]) {
      const { full, givenNotFail } = gate(pFail!, pWound!, pCrit!);
      const table = bcompoundOneRerollTable(9, full, pFail!, givenNotFail);
      for (let k = 0; k <= 9; k++) expect(table[k]).toEqual(bcompoundOneReroll(delta(k), full, pFail!, givenNotFail));
    }
  });
});

describe("the exact backend counts the work a target will take", () => {
  /**
   * The DP walks the whole state space once per wound needing a save and once per mortal-damage
   * event, so a target can be small in states and still take seconds. This one is 21,777 states,
   * inside the 40,000 state cap, and its DP walks them 3.9e8 times.
   */
  const heavy = (groups: TargetGroup[]): EngineInput => ({
    weapons: [
      weapon({
        count: 30,
        attacks: dicePMF("D6+2"),
        sustained: dicePMF("D3"),
        devastating: true,
        groups: groups.map(() => ({ pUnsaved: 2 / 3, damage: dicePMF("D3"), mortalDamage: dicePMF("D3") })),
      }),
    ],
    groups,
    allocation: "in-order",
    backend: "auto",
    mcIterations: 2000,
    seed: 5,
  });

  const threeGroups: TargetGroup[] = [
    { id: "a", name: "a", models: 20, wounds: 3, isCharacter: false },
    { id: "b", name: "b", models: 10, wounds: 5, isCharacter: false },
    { id: "c", name: "c", models: 1, wounds: 6, isCharacter: true },
  ];

  it("sends a target the state cap would have let through to the sampled backend", () => {
    expect(makeStateSpace(threeGroups).total).toBeLessThan(40000);
    expect(runExact(heavy(threeGroups))).toBeNull();
    const out = run(heavy(threeGroups));
    expect(out.backend).toBe("mc");
    expect(out.warnings.join(" ")).toContain("Monte Carlo");
  });

  it("still solves a target whose work is inside the budget", () => {
    const out = runExact(heavy([{ id: "g", name: "g", models: 10, wounds: 3, isCharacter: false }]));
    expect(out).not.toBeNull();
    expect(out!.backend).toBe("exact");
  });

  it("takes the budget from the caller when it sets one", () => {
    const small: EngineInput = {
      weapons: [weapon({ count: 4, groups: [{ pUnsaved: 1 / 2, damage: delta(1), mortalDamage: delta(1) }] })],
      groups: [{ id: "g", name: "g", models: 2, wounds: 2, isCharacter: false }],
      allocation: "in-order",
      backend: "exact",
      mcIterations: 0,
    };
    expect(runExact({ ...small, maxExactWork: 1 })).toBeNull();
    expect(runExact({ ...small, maxExactStates: 1 })).toBeNull();
    expect(runExact(small)).not.toBeNull();
  });
});

describe("inputs the engine should not be broken by", () => {
  const shot = (groups: TargetGroup[], mcIterations: number): EngineInput => ({
    weapons: [weapon({ count: 4, attacks: dicePMF("2"), groups: groups.map(() => ({ pUnsaved: 1 / 2, damage: delta(1), mortalDamage: delta(1) })) })],
    groups,
    allocation: "in-order",
    backend: "exact",
    mcIterations,
    seed: 3,
  });

  it("reads a model of no wounds as a model of one, in both backends", () => {
    // A group of zero wounds has one state, and that state is the one every reader takes for "all
    // the models here are dead", so both backends have to read it as a model of one wound instead.
    const groups: TargetGroup[] = [{ id: "g", name: "g", models: 3, wounds: 0, isCharacter: false }];
    const before = runExact({ ...shot(groups, 0), weapons: [] })!;
    expect(before.expectedSlain).toBe(0);
    expect(before.pKill).toBe(0);
    const ex = runExact(shot(groups, 0))!;
    const mc = runMonteCarlo(shot(groups, 20000));
    close(ex.expectedSlain, mc.expectedSlain, 0.05);
    close(ex.pKill, mc.pKill, 0.05);
    close(ex.expectedDamage, mc.expectedDamage, 0.05);
  });

  it("fires into an empty target list without either backend falling over", () => {
    // Reached only through the engine's own API: the game plugin refuses a target with no groups.
    const ex = runExact(shot([], 0))!;
    const mc = runMonteCarlo(shot([], 500));
    close(ex.pKill, mc.pKill, 1e-9);
    expect(mc.expectedDamage).toBe(0);
    expect(mc.expectedWasted).toBe(0);
  });

  it("keeps binomial a distribution past the size its coefficients overflow at", () => {
    // The coefficient overflows a double above about n = 1030. Reached from a profile rolling that
    // many attack dice.
    for (const n of [1029, 1031, 2000]) {
      const b = binomial(n, 1 / 3);
      expect(b.every(Number.isFinite)).toBe(true);
      close(b.reduce((s, v) => s + v, 0), 1, 1e-9);
      close(mean(b), n / 3, 1e-6);
    }
  });

  it("refuses a damage modifier that is not a number instead of dropping the mass", () => {
    // Math.round(NaN) is NaN, which indexes a "NaN" property instead of a slot and loses the mass.
    expect(() => mapPMF(dicePMF("D6"), (k) => k * NaN)).toThrow(/mapPMF/);
    close(mapPMF(dicePMF("D6"), (k) => k - 1).reduce((s, v) => s + v, 0), 1, 1e-12);
  });
});

/**
 * The 11th edition takes one profile's save rolls together and resolves them from the lowest result
 * up, each against whichever allocation group is current when it is reached. That only differs from
 * allocating one wound at a time when the groups differ in which results save them, and then it can
 * differ a lot: a bodyguard group that dies to the low results leaves only the high ones for the
 * character behind it.
 */
describe("saves resolved lowest first", () => {
  /** Faces 1..6 that inflict damage on a model saving on `need`+; a 1 never saves. */
  const damageOn = (need: number): boolean[] => [1, 2, 3, 4, 5, 6].map((r) => r === 1 || r < need);
  const uniform = [1, 1, 1, 1, 1, 1].map((v) => v / 6);
  /** Every attack hits and wounds, so a profile of `n` attacks is exactly `n` saves. */
  const volley = (n: number, needs: number[], dmg: number): WeaponParams =>
    weapon({
      attacks: delta(n),
      hit: { pMiss: 0, pHit: 1, pCrit: 0 },
      autoHit: true,
      wound: { pFail: 0, pWound: 1, pCrit: 0 },
      saveFaces: uniform,
      groups: needs.map((need) => ({ pUnsaved: damageOn(need).filter(Boolean).length / 6, damageOn: damageOn(need), damage: delta(dmg), mortalDamage: delta(1) })),
    });
  const unit = (spec: Array<[models: number, wounds: number, character: boolean]>): TargetGroup[] => spec.map(([models, wounds, isCharacter], i) => ({ id: `${i}`, name: `g${i}`, models, wounds, isCharacter }));
  const input = (weapons: WeaponParams[], groups: TargetGroup[], saveOrder: "each" | "ascending"): EngineInput => ({ weapons, groups, allocation: "protect-character", backend: "auto", saveOrder, mcIterations: 60000, seed: 11, maxExactStates: 1e6, maxExactWork: 1e12 });

  /** The rule played out directly: sort the results, walk them against the current group. */
  function played(needs: number[], groups: TargetGroup[], n: number, dmg: number, iters: number): { pKill: number; slain: number } {
    const next = mulberry32(2024);
    let kills = 0;
    let slain = 0;
    for (let it = 0; it < iters; it++) {
      const left = groups.map((g) => g.models);
      const cur = groups.map((g) => g.wounds);
      const rolls = Array.from({ length: n }, () => 1 + Math.floor(next() * 6)).sort((a, b) => a - b);
      for (const r of rolls) {
        const gi = left.findIndex((m) => m > 0);
        if (gi < 0) break;
        if (r !== 1 && r >= needs[gi]!) continue;
        const d = Math.min(dmg, cur[gi]!);
        cur[gi]! -= d;
        if (cur[gi]! <= 0) {
          left[gi]!--;
          cur[gi] = groups[gi]!.wounds;
        }
      }
      slain += groups.reduce((s, g, i) => s + g.models - left[i]!, 0);
      if (left.every((m) => m === 0)) kills++;
    }
    return { pKill: kills / iters, slain: slain / iters };
  }

  it("is the same as one wound at a time when every group saves on the same results", () => {
    // Five bodyguards and a character, all saving on 4+ against this profile.
    const groups = unit([[5, 2, false], [1, 5, true]]);
    const w = volley(14, [4, 4], 2);
    const a = runExact(input([w], groups, "ascending"))!;
    const b = runExact(input([w], groups, "each"))!;
    close(a.pKill, b.pKill, 1e-12);
    close(a.expectedDamage, b.expectedDamage, 1e-12);
    a.slainPMF.forEach((v, i) => close(v, b.slainPMF[i] ?? 0, 1e-12));
    // The sampler takes the same shortcut, so its draws are the ones the one-at-a-time run makes.
    const m = runMonteCarlo(input([w], groups, "ascending"));
    const n = runMonteCarlo(input([w], groups, "each"));
    close(m.pKill, n.pKill, 1e-12);
    close(m.expectedDamage, n.expectedDamage, 1e-12);
  });

  it("matches the rule played out directly", () => {
    // Five bodyguards saving on 5+ in front of a character saving on 4+, fourteen 2-damage wounds.
    const cases: Array<{ needs: number[]; groups: TargetGroup[]; n: number; dmg: number }> = [
      { needs: [5, 4], groups: unit([[5, 2, false], [1, 5, true]]), n: 14, dmg: 2 },
      // Ten bodies saving on 6+ in front of a 4+ character: the character all but never dies.
      { needs: [6, 4], groups: unit([[10, 1, false], [1, 4, true]]), n: 16, dmg: 1 },
      // Bodyguards with the better save: the low results they would have saved go to the character.
      { needs: [3, 4], groups: unit([[5, 3, false], [1, 5, true]]), n: 18, dmg: 2 },
      // Three groups.
      { needs: [2, 5, 4], groups: unit([[3, 1, false], [2, 2, false], [1, 3, true]]), n: 12, dmg: 1 },
    ];
    for (const c of cases) {
      const w = volley(c.n, c.needs, c.dmg);
      const ex = runExact(input([w], c.groups, "ascending"))!;
      const mc = runMonteCarlo(input([w], c.groups, "ascending"));
      const ref = played(c.needs, c.groups, c.n, c.dmg, 200000);
      close(ex.pKill, ref.pKill, 0.006);
      close(ex.expectedSlain, ref.slain, 0.03);
      close(mc.pKill, ex.pKill, 0.01);
      close(mc.expectedSlain, ex.expectedSlain, 0.05);
      close(ex.damagePMF.reduce((s, v) => s + v, 0), 1);
    }
    // Four cases against a two-hundred-thousand-iteration reference is slow, hence the timeout.
  }, 60_000);

  it("changes the answer for a led unit in the direction the rule implies", () => {
    // A 4++ character behind 3+ bodyguards against AP-2: the bodyguards eat the 1s to 4s and the
    // character sees mostly 5s and 6s, which save it. One at a time it would face fresh dice.
    const led = unit([[5, 2, false], [1, 5, true]]);
    const w = volley(14, [5, 4], 2);
    const asc = runExact(input([w], led, "ascending"))!;
    const each = runExact(input([w], led, "each"))!;
    expect(asc.pKill).toBeLessThan(each.pKill * 0.7);
    expect(asc.expectedDamage).toBeLessThan(each.expectedDamage);
    // Bodyguards with the better save are the other way round: every low result that would have
    // been wasted on their 3+ now lands on the character's 4+.
    const shielded = unit([[5, 3, false], [1, 5, true]]);
    const v = volley(18, [3, 4], 2);
    expect(runExact(input([v], shielded, "ascending"))!.pKill).toBeGreaterThan(runExact(input([v], shielded, "each"))!.pKill * 5);
  });

  it("holds the engine's identities on random profiles against mixed groups", () => {
    const faceProb = fc.constantFrom(uniform, [1 / 36, 7 / 36, 7 / 36, 7 / 36, 7 / 36, 7 / 36]);
    const arbWeapon = (nGroups: number) =>
      fc
        .record({
          count: fc.integer({ min: 1, max: 3 }),
          attacks: fc.constantFrom(delta(1), delta(3), dicePMF("D6")),
          pMiss: fc.double({ min: 0, max: 0.6, noNaN: true }),
          pCrit: fc.double({ min: 0, max: 0.3, noNaN: true }),
          pFail: fc.double({ min: 0, max: 0.6, noNaN: true }),
          lethal: fc.boolean(),
          devastating: fc.boolean(),
          needs: fc.array(fc.integer({ min: 2, max: 7 }), { minLength: nGroups, maxLength: nGroups }),
          faces: faceProb,
          dmg: fc.constantFrom(delta(1), delta(2), dicePMF("D3")),
        })
        .map((r): WeaponParams => {
          const faces = r.faces;
          return weapon({
            count: r.count,
            attacks: r.attacks,
            hit: { pMiss: r.pMiss, pHit: 1 - r.pMiss - r.pCrit, pCrit: r.pCrit },
            lethal: r.lethal,
            devastating: r.devastating,
            wound: { pFail: r.pFail, pWound: 1 - r.pFail - 1 / 6, pCrit: 1 / 6 },
            saveFaces: faces,
            groups: r.needs.map((need) => ({ pUnsaved: damageOn(need).reduce((s, x, i) => s + (x ? faces[i]! : 0), 0), damageOn: damageOn(need), damage: r.dmg, mortalDamage: delta(1) })),
          });
        });
    const arbCase = fc.integer({ min: 1, max: 3 }).chain((nGroups) =>
      fc.record({
        groups: fc.array(fc.tuple(fc.integer({ min: 1, max: 4 }), fc.integer({ min: 1, max: 3 })), { minLength: nGroups, maxLength: nGroups }).map((xs) => xs.map(([m, w], i): TargetGroup => ({ id: `${i}`, name: `g${i}`, models: m, wounds: w, isCharacter: i === nGroups - 1 }))),
        weapons: fc.array(arbWeapon(nGroups), { minLength: 1, maxLength: 2 }),
      }),
    );
    fc.assert(
      fc.property(arbCase, ({ groups, weapons }) => {
        const ex = runExact({ weapons, groups, allocation: "protect-character", backend: "exact", saveOrder: "ascending", mcIterations: 0, maxExactStates: 1e6, maxExactWork: 1e12 })!;
        const totalWounds = groups.reduce((s, g) => s + g.models * g.wounds, 0);
        close(ex.damagePMF.reduce((s, v) => s + v, 0), 1, 1e-9);
        close(ex.slainPMF.reduce((s, v) => s + v, 0), 1, 1e-9);
        expect(ex.expectedDamage).toBeGreaterThanOrEqual(-1e-12);
        expect(ex.expectedDamage).toBeLessThanOrEqual(totalWounds + 1e-9);
        expect(ex.pKill).toBeGreaterThanOrEqual(-1e-12);
        expect(ex.pKill).toBeLessThanOrEqual(1 + 1e-9);
        // The kill chance is the mass on every model slain, whichever order the saves were taken in.
        close(ex.pKill, ex.slainPMF[ex.slainPMF.length - 1] ?? 0, 1e-9);
      }),
      { numRuns: 40 },
    );
  });
});

describe("the work budget", () => {
  /*
   * The DP charge is the target's size. The per-hit tables are the attacker's, so they are charged
   * separately: the count field has no maximum, and a two-state DP can still want huge tables.
   */
  const many = (count: number): WeaponParams =>
    weapon({
      count,
      attacks: dicePMF("D6+2"),
      hit: { pMiss: 1 / 3, pHit: 1 / 2, pCrit: 1 / 6 },
      wound: { pFail: 1 / 3, pWound: 1 / 2, pCrit: 1 / 6 },
      singleRerollHit: true,
      singleRerollWound: true,
      groups: [{ pUnsaved: 0.5, damageOn: [true, true, true, false, false, false], damage: delta(1), mortalDamage: delta(1) }],
    });
  const run = (count: number, groups: TargetGroup[]) =>
    runExact({ weapons: [many(count)], groups, allocation: "in-order", backend: "exact", saveOrder: "ascending", mcIterations: 0, maxExactStates: 1e6, maxExactWork: 1e8 });

  it("gives up on a profile whose tables cost more than the DP it is charged for", () => {
    const tiny = [{ id: "g", name: "g", models: 1, wounds: 1, isCharacter: false }];
    const started = performance.now();
    expect(run(400, tiny)).toBeNull();
    // Nothing is built before the answer, so giving up is immediate.
    expect(performance.now() - started).toBeLessThan(100);
  });

  it("still solves every profile the game can field", () => {
    // The largest across the corpus is sixty attacks; the largest the snapshot allows is 30 models
    // of 2D6, which is three hundred and sixty.
    const squad = [{ id: "g", name: "g", models: 20, wounds: 2, isCharacter: false }];
    expect(run(10, squad)).not.toBeNull();
    expect(run(30, squad)).not.toBeNull();
  });
});
