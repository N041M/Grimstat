import type { PMF } from "./pmf";
import { EPS } from "./pmf";
import type { AllocationOrder, TargetGroup } from "./types";

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

export function makeStateSpace(groups: TargetGroup[]): StateSpace {
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

/** Distribution over states plus linear accumulators (expected wasted damage, expected unsaved wounds). */
export interface StateDist {
  p: Float64Array;
  wasted: number;
  unsaved: number;
}

export function initialDist(space: StateSpace): StateDist {
  const p = new Float64Array(space.total);
  p[0] = 1;
  return { p, wasted: 0, unsaved: 0 };
}

export function cloneDist(d: StateDist): StateDist {
  return { p: new Float64Array(d.p), wasted: d.wasted, unsaved: d.unsaved };
}

export function mixDists(parts: Array<{ w: number; d: StateDist }>, space: StateSpace): StateDist {
  const p = new Float64Array(space.total);
  let wasted = 0;
  let unsaved = 0;
  for (const { w, d } of parts) {
    if (w < EPS) continue;
    for (let i = 0; i < p.length; i++) p[i] = (p[i] ?? 0) + w * (d.p[i] ?? 0);
    wasted += w * d.wasted;
    unsaved += w * d.unsaved;
  }
  return { p, wasted, unsaved };
}

/**
 * Apply one event (a wound needing a save, or a mortal-damage event) to the distribution.
 * The event goes to the first non-terminal group in `order`; if none, the whole event is wasted.
 * `pUnsaved[g]` = P(the save fails) (1 for mortal events); `damage[g]` = damage PMF per unsaved event.
 */
export function applyEvent(
  space: StateSpace,
  dist: StateDist,
  order: number[],
  pUnsaved: number[],
  damage: PMF[],
  countAsUnsaved: boolean,
): StateDist {
  const out = new Float64Array(space.total);
  let wasted = dist.wasted;
  let unsaved = dist.unsaved;
  const G = space.groups.length;
  for (let s = 0; s < space.total; s++) {
    const ps = dist.p[s] ?? 0;
    if (ps < EPS) continue;
    // find target group
    let target = -1;
    let local = 0;
    for (const g of order) {
      const size = space.sizes[g] ?? 1;
      const l = Math.floor(s / (space.strides[g] ?? 1)) % size;
      if (l < size - 1) {
        target = g;
        local = l;
        break;
      }
    }
    if (target < 0) {
      // unit already destroyed: event fully wasted
      out[s] = (out[s] ?? 0) + ps;
      const dmg = damage[order[0] ?? 0];
      if (dmg) {
        let m = 0;
        for (let k = 0; k < dmg.length; k++) m += k * (dmg[k] ?? 0);
        wasted += ps * (pUnsaved[order[0] ?? 0] ?? 1) * m;
      }
      continue;
    }
    const g = space.groups[target]!;
    const pu = pUnsaved[target] ?? 1;
    const stride = space.strides[target] ?? 1;
    const base = s - local * stride;
    // saved
    if (pu < 1) out[s] = (out[s] ?? 0) + ps * (1 - pu);
    if (pu < EPS) continue;
    if (countAsUnsaved) unsaved += ps * pu;
    const dmg = damage[target] ?? [1];
    const i = Math.floor(local / g.wounds);
    const w = g.wounds - (local % g.wounds);
    const terminalLocal = g.models * g.wounds;
    for (let d = 0; d < dmg.length; d++) {
      const pd = dmg[d] ?? 0;
      if (pd < EPS) continue;
      const weight = ps * pu * pd;
      let nl: number;
      if (d >= w) {
        wasted += weight * (d - w);
        nl = i + 1 >= g.models ? terminalLocal : (i + 1) * g.wounds;
      } else {
        nl = local + d;
      }
      out[base + nl * stride] = (out[base + nl * stride] ?? 0) + weight;
    }
    void G;
  }
  return { p: out, wasted, unsaved };
}

export interface FinalStats {
  slainPMF: PMF;
  damagePMF: PMF;
  pKill: number;
  expectedPointsSlain: number;
}

export function summarize(space: StateSpace, dist: StateDist): FinalStats {
  const totalModels = space.groups.reduce((s, g) => s + g.models, 0);
  const totalWounds = space.groups.reduce((s, g) => s + g.models * g.wounds, 0);
  const slain = new Array<number>(totalModels + 1).fill(0);
  const dmg = new Array<number>(totalWounds + 1).fill(0);
  let pKill = 0;
  let pts = 0;
  for (let s = 0; s < space.total; s++) {
    const ps = dist.p[s] ?? 0;
    if (ps < EPS) continue;
    const locals = decode(space, s);
    let k = 0;
    let d = 0;
    let allDead = true;
    for (let g = 0; g < locals.length; g++) {
      const grp = space.groups[g]!;
      const l = locals[g]!;
      const sg = slainInGroup(grp, l);
      k += sg;
      d += damageInGroup(grp, l);
      pts += ps * sg * (grp.pointsPerModel ?? 0);
      if (!isTerminal(grp, l)) allDead = false;
    }
    slain[k] = (slain[k] ?? 0) + ps;
    dmg[d] = (dmg[d] ?? 0) + ps;
    if (allDead) pKill += ps;
  }
  return { slainPMF: slain, damagePMF: dmg, pKill, expectedPointsSlain: pts };
}
