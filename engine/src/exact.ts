import { type BPMF, baddScaled, bcompound, bcompoundOneReroll, bcompoundOneRerollTable, bconvolve, bdelta, bmean, btrim } from "./bivariate";
import { EPS, type PMF, convolvePow, delta, mean } from "./pmf";
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
  saveClasses,
  type SaveClasses,
  summarize,
} from "./allocation";
import type { EngineInput, EngineOutput, WeaponParams, WeaponTrace } from "./types";
import { survivalFromPMF } from "./stats";

const DEFAULT_MAX_STATES = 40000;

/**
 * State-visit budget for the DP, which walks the state space once per wound needing a save and once
 * per mortal-damage event: about `states × (wsMax + 1) × (mtMax + 1)` visits per weapon. A visit
 * costs roughly 4 ns, so this is a DP of about half a second. Larger targets go to Monte Carlo.
 */
const DEFAULT_MAX_WORK = 1e8;

/**
 * What one cell of the per-hit tables costs, in the state visits the budget above counts. A cell is
 * about a microsecond against the 4 ns of a visit, which holds a profile exact to roughly eighty
 * attacks.
 */
const TABLE_CELL = 250;

/**
 * The same, for a profile whose tables are a plane rather than a line. Lethal Hits and Devastating
 * Wounds each give every table a second axis, so a table of n dice holds n² cells and the chain
 * costs the cube of the attacks. Such a profile stays exact to about three hundred and ninety.
 */
const TABLE_PLANE = 1;

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

/** Shift a count PMF down by one (the fixed die), dropping P(0). Result is unnormalised on purpose. */
function shiftDown(p: PMF): PMF {
  const out = p.slice(1);
  const z = 1 - (p[0] ?? 0);
  return z > 0 ? out.map((v) => v / z) : delta(0);
}

function fixedHitOutcome(w: WeaponParams): BPMF {
  if (w.fixedHit === "miss") return bdelta(0, 0);
  if (w.fixedHit === "hit") return bdelta(1, 0);
  // critical hit: sustained extras + lethal
  const sus = w.sustained ?? delta(0);
  const B: BPMF = [];
  for (let i = 0; i < 2 + sus.length; i++) B.push([0, 0]);
  for (let x = 0; x < sus.length; x++) {
    const px = sus[x] ?? 0;
    if (px <= 0) continue;
    if (w.lethal) B[x]![1] = (B[x]![1] ?? 0) + px;
    else B[1 + x]![0] = (B[1 + x]![0] ?? 0) + px;
  }
  return btrim(B);
}

