import type { PMF } from "./pmf";
import { EPS, mean } from "./pmf";
import type { AllocationOrder, GroupParams, TargetGroup, WeaponParams } from "./types";
import { engineWork } from "./work";

/**
 * Mixed-radix encoding of the defender's state.
 * For group g with M models of W wounds: local index l in [0, M*W]:
 *   l = i*W + (W - w)  for the (i)-th model (0-based) having w wounds remaining (1..W)
 *   l = M*W            terminal: all models in the group slain
 */
export interface StateSpace {
  groups: TargetGroup[];
  sizes: number[]; // per-group local size = M*W + 1
  strides: number[];
  total: number;
}

/**
 * The encoding above counts whole models and whole wounds, so a group is read as a whole number of
 * models with at least one wound each. A group of zero wounds has only one local index. That index
 * is the one every reader here treats as "every model in the group is dead", so the exact backend
 * reported such a group wiped out before a shot was fired. The sampled backend had the same group
 * standing. Both backends take their models from this function, so they read the same defender.
 */
function readGroup(g: TargetGroup): TargetGroup {
  const models = Number.isFinite(g.models) ? Math.max(0, Math.round(g.models)) : 0;
  const wounds = Number.isFinite(g.wounds) ? Math.max(1, Math.round(g.wounds)) : 1;
  return models === g.models && wounds === g.wounds ? g : { ...g, models, wounds };
}

export function makeStateSpace(raw: TargetGroup[]): StateSpace {
  const groups = raw.map(readGroup);
  const sizes = groups.map((g) => g.models * g.wounds + 1);
  const strides: number[] = [];
  let acc = 1;
  for (const s of sizes) {
    strides.push(acc);
    acc *= s;
  }
  return { groups, sizes, strides, total: acc };
}

export function decode(space: StateSpace, idx: number): number[] {
  const out: number[] = [];
  for (let g = 0; g < space.sizes.length; g++) {
    out.push(Math.floor(idx / (space.strides[g] ?? 1)) % (space.sizes[g] ?? 1));
  }
  return out;
}

export function slainInGroup(g: TargetGroup, local: number): number {
  if (local >= g.models * g.wounds) return g.models;
  return Math.floor(local / g.wounds);
}

export function damageInGroup(g: TargetGroup, local: number): number {
  // wounds removed so far in this group
  return Math.min(local, g.models * g.wounds);
}

export function isTerminal(g: TargetGroup, local: number): boolean {
  return local >= g.models * g.wounds;
}

/** Order in which groups receive allocations for a given weapon. */
export function groupOrder(groups: TargetGroup[], allocation: AllocationOrder, precision: boolean): number[] {
  const idx = groups.map((_, i) => i);
  if (precision) {
    // attacker chooses: characters first
    return [...idx.filter((i) => groups[i]!.isCharacter), ...idx.filter((i) => !groups[i]!.isCharacter)];
  }
  if (allocation === "protect-character") {
    return [...idx.filter((i) => !groups[i]!.isCharacter), ...idx.filter((i) => groups[i]!.isCharacter)];
  }
  return idx;
}

/**
 * Where an event goes from each reachable state, under one allocation order.
 *
 * An event lands on the current model of the first group in the order that still has a model
 * standing. Damage only ever moves a state forward, and it moves only that group, so the state
 * after `d` damage is the state `min(d, left)` single wounds further on, where `left` is what the
 * current model has left.
 */
export interface Moves {
  /** The group each state's next event goes to, or -1 when every group is dead. */
  target: Int32Array;
  /** Wounds left on the model that event lands on. */
  left: Int32Array;
  /** `next[c * width + d]` is the state `min(d, left[c])` wounds on from state `c`, for `d` below `width`. */
  next: Int32Array;
  /** The state `left[c]` wounds on from state `c`, where the model the event lands on has lost everything it had. */
  kill: Int32Array;
}

/**
 * The most single wounds `next` holds for one state. A table as wide as a model has wounds would grow
 * with the square of those wounds. An event dealing this much or more to a model with more left is
 * looked up in `index` instead.
 */
const NEXT_WIDTH = 32;

/**
 * The defender states a run can reach, numbered 0..size-1.
 *
 * The product encoding has a state for every combination of every group's damage, and most of
 * them can never happen: under one allocation order the groups before the current one are dead
 * and the groups after it are untouched. These are the states reachable from the start states
 * under the allocation orders the run uses, found by taking single wounds one at a time. Every
 * distribution the run holds lives on them.
 */
export interface Reach {
  space: StateSpace;
  /** The product-encoding index of each reachable state. */
  states: number[];
  /** The reachable state number of each product-encoding index that has one. */
  index: Map<number, number>;
  /** How many single wounds `next` holds per state: one more than the most wounds a model has, up to `NEXT_WIDTH`. */
  width: number;
  /** Per order, keyed by `orderKey`. */
  moves: Map<string, Moves>;
  /** Per state: wounds removed, models slain, points slain, and whether every group is dead. */
  damage: Float64Array;
  slain: Int32Array;
  points: Float64Array;
  dead: Uint8Array;
}

