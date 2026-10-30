import { type BPMF, baddScaled, bcompound, bcompoundOneReroll, bcompoundOneRerollTable, bconvolve, bdelta, bmean, btrim } from "./bivariate";
import { EPS, type PMF, binomial, convolvePow, delta, mean } from "./pmf";
import {
  type EventKind,
  type Moves,
  type Reach,
  type SaveClasses,
  type StateDist,
  type StateSpace,
  addScaledDist,
  applyEvent,
  emptyDist,
  eventKind,
  expectedDamage,
  groupOrder,
  makeStateSpace,
  orderKey,
  reachable,
  saveClasses,
  summarize,
} from "./allocation";
import type { EngineInput, EngineOutput, WeaponParams, WeaponTrace } from "./types";
import { survivalFromPMF } from "./stats";
import { engineWork } from "./work";

/**
 * The most reachable defender states the exact backend will hold, and the most states in the
 * product encoding a run hands back as its `finalState`.
 */
const DEFAULT_MAX_STATES = 40000;

/**
 * The work the exact backend takes on before it hands a run to the sampled backend, in state visits.
 *
 * A visit is one reachable state read by one event (a wound needing a save, or a mortal-damage
 * event) or added into one weighted sum. A weapon taking its saves one wound at a time costs about
 * `reachable × ((wsMax + 1) × (mtMax + 1) + wsMax + mtMax)` visits, where wsMax and mtMax are the
 * most wounds needing a save and the most mortal events it can cause. Saves resolved lowest first
 * add a term that grows with the square of wsMax and with the number of save classes. See
 * `lowestFirst`.
 */
const DEFAULT_MAX_WORK = 1e8;

/**
 * What one cell of the per-hit tables costs, in the state visits the budget above is counted in.
 *
 * Measured: one profile of D6+2 attacks with both re-rolls, against a single one-wound model,
 * takes 0.18 s at a count of 50 and 2.6 s at 200, which is a microsecond per squared attack
 * against the four nanoseconds a visit costs. At this figure the budget stops that profile at
 * about eighty, and leaves every profile the game can actually field exact: the largest across the
 * corpus is sixty attacks, and the largest the snapshot allows is three hundred and sixty.
 */
const TABLE_CELL = 250;

/**
 * What one cell costs again for a profile whose tables are a plane rather than a line.
 *
 * A hit is one number until Lethal Hits sends critical hits straight past the wound roll, and a
 * wound is one number until Devastating Wounds sends critical wounds past the save. Either of those
 * gives every table a second axis, so a table of n dice holds n² cells rather than n, and the whole
 * chain of tables costs the cube of the attacks rather than the square. Measured against one
 * one-wound model, a D6+2 profile with both keywords and both re-rolls takes 0.55 s at 320 attacks,
 * 1.4 s at 480 and 2.7 s at 640, against 0.1 s at 640 for the same profile with neither keyword.
 *
 * At this figure the budget leaves such a profile exact to about three hundred and ninety attacks,
 * which covers the largest the snapshot allows, and sends the rest to the sampled backend. A
 * profile without either keyword is charged as before and is unaffected.
 */
const TABLE_PLANE = 1;

/**
 * A binomial term below this weight is where a run of results stops being split further. Past the
 * mode the terms only fall, so what is left behind is smaller than this.
 */
const TAIL = 1e-17;

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

/**
 * One attack die taken all the way to (wounds needing a save, mortal-damage events).
 *
 * The die's hits each roll to wound on their own, so the die's outcome is its hit outcome with every
 * rolling hit replaced by one wound roll. A profile whose dice are independent of each other is then
 * one compound of this over the number of attacks.
 */
function perDieJoint(dieFull: BPMF, hitFull: BPMF): BPMF {
  const pows: BPMF[] = [bdelta()];
  let out: BPMF = [[0]];
  for (let rh = 0; rh < dieFull.length; rh++) {
    const row = dieFull[rh]!;
    for (let aw = 0; aw < row.length; aw++) {
      const p = row[aw] ?? 0;
      if (p < EPS) continue;
      while (pows.length <= rh) pows.push(bconvolve(pows[pows.length - 1]!, hitFull));
      const rolled = pows[rh]!;
      // The automatic wounds need a save like the rolled ones, so they move the outcome down `aw` rows.
      const shifted = aw ? [...Array.from({ length: aw }, () => new Array<number>(rolled[0]!.length).fill(0)), ...rolled] : rolled;
      out = baddScaled(out, shifted, p);
    }
  }
  return btrim(out);
}