function fixedWoundOutcome(w: WeaponParams): BPMF {
  if (w.fixedWound === "fail") return bdelta(0, 0);
  if (w.fixedWound === "wound") return bdelta(1, 0);
  return w.devastating ? bdelta(0, 1) : bdelta(1, 0);
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

function choose(n: number, k: number): number {
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return r;
}

/** State visits the lowest-first save order adds for a profile of up to `wsMax` saves in `K` classes. */
function pooledVisits(wsMax: number, K: number): number {
  // One chain state per vector of class counts, and one mixture term per (save count, vector) pair.
  return choose(wsMax + K, K) + choose(wsMax + K + 1, K + 1);
}

/**
 * The defender after `ws` saves resolved lowest first. With the results sorted, a run of `ws` saves
 * is a multinomial draw of class counts, and the classes are applied in order, each result to
 * whichever group is current when it is reached. Chain states are shared across the save counts.
 */
function pooledStates(space: StateSpace, start: StateDist, order: number[], dmg: PMF[], classes: SaveClasses, wsMax: number): (ws: number) => StateDist {
  const K = classes.probs.length;
  const rest = Math.max(0, 1 - classes.probs.reduce((s, p) => s + p, 0));
  const logQ = classes.probs.map((p) => Math.log(p));
  const logRest = rest > EPS ? Math.log(rest) : Number.NEGATIVE_INFINITY;
  const logFact: number[] = [0];
  for (let n = 1; n <= wsMax; n++) logFact.push(logFact[n - 1]! + Math.log(n));
  const memo = new Map<string, StateDist>([[new Array<number>(K).fill(0).join(","), start]]);
  const stateFor = (n: number[]): StateDist => {
    const key = n.join(",");
    const known = memo.get(key);
    if (known) return known;
    let k = K - 1;
    while ((n[k] ?? 0) === 0) k--;
    const parent = n.slice();
    parent[k]! -= 1;
    const s = applyEvent(space, stateFor(parent), order, classes.fails[k]!, dmg, true);
    memo.set(key, s);
    return s;
  };
  return (ws: number): StateDist => {
    const parts: Array<{ w: number; d: StateDist }> = [];
    const n = new Array<number>(K).fill(0);
    const walk = (k: number, used: number, logW: number): void => {
      if (k === K) {
        const left = ws - used;
        if (left > 0 && rest <= EPS) return;
        const lw = logW + logFact[ws]! - logFact[left]! + (left > 0 ? left * logRest : 0);
        parts.push({ w: Math.exp(lw), d: stateFor(n.slice()) });
        return;
      }
      for (let c = 0; c + used <= ws; c++) {
        if (c > 0 && (classes.probs[k] ?? 0) < EPS) break;
        n[k] = c;
        walk(k + 1, used + c, logW - logFact[c]! + (c > 0 ? c * logQ[k]! : 0));
      }
      n[k] = 0;
    };
    walk(0, 0, 0);
    return mixDists(parts, space);
  };
}

/** Returns null when the target is too large for the exact path, by state count or by DP work. */
export function runExact(input: EngineInput): EngineOutput | null {
  const space = makeStateSpace(input.groups);
  if (space.total > (input.maxExactStates ?? DEFAULT_MAX_STATES)) return null;
  const maxWork = input.maxExactWork ?? DEFAULT_MAX_WORK;
  let work = 0;
  const warnings: string[] = [];
  let dist = initialDist(space);
  if (input.initialState) {
    if (input.initialState.length !== space.total) throw new Error("initialState does not match the target's state space");
    dist = { p: Float64Array.from(input.initialState), wasted: 0, unsaved: 0 };
  }
  const startDamage = expectedDamage(space, dist);
  const traces: WeaponTrace[] = [];
  let selfMortals = 0;

  for (const w of input.weapons) {
    if (w.count <= 0) continue;
    // What the per-hit tables will cost, charged before they are built. Their size is the
    // attacker's, so the DP charge further down, whose size is the target's, does not cover them:
    // the work is the square of the attacks, and the cube when the grids take a second axis.
    const attacksMax = (w.attacks.length - 1) * w.count;
    work += attacksMax * attacksMax * TABLE_CELL;
    if ((w.lethal && !w.autoHit) || w.devastating) work += attacksMax * attacksMax * attacksMax * TABLE_PLANE;
    if (work > maxWork) return null;
    const attacksTotal = convolvePow(w.attacks, w.count);
    const die = perDieOutcome(w);
    const compoundHits = (count: PMF): BPMF => (w.singleRerollHit && !w.autoHit ? bcompoundOneReroll(count, die.full, w.hit.pMiss, die.givenNotMiss) : bcompound(count, die.full));
    let H: BPMF;
    if (w.fixedHit && !w.autoHit) {
      // one die is set, the remaining n-1 are rolled
      const fixed = fixedHitOutcome(w);
      const rolled = compoundHits(shiftDown(attacksTotal));
      H = baddScaled(baddScaled([[0]], bconvolve(rolled, fixed), 1 - (attacksTotal[0] ?? 0)), bdelta(), attacksTotal[0] ?? 0);
    } else H = compoundHits(attacksTotal);
    const hit = perHitOutcome(w);
    const rhMax = H.length - 1;
    // R[k] = outcome of k rolled wound dice; WT[rh] = outcome of rh rolling hits (one die fixed when fixedWound is set)
    const fixedW = w.fixedWound ? fixedWoundOutcome(w) : null;
    let R: BPMF[];
    if (w.singleRerollWound) R = bcompoundOneRerollTable(rhMax, hit.full, w.wound.pFail, hit.givenNotFail);
    else {
      R = [bdelta()];
      for (let k = 1; k <= rhMax; k++) R.push(bconvolve(R[k - 1]!, hit.full));
    }
    const WT: BPMF[] = [bdelta()];
    for (let rh = 1; rh <= rhMax; rh++) WT.push(fixedW ? bconvolve(R[rh - 1]!, fixedW) : R[rh]!);
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
    const order = groupOrder(input.groups, input.allocation, w.precision);
    const classes = input.saveOrder === "ascending" ? saveClasses(w) : null;
    // How many state visits this weapon's DP will cost, now that the two event counts are known.
    // Weapons add up, so a unit with many profiles reaches the budget sooner than one profile does.
    work += space.total * (wsMax + 1) * (mtMax + 1);
    if (classes) work += space.total * pooledVisits(wsMax, classes.probs.length);
    if (work > maxWork) return null;
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
    const pUnsaved = w.groups.map((g) => g.pUnsaved);
    const dmg = w.groups.map((g) => g.damage);
    const mortal = w.groups.map((g) => g.mortalDamage);
    const ones = w.groups.map(() => 1);
    const parts: Array<{ w: number; d: StateDist }> = [];
    const pooled = classes ? pooledStates(space, dist, order, dmg, classes, wsMax) : null;
    let S1 = dist;
    for (let ws = 0; ws <= wsMax; ws++) {
      const jr = J[ws]!;
      if (jr.some((v) => v > 0)) {
        let S2 = pooled ? pooled(ws) : S1;
        for (let mt = 0; mt <= mtMax; mt++) {
          const pj = jr[mt] ?? 0;
          if (pj > 0) parts.push({ w: pj, d: S2 });
          if (mt < mtMax) S2 = applyEvent(space, S2, order, ones, mortal, false);
        }
      }
      if (!pooled && ws < wsMax) S1 = applyEvent(space, S1, order, pUnsaved, dmg, true);
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
  // when chained, report the damage/slain achieved *in this run* as expectations, and cumulative PMFs
  const startFin = input.initialState ? summarize(space, { p: Float64Array.from(input.initialState), wasted: 0, unsaved: 0 }) : null;
  return {
    backend: "exact",
    damagePMF: fin.damagePMF,
    slainPMF: fin.slainPMF,
    expectedDamage: mean(fin.damagePMF) - startDamage,
    expectedSlain: mean(fin.slainPMF) - (startFin ? mean(startFin.slainPMF) : 0),
    pKill: fin.pKill,
    pAtLeastSlain: survivalFromPMF(fin.slainPMF),
    expectedWasted: dist.wasted,
    expectedSelfMortals: selfMortals,
    expectedPointsSlain: fin.expectedPointsSlain - (startFin ? startFin.expectedPointsSlain : 0),
    weapons: traces,
    warnings,
    finalState: Array.from(dist.p),
  };
}

export type { PMF };