export function orderKey(order: number[]): string {
  return order.join(",");
}

/**
 * The states reachable from `starts` under any sequence of events allocated in any of `orders`,
 * or null when there are more than `cap` of them.
 */
export function reachable(space: StateSpace, orders: number[][], starts: number[], cap: number): Reach | null {
  engineWork.reachBuilds++;
  const { groups, sizes, strides } = space;
  const index = new Map<number, number>();
  const states: number[] = [];
  for (const s of starts) {
    if (index.has(s)) continue;
    index.set(s, states.length);
    states.push(s);
  }
  const step = orders.map(() => [] as number[]);
  const target = orders.map(() => [] as number[]);
  const left = orders.map(() => [] as number[]);
  for (let c = 0; c < states.length; c++) {
    if (states.length > cap) return null;
    const s = states[c]!;
    for (let o = 0; o < orders.length; o++) {
      let g = -1;
      let local = 0;
      for (const gi of orders[o]!) {
        const l = Math.floor(s / strides[gi]!) % sizes[gi]!;
        if (l < sizes[gi]! - 1) {
          g = gi;
          local = l;
          break;
        }
      }
      target[o]![c] = g;
      if (g < 0) {
        step[o]![c] = -1;
        left[o]![c] = 0;
        continue;
      }
      const W = groups[g]!.wounds;
      left[o]![c] = W - (local % W);
      const n = s + strides[g]!;
      let id = index.get(n);
      if (id === undefined) {
        id = states.length;
        index.set(n, id);
        states.push(n);
      }
      step[o]![c] = id;
    }
  }
  if (states.length > cap) return null;
  const size = states.length;
  const width = Math.min(groups.reduce((m, g) => Math.max(m, g.wounds), 0) + 1, NEXT_WIDTH);
  const moves = new Map<string, Moves>();
  for (let o = 0; o < orders.length; o++) {
    const next = new Int32Array(size * width);
    const kill = new Int32Array(size);
    const st = step[o]!;
    const tg = target[o]!;
    const lf = left[o]!;
    engineWork.moveCells += size * (width + 1);
    for (let c = 0; c < size; c++) {
      let k = c;
      const base = c * width;
      next[base] = c;
      for (let d = 1; d < width; d++) {
        if (d <= lf[c]!) k = st[k]!;
        next[base + d] = k;
      }
      const g = tg[c]!;
      kill[c] = g < 0 ? c : lf[c]! < width ? next[base + lf[c]!]! : index.get(states[c]! + lf[c]! * strides[g]!)!;
    }
    moves.set(orderKey(orders[o]!), { target: Int32Array.from(tg), left: Int32Array.from(lf), next, kill });
  }
  const damage = new Float64Array(size);
  const slain = new Int32Array(size);
  const points = new Float64Array(size);
  const dead = new Uint8Array(size);
  for (let c = 0; c < size; c++) {
    const locals = decode(space, states[c]!);
    let dmg = 0;
    let k = 0;
    let pts = 0;
    let allDead = 1;
    for (let g = 0; g < groups.length; g++) {
      const grp = groups[g]!;
      const l = locals[g]!;
      const sg = slainInGroup(grp, l);
      k += sg;
      dmg += damageInGroup(grp, l);
      pts += sg * (grp.pointsPerModel ?? 0);
      if (!isTerminal(grp, l)) allDead = 0;
    }
    damage[c] = dmg;
    slain[c] = k;
    points[c] = pts;
    dead[c] = allDead;
  }
  return { space, states, index, width, moves, damage, slain, points, dead };
}

/** Distribution over the reachable states plus linear accumulators (expected wasted damage, expected unsaved wounds). */
export interface StateDist {
  p: Float64Array;
  wasted: number;
  unsaved: number;
}

export function emptyDist(size: number): StateDist {
  return { p: new Float64Array(size), wasted: 0, unsaved: 0 };
}

/** `acc += w · d`, the accumulators included. */
export function addScaledDist(acc: StateDist, d: StateDist, w: number): void {
  const a = acc.p;
  const b = d.p;
  for (let i = 0; i < a.length; i++) {
    const v = b[i]!;
    if (v !== 0) a[i] = a[i]! + w * v;
  }
  acc.wasted += w * d.wasted;
  acc.unsaved += w * d.unsaved;
}

/** What one event is: which groups it can damage, by how much, and what it wastes on a dead unit. */
export interface EventKind {
  /** Per group, the chance the event inflicts damage (1 for mortal events). */
  pUnsaved: number[];
  /** Per group, damage per event that gets through. */
  damage: PMF[];
  /** Whether a damaging event counts towards the expected unsaved wounds. */
  countAsUnsaved: boolean;
  /** Expected damage wasted by one event on a unit with nothing left. */
  deadWaste: number;
}

export function eventKind(order: number[], pUnsaved: number[], damage: PMF[], countAsUnsaved: boolean): EventKind {
  const first = order[0] ?? 0;
  const dmg = damage[first];
  return { pUnsaved, damage, countAsUnsaved, deadWaste: dmg ? (pUnsaved[first] ?? 1) * mean(dmg) : 0 };
}