/** What a weapon profile's dice come to before any of them reaches the defender. */
interface Tables {
  /** J[ws][mt]: the chance of `ws` wounds needing a save and `mt` mortal-damage events. Trimmed at EPS. */
  J: number[][];
  expectedAttacks: number;
  expectedHits: number;
}

/**
 * Whether the profile's attack dice are independent of each other. A single re-roll or a die set
 * to a fixed result ties the dice of one profile together, and those go through the hit table first.
 */
function diceIndependent(w: WeaponParams): boolean {
  return !w.fixedWound && !w.singleRerollWound && (w.autoHit || (!w.fixedHit && !w.singleRerollHit));
}

function buildTables(w: WeaponParams): Tables {
  engineWork.tableBuilds++;
  const attacksTotal = convolvePow(w.attacks, w.count);
  const die = perDieOutcome(w);
  const hit = perHitOutcome(w);
  if (diceIndependent(w)) {
    const J = btrim(bcompound(attacksTotal, perDieJoint(die.full, hit.full)));
    const perDie = bmean(die.full);
    const expectedAttacks = mean(attacksTotal);
    return { J, expectedAttacks, expectedHits: expectedAttacks * (perDie.a + perDie.b) };
  }
  const compoundHits = (count: PMF): BPMF => (w.singleRerollHit && !w.autoHit ? bcompoundOneReroll(count, die.full, w.hit.pMiss, die.givenNotMiss) : bcompound(count, die.full));
  let H: BPMF;
  if (w.fixedHit && !w.autoHit) {
    // one die is set, the remaining n-1 are rolled
    const fixed = fixedHitOutcome(w);
    const rolled = compoundHits(shiftDown(attacksTotal));
    H = baddScaled(baddScaled([[0]], bconvolve(rolled, fixed), 1 - (attacksTotal[0] ?? 0)), bdelta(), attacksTotal[0] ?? 0);
  } else H = compoundHits(attacksTotal);
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
  // Joint J[ws][mt], over the cells of H and WT that hold at least EPS.
  let wsMax = 0;
  let mtMax = 0;
  for (let rh = 0; rh <= rhMax; rh++) {
    const row = H[rh]!;
    for (let aw = 0; aw < row.length; aw++) {
      if ((row[aw] ?? 0) < EPS) continue;
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
      if (pw < EPS) continue;
      for (let ws = 0; ws < wt.length; ws++) {
        const wr = wt[ws]!;
        const jr = J[ws + aw]!;
        for (let mt = 0; mt < wr.length; mt++) {
          const v = wr[mt] ?? 0;
          if (v < EPS) continue;
          jr[mt] = jr[mt]! + pw * v;
        }
      }
    }
  }
  const hm = bmean(H);
  return { J: btrim(J), expectedAttacks: mean(attacksTotal), expectedHits: hm.a + hm.b };
}

/**
 * Tables already built, keyed by everything that goes into them.
 *
 * A profile's tables depend only on its dice: the attacks, the hit and wound chances and the
 * keywords that change how the dice fall. They do not depend on the defender's saves or damage, or
 * on the state the defender starts in. A chain of activations, a what-if variant that changes only
 * the defender and a matrix column all fire profiles whose tables are already here.
 */
const tableCache = new Map<string, Tables>();
const TABLE_CACHE_ENTRIES = 64;
const TABLE_CACHE_CELLS = 4_000_000;
let tableCacheCells = 0;

function tableKey(w: WeaponParams): string {
  return JSON.stringify([w.count, w.attacks, w.hit.pMiss, w.hit.pHit, w.hit.pCrit, w.autoHit, w.sustained, w.lethal, w.wound.pFail, w.wound.pWound, w.wound.pCrit, w.devastating, w.singleRerollHit, w.singleRerollWound, w.fixedHit ?? null, w.fixedWound ?? null]);
}

