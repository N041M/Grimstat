import { type BPMF, bcompound, bcompoundOneReroll, bconvolve, bdelta, bmean, btrim } from "./bivariate";
import { type PMF, convolvePow, delta, mean } from "./pmf";
import {
  type StateDist,
  type StateSpace,
  applyEvent,
  damageInGroup,
  decode,
  groupOrder,
  initialDist,
  makeStateSpace,
  mixDists,
  summarize,
} from "./allocation";
import type { EngineInput, EngineOutput, WeaponParams, WeaponTrace } from "./types";
import { survivalFromPMF } from "./stats";

const DEFAULT_MAX_STATES = 40000;

/** Per attack die: bivariate (rolling hits, automatic wounds). */
function perDieOutcome(w: WeaponParams): { full: BPMF; givenNotMiss: BPMF } {
  if (w.autoHit) {
    const d = bdelta(1, 0);
    return { full: d, givenNotMiss: d };
  }
  const rows = 2 + (w.sustained ? w.sustained.length : 0);
  const B: BPMF = [];
  for (let i = 0; i < rows; i++) B.push([0, 0]);
  B[0]![0] = w.hit.pMiss;
  B[1]![0] = (B[1]![0] ?? 0) + w.hit.pHit;
  const sus = w.sustained ?? delta(0);
  for (let x = 0; x < sus.length; x++) {
    const px = sus[x] ?? 0;
    if (px <= 0) continue;
    if (w.lethal) B[x]![1] = (B[x]![1] ?? 0) + w.hit.pCrit * px;
    else B[1 + x]![0] = (B[1 + x]![0] ?? 0) + w.hit.pCrit * px;
  }
  const full = btrim(B);
  const notMiss = full.map((r) => r.slice());
  notMiss[0]![0] = 0;
  const z = 1 - w.hit.pMiss;
  const givenNotMiss = z > 0 ? btrim(notMiss.map((r) => r.map((v) => v / z))) : bdelta();
  return { full, givenNotMiss };
}

/** Per rolling hit: bivariate (wounds needing a save, mortal-damage events). */
function perHitOutcome(w: WeaponParams): { full: BPMF; givenNotFail: BPMF } {
  const B: BPMF = [
    [w.wound.pFail, w.devastating ? w.wound.pCrit : 0],
    [w.wound.pWound + (w.devastating ? 0 : w.wound.pCrit), 0],
  ];
  const full = btrim(B);
  const z = 1 - w.wound.pFail;
  const nf = full.map((r) => r.slice());
  nf[0]![0] = 0;
  return { full, givenNotFail: z > 0 ? btrim(nf.map((r) => r.map((v) => v / z))) : bdelta() };
}

function expectedDamage(space: StateSpace, dist: StateDist): number {
  let e = 0;
  for (let s = 0; s < space.total; s++) {
    const ps = dist.p[s] ?? 0;
    if (ps <= 0) continue;
    const locals = decode(space, s);
    let d = 0;
    for (let g = 0; g < locals.length; g++) d += damageInGroup(space.groups[g]!, locals[g]!);
    e += ps * d;
  }
  return e;
}

