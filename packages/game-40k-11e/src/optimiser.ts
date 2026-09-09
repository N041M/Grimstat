import { convolve, delta, type PMF } from "@grimstat/engine";
import type { ScenarioContext, ScenarioUnit, SimResult, Snapshot } from "@grimstat/schema";
import { makeScenario } from "./analysis";
import { runScenario } from "./scenario";

/**
 * Joint turn optimiser: assign every attacking unit (all its weapons) to one target and optionally one
 * stratagem-like option, under a CP budget, maximising expected points slain / models slain / damage.
 * Targets are evaluated sequentially with chained defender states, so overkill and target death are
 * accounted for exactly (exact backend) rather than as independent pairwise matchups.
 */
export interface TurnOption {
  id: string;
  label: string;
  cp: number;
  enabledToggles: string[];
}

export interface TurnAttacker {
  id: string;
  unit: ScenarioUnit;
  /** Candidate options for this attacker (defaults to DEFAULT_TURN_OPTIONS). */
  options?: TurnOption[];
}

export interface TurnTarget {
  id: string;
  unit: ScenarioUnit;
  /** Priority multiplier on the objective value of this target (default 1). */
  weight?: number;
}

export interface TurnPlanInput {
  attackers: TurnAttacker[];
  targets: TurnTarget[];
  context?: Partial<ScenarioContext>;
  cpBudget?: number;
  objective?: "points" | "kills" | "damage";
  snapshot?: Snapshot;
  enabledToggles?: string[];
}

export interface TurnAssignment {
  attackerId: string;
  targetId: string;
  optionId?: string;
  expectedDamage: number;
  expectedSlain: number;
  /** P(target destroyed) after this attacker has fired, given the attackers before it. */
  pKillAfter: number;
  order: number;
}

export interface TurnTargetOutcome {
  targetId: string;
  expectedDamage: number;
  expectedSlain: number;
  pKill: number;
  expectedPointsSlain: number;
  expectedWasted: number;
  slainPMF: number[];
}

export interface TurnPlanResult {
  assignments: TurnAssignment[];
  targets: TurnTargetOutcome[];
  totalExpectedPoints: number;
  totalExpectedSlain: number;
  totalExpectedDamage: number;
  totalExpectedWasted: number;
  cpSpent: number;
  cpBudget?: number;
  objective: "points" | "kills" | "damage";
  score: number;
  evaluations: number;
  slainPMF: number[];
  warnings: string[];
}

export const DEFAULT_TURN_OPTIONS: TurnOption[] = [
  { id: "none", label: "No stratagem", cp: 0, enabledToggles: [] },
  { id: "cmd-reroll-hit", label: "Command Re-roll (one hit roll)", cp: 1, enabledToggles: ["cmd-reroll-hit"] },
  { id: "cmd-reroll-wound", label: "Command Re-roll (one wound roll)", cp: 1, enabledToggles: ["cmd-reroll-wound"] },
  { id: "plus1-wound", label: "+1 to wound", cp: 1, enabledToggles: ["plus1-wound"] },
  { id: "plus1-ap", label: "Improve AP by 1", cp: 1, enabledToggles: ["plus1-ap"] },
  { id: "lethal-all", label: "Grant Lethal Hits", cp: 1, enabledToggles: ["lethal-all"] },
  { id: "sustained-all", label: "Grant Sustained Hits 1", cp: 1, enabledToggles: ["sustained-all"] },
];

type Plan = Array<{ attackerId: string; targetId: string; optionId?: string }>;

interface Eval {
  score: number;
  result: TurnPlanResult;
}

function objectiveValue(objective: TurnPlanInput["objective"], r: { expectedPointsSlain: number; expectedSlain: number; expectedDamage: number }, weight: number): number {
  const v = objective === "kills" ? r.expectedSlain : objective === "damage" ? r.expectedDamage : r.expectedPointsSlain;
  return v * weight;
}

class Evaluator {
  evaluations = 0;
  private readonly cache = new Map<string, SimResult>();
  constructor(private readonly input: TurnPlanInput) {}

  private key(attackerId: string, targetId: string, optionId: string | undefined, initial: number[] | undefined): string {
    // states are floats; hash a compact representation
    let h = 0;
    if (initial) for (let i = 0; i < initial.length; i++) h = (Math.imul(h, 31) + Math.round((initial[i] ?? 0) * 1e6)) | 0;
    return `${attackerId}|${targetId}|${optionId ?? ""}|${initial ? initial.length + ":" + h : "-"}`;
  }