const cellsOf = (t: Tables): number => t.J.length * (t.J[0]?.length ?? 1);

function tablesFor(w: WeaponParams): Tables {
  const key = tableKey(w);
  const held = tableCache.get(key);
  if (held) {
    tableCache.delete(key);
    tableCache.set(key, held);
    return held;
  }
  const built = buildTables(w);
  tableCache.set(key, built);
  tableCacheCells += cellsOf(built);
  for (const [k, t] of tableCache) {
    if (tableCache.size <= TABLE_CACHE_ENTRIES && tableCacheCells <= TABLE_CACHE_CELLS) break;
    if (t === built) break;
    tableCache.delete(k);
    tableCacheCells -= cellsOf(t);
  }
  return built;
}

/**
 * Reachable state sets already built, keyed by the defender and the allocation orders.
 *
 * Each one is built from the fresh defender. A run that starts from a state inside it is given the
 * same set, and a run that starts anywhere else gets a set of its own, so a run's state count, and
 * with it whether the budget lets the run through, never depends on what ran before it.
 */
const reachCache = new Map<string, Reach | { over: number }>();
const REACH_CACHE_ENTRIES = 16;
const REACH_CACHE_STATES = 400_000;

const heldStates = (r: Reach | { over: number }): number => ("over" in r ? 0 : r.states.length);

function remember(key: string, r: Reach | { over: number }): void {
  reachCache.delete(key);
  reachCache.set(key, r);
  let total = 0;
  for (const v of reachCache.values()) total += heldStates(v);
  for (const [k, v] of reachCache) {
    if (reachCache.size <= REACH_CACHE_ENTRIES && total <= REACH_CACHE_STATES) break;
    if (v === r) break;
    reachCache.delete(k);
    total -= heldStates(v);
  }
}

function freshReach(space: StateSpace, orders: number[][], cap: number): Reach | null {
  const key = JSON.stringify([space.groups.map((g) => [g.models, g.wounds, g.pointsPerModel ?? 0]), orders]);
  const held = reachCache.get(key);
  if (held) {
    if ("over" in held) {
      if (cap <= held.over) return null;
    } else {
      remember(key, held);
      return held.states.length <= cap ? held : null;
    }
  }
  const built = reachable(space, orders, [0], cap);
  remember(key, built ?? { over: cap });
  return built;
}

/** The states a run from `support` can reach: those reachable from the fresh defender and from every start state. */
function reachFor(space: StateSpace, orders: number[][], support: number[] | null, cap: number): Reach | null {
  const fresh = freshReach(space, orders, cap);
  if (!fresh || !support) return fresh;
  if (support.every((s) => fresh.index.has(s))) return fresh;
  return reachable(space, orders, [0, ...support], cap);
}

/** The defender after one weapon, and the expected damage its mortal-damage events dealt. */
interface AfterWeapon {
  dist: StateDist;
  mortalDamage: number;
}

/**
 * `Σ_mt M^mt(Y[mt])`, where M applies one mortal-damage event. Mortal events are resolved after
 * the saves, so the sum for each mortal count is built first and the mortal events are applied to
 * the running total from the largest count down.
 *
 * `Σ_mt Y[mt]` is the defender after the saves alone, and expected damage is linear in the
 * distribution, so the mortal events' damage is E[damage](result) − Σ_mt E[damage](Y[mt]).
 */
function mortalsAfter(Y: Array<StateDist | null>, reach: Reach, moves: Moves, mortal: EventKind): AfterWeapon {
  let Z: StateDist | null = null;
  const mortals = Y.length > 1;
  let savesOnly = 0;
  for (let mt = Y.length - 1; mt >= 0; mt--) {
    if (Z) Z = applyEvent(reach, moves, Z, mortal, 0);
    const y = Y[mt];
    if (!y) continue;
    if (mortals) savesOnly += expectedDamage(reach, y);
    if (Z) addScaledDist(Z, y, 1);
    else Z = { p: new Float64Array(y.p), wasted: y.wasted, unsaved: y.unsaved };
  }
  const dist = Z ?? emptyDist(reach.states.length);
  return { dist, mortalDamage: mortals ? expectedDamage(reach, dist) - savesOnly : 0 };
}

