import { makeSampler, mulberry32 } from "./rng";
import { groupOrder } from "./allocation";
import type { EngineInput, EngineOutput, WeaponParams, WeaponTrace } from "./types";
import { mean, pmfFromHistogram } from "./pmf";
import { survivalFromPMF } from "./stats";

interface Prepared {
  w: WeaponParams;
  attacks: () => number;
  sustained: (() => number) | null;
  damage: Array<() => number>;
  mortal: Array<() => number>;
  order: number[];
}

export function runMonteCarlo(input: EngineInput): EngineOutput {
  const rand = mulberry32(input.seed ?? 0x9e3779b9);
  const iters = Math.max(100, input.mcIterations);
  const groups = input.groups;
  const G = groups.length;
  const prepared: Prepared[] = input.weapons
    .filter((w) => w.count > 0)
    .map((w) => ({
      w,
      attacks: makeSampler(w.attacks, rand),
      sustained: w.sustained ? makeSampler(w.sustained, rand) : null,
      damage: w.groups.map((g) => makeSampler(g.damage, rand)),
      mortal: w.groups.map((g) => makeSampler(g.mortalDamage, rand)),
      order: groupOrder(groups, input.allocation, w.precision),
    }));

  const totalModels = groups.reduce((s, g) => s + g.models, 0);
  const totalWounds = groups.reduce((s, g) => s + g.models * g.wounds, 0);
  const slainHist = new Array<number>(totalModels + 1).fill(0);
  const dmgHist = new Array<number>(totalWounds + 1).fill(0);
  let wastedSum = 0;
  let killCount = 0;
  let ptsSum = 0;
  let dmgSum = 0;
  let dmgSq = 0;
  const tr = prepared.map(() => ({ attacks: 0, hits: 0, wounds: 0, unsaved: 0, damage: 0 }));

  const slain = new Array<number>(G).fill(0);
  const curW = new Array<number>(G).fill(0);

  const pickGroup = (order: number[]): number => {
    for (const g of order) if (slain[g]! < groups[g]!.models) return g;
    return -1;
  };
  const applyDamage = (g: number, d: number): { dealt: number; wasted: number } => {
    const grp = groups[g]!;
    const w = curW[g]!;
    if (d >= w) {
      slain[g] = slain[g]! + 1;
      curW[g] = grp.wounds;
      return { dealt: w, wasted: d - w };
    }
    curW[g] = w - d;
    return { dealt: d, wasted: 0 };
  };

  for (let it = 0; it < iters; it++) {
    for (let g = 0; g < G; g++) {
      slain[g] = 0;
      curW[g] = groups[g]!.wounds;
    }
    let wasted = 0;
    let dealt = 0;
    for (let wi = 0; wi < prepared.length; wi++) {
      const P = prepared[wi]!;
      const w = P.w;
      const t = tr[wi]!;
      let mortalEvents = 0;
      let rerollHit = w.singleRerollHit;
      let rerollWound = w.singleRerollWound;
      let fixedHitLeft = !!w.fixedHit && !w.autoHit;
      let fixedWoundLeft = !!w.fixedWound;
      for (let c = 0; c < w.count; c++) {
        const n = P.attacks();
        t.attacks += n;
        for (let a = 0; a < n; a++) {
          // hit roll
          let cat: 0 | 1 | 2; // miss, hit, crit
          if (w.autoHit) cat = 1;
          else if (fixedHitLeft) {
            fixedHitLeft = false;
            cat = w.fixedHit === "miss" ? 0 : w.fixedHit === "hit" ? 1 : 2;
          } else {
            let u = rand();
            cat = u < w.hit.pMiss ? 0 : u < w.hit.pMiss + w.hit.pHit ? 1 : 2;
            if (cat === 0 && rerollHit) {
              rerollHit = false;
              u = rand();
              cat = u < w.hit.pMiss ? 0 : u < w.hit.pMiss + w.hit.pHit ? 1 : 2;
            }
          }
          if (cat === 0) continue;
          let rollingHits = 0;
          let autoWounds = 0;
          if (cat === 1) rollingHits = 1;
          else {
            const extra = P.sustained ? P.sustained() : 0;
            if (w.lethal) {
              autoWounds = 1;
              rollingHits = extra;
            } else rollingHits = 1 + extra;
          }
          t.hits += rollingHits + autoWounds;
          let woundsNeedingSave = autoWounds;
          for (let h = 0; h < rollingHits; h++) {
            let u = rand();
            let wc: 0 | 1 | 2 = u < w.wound.pFail ? 0 : u < w.wound.pFail + w.wound.pWound ? 1 : 2;
            if (fixedWoundLeft) {
              fixedWoundLeft = false;
              wc = w.fixedWound === "fail" ? 0 : w.fixedWound === "wound" ? 1 : 2;
            } else if (wc === 0 && rerollWound) {
              rerollWound = false;
              u = rand();
              wc = u < w.wound.pFail ? 0 : u < w.wound.pFail + w.wound.pWound ? 1 : 2;
            }
            if (wc === 0) continue;
            if (wc === 2 && w.devastating) mortalEvents++;
            else woundsNeedingSave++;
          }
          t.wounds += woundsNeedingSave;
          for (let k = 0; k < woundsNeedingSave; k++) {
            const g = pickGroup(P.order);
            if (g < 0) {
              wasted += mean(w.groups[P.order[0] ?? 0]!.damage) * (w.groups[P.order[0] ?? 0]!.pUnsaved);
              continue;
            }
            if (rand() < w.groups[g]!.pUnsaved) {
              t.unsaved += 1;
              const d = P.damage[g]!();
              const r = applyDamage(g, d);
              dealt += r.dealt;
              wasted += r.wasted;
              t.damage += r.dealt;
            }
          }
        }
      }
      t.wounds += mortalEvents;
      t.unsaved += mortalEvents;
      for (let k = 0; k < mortalEvents; k++) {
        const g = pickGroup(P.order);
        if (g < 0) {
          wasted += mean(w.groups[P.order[0] ?? 0]!.mortalDamage);
          continue;
        }
        const d = P.mortal[g]!();
        const r = applyDamage(g, d);
        dealt += r.dealt;
        wasted += r.wasted;
        t.damage += r.dealt;
      }
    }
    let totalSlain = 0;
    let allDead = true;
    for (let g = 0; g < G; g++) {
      totalSlain += slain[g]!;
      ptsSum += slain[g]! * (groups[g]!.pointsPerModel ?? 0);
      if (slain[g]! < groups[g]!.models) allDead = false;
    }
    slainHist[totalSlain] = (slainHist[totalSlain] ?? 0) + 1;
    dmgHist[dealt] = (dmgHist[dealt] ?? 0) + 1;
    wastedSum += wasted;
    dmgSum += dealt;
    dmgSq += dealt * dealt;
    if (allDead) killCount++;
  }

  const damagePMF = pmfFromHistogram(dmgHist, iters);
  const slainPMF = pmfFromHistogram(slainHist, iters);
  const m = dmgSum / iters;
  const sd = Math.sqrt(Math.max(0, dmgSq / iters - m * m));
  const traces: WeaponTrace[] = prepared.map((P, i) => ({
    name: P.w.name,
    count: P.w.count,
    expectedAttacks: tr[i]!.attacks / iters,
    expectedHits: tr[i]!.hits / iters,
    expectedWounds: tr[i]!.wounds / iters,
    expectedUnsaved: tr[i]!.unsaved / iters,
    expectedDamage: tr[i]!.damage / iters,
  }));
  return {
    backend: "mc",
    iterations: iters,
    ciHalfWidth: (1.96 * sd) / Math.sqrt(iters),
    damagePMF,
    slainPMF,
    expectedDamage: m,
    expectedSlain: mean(slainPMF),
    pKill: killCount / iters,
    pAtLeastSlain: survivalFromPMF(slainPMF),
    expectedWasted: wastedSum / iters,
    expectedSelfMortals: prepared.reduce((s, P) => s + P.w.count * P.w.selfMortalsPerWeapon, 0),
    expectedPointsSlain: ptsSum / iters,
    weapons: traces,
    warnings: [],
  };
}