  run(att: TurnAttacker, tgt: TurnTarget, option: TurnOption | undefined, initial: number[] | undefined): SimResult {
    const k = this.key(att.id, tgt.id, option?.id, initial);
    const hit = this.cache.get(k);
    if (hit) return hit;
    this.evaluations++;
    const toggles = [...(this.input.enabledToggles ?? []), ...(option?.enabledToggles ?? [])];
    const scenario = makeScenario(att.unit, tgt.unit, { ...(this.input.context ?? {}), backend: "exact" }, toggles);
    let r: SimResult;
    try {
      r = runScenario(scenario, { snapshot: this.input.snapshot, ...(initial ? { initialState: initial } : {}) });
    } catch {
      // exact path refused (state space too large): fall back to MC without chaining
      r = runScenario(makeScenario(att.unit, tgt.unit, { ...(this.input.context ?? {}), backend: "mc" }, toggles), { snapshot: this.input.snapshot });
      r.warnings.push(`${att.unit.name} vs ${tgt.unit.name}: exact chaining unavailable; used Monte Carlo (not chained).`);
    }
    this.cache.set(k, r);
    return r;
  }

  options(att: TurnAttacker): TurnOption[] {
    return att.options?.length ? att.options : DEFAULT_TURN_OPTIONS;
  }

  evaluate(plan: Plan): Eval {
    const input = this.input;
    const objective = input.objective ?? "points";
    const warnings = new Set<string>();
    const byTarget = new Map<string, Plan>();
    for (const a of plan) byTarget.set(a.targetId, [...(byTarget.get(a.targetId) ?? []), a]);
    const assignments: TurnAssignment[] = [];
    const targets: TurnTargetOutcome[] = [];
    let score = 0;
    let cp = 0;
    let totalPoints = 0;
    let totalSlain = 0;
    let totalDamage = 0;
    let totalWasted = 0;
    let slainPMF: PMF = delta(0);
    let order = 0;
    for (const tgt of input.targets) {
      const list = byTarget.get(tgt.id) ?? [];
      let state: number[] | undefined;
      let last: SimResult | null = null;
      const agg = { expectedDamage: 0, expectedSlain: 0, expectedPointsSlain: 0, expectedWasted: 0 };
      for (const a of list) {
        const att = input.attackers.find((x) => x.id === a.attackerId)!;
        const option = this.options(att).find((o) => o.id === a.optionId);
        const r = this.run(att, tgt, option, state);
        for (const w of r.warnings) warnings.add(w);
        cp += option?.cp ?? 0;
        agg.expectedDamage += r.expectedDamage;
        agg.expectedSlain += r.expectedSlain;
        agg.expectedPointsSlain += r.pointsSlain ?? 0;
        agg.expectedWasted += r.expectedWasted;
        assignments.push({ attackerId: att.id, targetId: tgt.id, ...(option && option.id !== "none" ? { optionId: option.id } : {}), expectedDamage: r.expectedDamage, expectedSlain: r.expectedSlain, pKillAfter: r.pKill, order: order++ });
        state = r.finalState;
        last = r;
        if (!r.finalState) state = undefined;
      }
      const outcome: TurnTargetOutcome = { targetId: tgt.id, ...agg, pKill: last?.pKill ?? 0, slainPMF: last?.slainPMF ?? [1] };
      targets.push(outcome);
      score += objectiveValue(objective, outcome, tgt.weight ?? 1);
      totalPoints += outcome.expectedPointsSlain;
      totalSlain += outcome.expectedSlain;
      totalDamage += outcome.expectedDamage;
      totalWasted += outcome.expectedWasted;
      slainPMF = convolve(slainPMF, outcome.slainPMF);
    }
    const result: TurnPlanResult = {
      assignments,
      targets,
      totalExpectedPoints: totalPoints,
      totalExpectedSlain: totalSlain,
      totalExpectedDamage: totalDamage,
      totalExpectedWasted: totalWasted,
      cpSpent: cp,
      ...(input.cpBudget !== undefined ? { cpBudget: input.cpBudget } : {}),
      objective,
      score,
      evaluations: this.evaluations,
      slainPMF,
      warnings: [...warnings],
    };
    return { score, result };
  }
}