/** The defender after one weapon whose saves are taken one wound at a time. */
function oneAtATime(reach: Reach, moves: Moves, dist: StateDist, J: number[][], save: EventKind, mortal: EventKind): AfterWeapon {
  const size = reach.states.length;
  const wsMax = J.length - 1;
  const mtMax = (J[0]?.length ?? 1) - 1;
  const Y: Array<StateDist | null> = new Array<StateDist | null>(mtMax + 1).fill(null);
  if (mtMax === 0 || wsMax > mtMax) {
    // One walk along the saves, adding each save count's share to the sum for each mortal count.
    let S1 = dist;
    for (let ws = 0; ws <= wsMax; ws++) {
      const row = J[ws]!;
      for (let mt = 0; mt <= mtMax; mt++) {
        const pj = row[mt]!;
        if (pj < EPS) continue;
        addScaledDist((Y[mt] ??= emptyDist(size)), S1, pj);
      }
      if (ws < wsMax) S1 = applyEvent(reach, moves, S1, save, EPS);
    }
  } else {
    // Fewer save counts than mortal counts: keep the walk along the saves and build each sum from it.
    const chain: StateDist[] = [dist];
    for (let ws = 1; ws <= wsMax; ws++) chain.push(applyEvent(reach, moves, chain[ws - 1]!, save, EPS));
    for (let mt = 0; mt <= mtMax; mt++) {
      for (let ws = 0; ws <= wsMax; ws++) {
        const pj = J[ws]![mt]!;
        if (pj < EPS) continue;
        addScaledDist((Y[mt] ??= emptyDist(size)), chain[ws]!, pj);
      }
    }
  }
  return mortalsAfter(Y, reach, moves, mortal);
}

/** The first count past the mode of `bin` whose term falls below TAIL, or its length. */
function binomialEnd(bin: PMF): number {
  let mode = 0;
  for (let n = 1; n < bin.length; n++) if (bin[n]! > bin[mode]!) mode = n;
  for (let n = mode + 1; n < bin.length; n++) if (bin[n]! < TAIL) return n;
  return bin.length;
}

/**
 * The defender after one weapon whose saves are rolled together and resolved from the lowest
 * result up, each result against whichever group is current when it is reached.
 *
 * With the results sorted, every result of the first class lands before any of the second, so the
 * classes are resolved in order. With r results not yet placed, the number that fall in class k is
 * Binomial(r, q_k / (q_k + … + q_{K−1} + rest)). Class k is applied that many times and the other
 * results carry on to class k + 1. The last class's results are applied and the rest save against
 * every group. For each mortal count, the weights over the save counts are that column of J.
 *
 * Class 0 starts from the same distribution for every result count, so its powers are built once.
 * The last class ends in one sum, so its terms are gathered by count and applied from the largest
 * count down. Two classes therefore cost about 2·wsMax events, and each class between them adds
 * about wsMax²/2.
 */