/** Returns null when the DP state space is too large for the exact path. */
export function runExact(input: EngineInput): EngineOutput | null {
  const space = makeStateSpace(input.groups);
  if (space.total > (input.maxExactStates ?? DEFAULT_MAX_STATES)) return null;
  const warnings: string[] = [];
  let dist = initialDist(space);
  const traces: WeaponTrace[] = [];
  let selfMortals = 0;

  for (const w of input.weapons) {
    if (w.count <= 0) continue;
    const attacksTotal = convolvePow(w.attacks, w.count);
    const die = perDieOutcome(w);
    const H = w.singleRerollHit && !w.autoHit ? bcompoundOneReroll(attacksTotal, die.full, w.hit.pMiss, die.givenNotMiss) : bcompound(attacksTotal, die.full);
    const hit = perHitOutcome(w);
    const rhMax = H.length - 1;
    // WT[rh] = outcome of rh rolling hits
    const WT: BPMF[] = [bdelta()];
    for (let rh = 1; rh <= rhMax; rh++) {
      WT.push(w.singleRerollWound ? bcompoundOneReroll(delta(rh), hit.full, w.wound.pFail, hit.givenNotFail) : bconvolve(WT[rh - 1]!, hit.full));
    }
    // Joint J[ws][mt]
    let wsMax = 0;
    let mtMax = 0;
    for (let rh = 0; rh <= rhMax; rh++) {
      const row = H[rh]!;
      for (let aw = 0; aw < row.length; aw++) {
        if ((row[aw] ?? 0) <= 0) continue;
        wsMax = Math.max(wsMax, WT[rh]!.length - 1 + aw);
        for (const r of WT[rh]!) mtMax = Math.max(mtMax, r.length - 1);
      }
    }
    const J: number[][] = [];
    for (let i = 0; i <= wsMax; i++) J.push(new Array<number>(mtMax + 1).fill(0));
    for (let rh = 0; rh <= rhMax; rh++) {
      const row = H[rh]!;
      const wt = WT[rh]!;
      for (let aw = 0; aw < row.length; aw++) {
        const pw = row[aw] ?? 0;
        if (pw <= 0) continue;
        for (let ws = 0; ws < wt.length; ws++) {
          const wr = wt[ws]!;
          for (let mt = 0; mt < wr.length; mt++) {
            const v = wr[mt] ?? 0;
            if (v <= 0) continue;
            J[ws + aw]![mt] = (J[ws + aw]![mt] ?? 0) + pw * v;
          }
        }
      }
    }
    // DP over the joint
    const order = groupOrder(input.groups, input.allocation, w.precision);
    const pUnsaved = w.groups.map((g) => g.pUnsaved);
    const dmg = w.groups.map((g) => g.damage);
    const mortal = w.groups.map((g) => g.mortalDamage);
    const ones = w.groups.map(() => 1);
    const parts: Array<{ w: number; d: StateDist }> = [];
    let S1 = dist;
    for (let ws = 0; ws <= wsMax; ws++) {
      const jr = J[ws]!;
      let S2 = S1;
      for (let mt = 0; mt <= mtMax; mt++) {
        const pj = jr[mt] ?? 0;
        if (pj > 0) parts.push({ w: pj, d: S2 });
        if (mt < mtMax) S2 = applyEvent(space, S2, order, ones, mortal, false);
      }
      if (ws < wsMax) S1 = applyEvent(space, S1, order, pUnsaved, dmg, true);
    }
    const next = mixDists(parts, space);
    const hm = bmean(H);
    let ws = 0;
    let mt = 0;
    for (let i = 0; i < J.length; i++) for (let j = 0; j < (J[i]?.length ?? 0); j++) {
      ws += i * (J[i]![j] ?? 0);
      mt += j * (J[i]![j] ?? 0);
    }
    const before = expectedDamage(space, dist);
    const after = expectedDamage(space, next);
    traces.push({
      name: w.name,
      count: w.count,
      expectedAttacks: mean(attacksTotal),
      expectedHits: hm.a + hm.b,
      expectedWounds: ws + mt,
      expectedUnsaved: next.unsaved - dist.unsaved + mt,
      expectedDamage: after - before,
    });
    selfMortals += w.count * w.selfMortalsPerWeapon;
    dist = next;
  }

  const fin = summarize(space, dist);
  return {
    backend: "exact",
    damagePMF: fin.damagePMF,
    slainPMF: fin.slainPMF,
    expectedDamage: mean(fin.damagePMF),
    expectedSlain: mean(fin.slainPMF),
    pKill: fin.pKill,
    pAtLeastSlain: survivalFromPMF(fin.slainPMF),
    expectedWasted: dist.wasted,
    expectedSelfMortals: selfMortals,
    expectedPointsSlain: fin.expectedPointsSlain,
    weapons: traces,
    warnings,
  };
}

export type { PMF };