function withinBudget(plan: Plan, ev: Evaluator, input: TurnPlanInput): boolean {
  if (input.cpBudget === undefined) return true;
  let cp = 0;
  for (const a of plan) {
    const att = input.attackers.find((x) => x.id === a.attackerId)!;
    cp += ev.options(att).find((o) => o.id === a.optionId)?.cp ?? 0;
  }
  return cp <= input.cpBudget;
}

export function evaluateTurnPlan(input: TurnPlanInput, plan: Plan): TurnPlanResult {
  const ev = new Evaluator(input);
  const r = ev.evaluate(plan).result;
  r.evaluations = ev.evaluations;
  if (!withinBudget(plan, ev, input)) r.warnings.push(`Plan spends ${r.cpSpent} CP; budget is ${input.cpBudget}.`);
  return r;
}

/**
 * Greedy construction (best marginal gain per attacker, attackers ordered by points) followed by
 * local search: single reassignments (target and/or option) and pairwise target swaps, until no
 * improvement. Exact for the evaluation of any given plan; heuristic in the search.
 */
export function optimiseTurn(input: TurnPlanInput): TurnPlanResult {
  const ev = new Evaluator(input);
  if (!input.attackers.length || !input.targets.length) {
    return { ...ev.evaluate([]).result, warnings: ["Nothing to optimise: add at least one attacker and one target."] };
  }
  const attackers = [...input.attackers].sort((a, b) => (b.unit.points ?? 0) - (a.unit.points ?? 0));
  let plan: Plan = [];
  let best = ev.evaluate(plan);
  // greedy
  for (const att of attackers) {
    let bestChoice: { plan: Plan; ev: Eval } | null = null;
    for (const tgt of input.targets) {
      for (const opt of ev.options(att)) {
        const cand: Plan = [...plan, { attackerId: att.id, targetId: tgt.id, optionId: opt.id }];
        if (!withinBudget(cand, ev, input)) continue;
        const e = ev.evaluate(cand);
        if (!bestChoice || e.score > bestChoice.ev.score + 1e-12) bestChoice = { plan: cand, ev: e };
      }
    }
    if (bestChoice) {
      plan = bestChoice.plan;
      best = bestChoice.ev;
    }
  }
  // local search
  let improved = true;
  let rounds = 0;
  while (improved && rounds < 20) {
    improved = false;
    rounds++;
    for (let i = 0; i < plan.length; i++) {
      const att = input.attackers.find((x) => x.id === plan[i]!.attackerId)!;
      for (const tgt of input.targets) {
        for (const opt of ev.options(att)) {
          if (tgt.id === plan[i]!.targetId && opt.id === plan[i]!.optionId) continue;
          const cand = plan.map((a, k) => (k === i ? { attackerId: a.attackerId, targetId: tgt.id, optionId: opt.id } : a));
          if (!withinBudget(cand, ev, input)) continue;
          const e = ev.evaluate(cand);
          if (e.score > best.score + 1e-9) {
            plan = cand;
            best = e;
            improved = true;
          }
        }
      }
    }
    for (let i = 0; i < plan.length; i++) {
      for (let j = i + 1; j < plan.length; j++) {
        if (plan[i]!.targetId === plan[j]!.targetId) continue;
        const cand = plan.map((a, k) => (k === i ? { ...a, targetId: plan[j]!.targetId } : k === j ? { ...a, targetId: plan[i]!.targetId } : a));
        const e = ev.evaluate(cand);
        if (e.score > best.score + 1e-9) {
          plan = cand;
          best = e;
          improved = true;
        }
      }
    }
    // order within a target: try moving each attacker earlier/later against the same target (affects overkill)
    for (let i = 0; i < plan.length; i++) {
      for (let j = 0; j < plan.length; j++) {
        if (i === j || plan[i]!.targetId !== plan[j]!.targetId) continue;
        const cand = plan.slice();
        const [moved] = cand.splice(i, 1);
        cand.splice(j, 0, moved!);
        const e = ev.evaluate(cand);
        if (e.score > best.score + 1e-9) {
          plan = cand;
          best = e;
          improved = true;
        }
      }
    }
  }
  const result = best.result;
  result.evaluations = ev.evaluations;
  return result;
}