function lowestFirst(reach: Reach, moves: Moves, dist: StateDist, J: number[][], classes: SaveClasses, order: number[], w: WeaponParams, mortal: EventKind): AfterWeapon {
  const size = reach.states.length;
  const wsMax = J.length - 1;
  const mtMax = (J[0]?.length ?? 1) - 1;
  const K = classes.probs.length;
  const dmg = w.groups.map((g) => g.damage);
  const kinds = classes.fails.map((f) => eventKind(order, f, dmg, true));
  // A class of less than EPS takes no results, and neither does the rest when it is under EPS.
  const probs = classes.probs.map((p) => (p < EPS ? 0 : p));
  const rawRest = 1 - classes.probs.reduce((s, p) => s + p, 0);
  let tail = probs.reduce((s, p) => s + p, 0) + (rawRest > EPS ? rawRest : 0);
  const cond: number[] = [];
  for (const q of probs) {
    cond.push(tail > 0 ? Math.min(1, q / tail) : 0);
    tail -= q;
  }
  const bins: PMF[][] = cond.map(() => []);
  const binOf = (k: number, r: number): PMF => (bins[k]![r] ??= binomial(r, cond[k]!));
  const ends: number[][] = cond.map(() => []);
  const endOf = (k: number, r: number): number => (ends[k]![r] ??= binomialEnd(binOf(k, r)));
  const powers: StateDist[] = [dist];
  const power = (n: number): StateDist => {
    while (powers.length <= n) powers.push(applyEvent(reach, moves, powers[powers.length - 1]!, kinds[0]!, EPS));
    return powers[n]!;
  };
  const Y: Array<StateDist | null> = new Array<StateDist | null>(mtMax + 1).fill(null);
  for (let mt = 0; mt <= mtMax; mt++) {
    // Class 0, from the powers of the start distribution.
    let X: Array<StateDist | null> = new Array<StateDist | null>(wsMax + 1).fill(null);
    let any = false;
    for (let r = 0; r <= wsMax; r++) {
      const v = J[r]![mt]!;
      if (v < EPS) continue;
      const bin = binOf(0, r);
      const end = endOf(0, r);
      for (let n = 0; n < end; n++) {
        const b = bin[n]!;
        if (b > 0) addScaledDist((X[r - n] ??= emptyDist(size)), power(n), v * b);
      }
      any = true;
    }
    if (!any) continue;
    // The classes between the first and the last, one result count at a time.
    for (let k = 1; k < K - 1; k++) {
      const next: Array<StateDist | null> = new Array<StateDist | null>(wsMax + 1).fill(null);
      for (let r = 0; r <= wsMax; r++) {
        let y = X[r];
        if (!y) continue;
        const bin = binOf(k, r);
        const end = endOf(k, r);
        for (let n = 0; n < end; n++) {
          const b = bin[n]!;
          if (b > 0) addScaledDist((next[r - n] ??= emptyDist(size)), y, b);
          if (n + 1 < end) y = applyEvent(reach, moves, y, kinds[k]!, 0);
        }
      }
      X = next;
    }
    // The last class, gathered by how many of its results land.
    const last = K - 1;
    const byCount: Array<StateDist | null> = [];
    for (let r = 0; r <= wsMax; r++) {
      const y = X[r];
      if (!y) continue;
      const bin = binOf(last, r);
      const end = endOf(last, r);
      for (let n = 0; n < end; n++) {
        const b = bin[n]!;
        if (b > 0) addScaledDist((byCount[n] ??= emptyDist(size)), y, b);
      }
    }
    let Z: StateDist | null = null;
    for (let n = byCount.length - 1; n >= 0; n--) {
      if (Z) Z = applyEvent(reach, moves, Z, kinds[last]!, 0);
      const y = byCount[n];
      if (!y) continue;
      if (Z) addScaledDist(Z, y, 1);
      else Z = { p: new Float64Array(y.p), wasted: y.wasted, unsaved: y.unsaved };
    }
    Y[mt] = Z;
  }
  return mortalsAfter(Y, reach, moves, mortal);
}