/**
 * Apply one event to the distribution.
 *
 * The event goes to the first group in the order that still has a model standing; if none, the
 * whole event is wasted. A state holding less than `floor` is dropped. The chains of
 * unweighted distributions drop what falls below EPS. The weighted sums pass 0 and keep everything.
 */
export function applyEvent(reach: Reach, moves: Moves, dist: StateDist, ev: EventKind, floor: number): StateDist {
  const size = reach.states.length;
  const width = reach.width;
  const out = new Float64Array(size);
  const src = dist.p;
  const { target, left, next, kill } = moves;
  const { states, index } = reach;
  const strides = reach.space.strides;
  let wasted = dist.wasted;
  let unsaved = dist.unsaved;
  engineWork.events++;
  engineWork.stateVisits += size;
  for (let c = 0; c < size; c++) {
    const ps = src[c]!;
    if (ps === 0 || ps < floor) continue;
    const g = target[c]!;
    if (g < 0) {
      // unit already destroyed: event fully wasted
      out[c] = out[c]! + ps;
      wasted += ps * ev.deadWaste;
      continue;
    }
    const pu = ev.pUnsaved[g] ?? 1;
    // saved
    if (pu < 1) out[c] = out[c]! + ps * (1 - pu);
    if (pu < EPS) continue;
    if (ev.countAsUnsaved) unsaved += ps * pu;
    const dmg = ev.damage[g] ?? [1];
    const w = left[c]!;
    const base = c * width;
    for (let d = 0; d < dmg.length; d++) {
      const pd = dmg[d]!;
      if (pd < EPS) continue;
      const weight = ps * pu * pd;
      let to: number;
      if (d >= w) {
        wasted += weight * (d - w);
        to = kill[c]!;
      } else if (d < width) to = next[base + d]!;
      // Fewer wounds than the model has left only move its group's count on.
      else to = index.get(states[c]! + d * strides[g]!)!;
      out[to] = out[to]! + weight;
    }
  }
  return { p: out, wasted, unsaved };
}

export interface FinalStats {
  slainPMF: PMF;
  damagePMF: PMF;
  pKill: number;
  expectedPointsSlain: number;
}

export function summarize(reach: Reach, dist: StateDist): FinalStats {
  const groups = reach.space.groups;
  const totalModels = groups.reduce((s, g) => s + g.models, 0);
  const totalWounds = groups.reduce((s, g) => s + g.models * g.wounds, 0);
  const slain = new Array<number>(totalModels + 1).fill(0);
  const dmg = new Array<number>(totalWounds + 1).fill(0);
  let pKill = 0;
  let pts = 0;
  for (let c = 0; c < dist.p.length; c++) {
    const ps = dist.p[c]!;
    if (ps < EPS) continue;
    const k = reach.slain[c]!;
    const d = reach.damage[c]!;
    slain[k] = slain[k]! + ps;
    dmg[d] = dmg[d]! + ps;
    pts += ps * reach.points[c]!;
    if (reach.dead[c]) pKill += ps;
  }
  return { slainPMF: slain, damagePMF: dmg, pKill, expectedPointsSlain: pts };
}

/** Wounds the distribution has removed, in expectation. */
export function expectedDamage(reach: Reach, dist: StateDist): number {
  let e = 0;
  for (let c = 0; c < dist.p.length; c++) {
    const ps = dist.p[c]!;
    if (ps <= 0) continue;
    e += ps * reach.damage[c]!;
  }
  return e;
}

/** Save results grouped by which groups they inflict damage on, lowest results first. */
export interface SaveClasses {
  /** Per class, 1 for each group the result damages and 0 for each group it is saved against. */
  fails: number[][];
  /** Probability that one save result falls in each class. The rest of the mass saves against every group. */
  probs: number[];
}

/**
 * The classes a profile's save results fall into, or null when one class covers every damaging
 * result, in which case allocating one wound at a time gives the same answer and costs less.
 *
 * Consecutive faces that damage the same groups are one class. A 1 fails against everyone and each
 * group's saving results are the faces from its threshold up, so the classes come out in ascending
 * order of the faces they hold, which is the order the results are resolved in.
 */
export function saveClasses(w: WeaponParams): SaveClasses | null {
  const faces = w.saveFaces;
  if (!faces || w.groups.some((g) => !g.damageOn)) return null;
  const fails: number[][] = [];
  const probs: number[] = [];
  for (let f = 0; f < faces.length; f++) {
    const p = faces[f] ?? 0;
    if (p < EPS) continue;
    const vec = w.groups.map((g: GroupParams) => (g.damageOn![f] ? 1 : 0));
    if (!vec.some((v) => v === 1)) continue;
    const last = fails.length - 1;
    if (last >= 0 && fails[last]!.every((v, i) => v === vec[i])) probs[last]! += p;
    else {
      fails.push(vec);
      probs.push(p);
    }
  }
  return fails.length < 2 ? null : { fails, probs };
}