/** Returns null when the target is too large for the exact path, by state count or by DP work. */
export function runExact(input: EngineInput): EngineOutput | null {
  const space = makeStateSpace(input.groups);
  if (!(space.total <= Number.MAX_SAFE_INTEGER)) return null;
  const maxStates = input.maxExactStates ?? DEFAULT_MAX_STATES;
  const maxWork = input.maxExactWork ?? DEFAULT_MAX_WORK;
  let support: number[] | null = null;
  if (input.initialState) {
    if (input.initialState.length !== space.total) throw new Error("initialState does not match the target's state space");
    support = [];
    for (let s = 0; s < input.initialState.length; s++) if ((input.initialState[s] ?? 0) > 0) support.push(s);
  }
  const weapons = input.weapons.filter((w) => w.count > 0);
  const orders: number[][] = [];
  const orderKeys = new Set<string>();
  for (const w of weapons) {
    const order = groupOrder(input.groups, input.allocation, w.precision);
    const key = orderKey(order);
    if (orderKeys.has(key)) continue;
    orderKeys.add(key);
    orders.push(order);
  }
  const reach = reachFor(space, orders, support, maxStates);
  if (!reach) return null;
  const size = reach.states.length;
  let work = 0;
  const warnings: string[] = [];
  let dist = emptyDist(size);
  if (support) for (const s of support) dist.p[reach.index.get(s)!] = input.initialState![s]!;
  else dist.p[reach.index.get(0)!] = 1;
  const startDamage = expectedDamage(reach, dist);
  const startFin = support ? summarize(reach, dist) : null;
  const traces: WeaponTrace[] = [];
  let selfMortals = 0;

  for (const w of weapons) {
    // What the per-hit tables below will cost, charged before they are built.
    //
    // The charge further down measures the DP, whose size is the target's. It says nothing about
    // the tables, whose size is the attacker's. The tables hold a grid per rolled hit and each grid
    // grows with the count, so the work is the square of the attacks, and the cube of them when
    // Lethal Hits or Devastating Wounds gives the grids a second axis. A cell of one costs a few
    // hundred times what a state visit costs, which is what TABLE_CELL and TABLE_PLANE carry, and
    // all of it is added into the one budget. It is charged whether or not the tables are cached.
    const attacksMax = (w.attacks.length - 1) * w.count;
    work += attacksMax * attacksMax * TABLE_CELL;
    if ((w.lethal && !w.autoHit) || w.devastating) work += attacksMax * attacksMax * attacksMax * TABLE_PLANE;
    if (work > maxWork) return null;
    const { J, expectedAttacks, expectedHits } = tablesFor(w);
    const wsMax = J.length - 1;
    const mtMax = (J[0]?.length ?? 1) - 1;
    const order = groupOrder(input.groups, input.allocation, w.precision);
    const classes = input.saveOrder === "ascending" ? saveClasses(w) : null;
    // How many state visits this weapon's DP will cost, now that the two event counts are known.
    // Weapons add up, so a unit with many profiles reaches the budget sooner than one profile does.
    work += size * ((wsMax + 1) * (mtMax + 1) + wsMax + mtMax);
    if (classes) work += (size * (mtMax + 1) * classes.probs.length * (wsMax + 1) * (wsMax + 1)) / 2;
    if (work > maxWork) return null;
    const moves = reach.moves.get(orderKey(order))!;
    const mortal = eventKind(order, w.groups.map(() => 1), w.groups.map((g) => g.mortalDamage), false);
    const save = eventKind(order, w.groups.map((g) => g.pUnsaved), w.groups.map((g) => g.damage), true);
    const { dist: next, mortalDamage } = classes ? lowestFirst(reach, moves, dist, J, classes, order, w, mortal) : oneAtATime(reach, moves, dist, J, save, mortal);
    let ws = 0;
    let mt = 0;
    for (let i = 0; i < J.length; i++) {
      const row = J[i]!;
      for (let j = 0; j < row.length; j++) {
        ws += i * row[j]!;
        mt += j * row[j]!;
      }
    }
    const before = expectedDamage(reach, dist);
    const after = expectedDamage(reach, next);
    traces.push({
      name: w.name,
      count: w.count,
      expectedAttacks,
      expectedHits,
      expectedWounds: ws + mt,
      expectedUnsaved: next.unsaved - dist.unsaved + mt,
      expectedDamage: after - before,
      expectedMortalDamage: mortalDamage,
    });
    selfMortals += w.count * w.selfMortalsPerWeapon;
    dist = next;
  }

  const fin = summarize(reach, dist);
  // when chained, report the damage/slain achieved *in this run* as expectations, and cumulative PMFs
  let finalState: number[] | undefined;
  if (space.total <= maxStates) {
    finalState = new Array<number>(space.total).fill(0);
    for (let c = 0; c < size; c++) {
      const v = dist.p[c]!;
      if (v !== 0) finalState[reach.states[c]!] = v;
    }
  }
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
    ...(finalState ? { finalState } : {}),
  };
}

export type { PMF };
