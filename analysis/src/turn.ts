import { convolve, delta, type PMF } from "@grimstat/engine";
import type { ScenarioContext, ScenarioUnit, SimResult, Snapshot } from "./schema";
import { phaseFor } from "./analyses";
import type { AnalysisCore, AnalysisHost, TurnOption } from "./host";

export type { TurnOption };

/** Engine runs the local search may spend when the input names no allowance. */
export const LOCAL_SEARCH_RUNS = 800;

/**
 * The whole-turn optimiser: which attacker fires at which target, under a command-point budget and
 * one stratagem per unit per phase.
 *
 * The options a turn may spend points on are the game system's, and they arrive on `TurnPlanInput`.
 * Assigning attackers to targets and chaining the runs is not.
 */

/**
 * Joint turn optimiser: assign every attacking unit (all its weapons) to one target and optionally one
 * stratagem-like option, under a CP budget, maximising expected points slain / models slain / damage.
 * Targets are evaluated sequentially with chained defender states, so overkill and target death are
 * accounted for exactly (exact backend) rather than as independent pairwise matchups.
 */

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
  /** The edition to score under. Taken from the snapshot when one is given. See `editionOf`. */
  gameSystemId?: string;
  enabledToggles?: string[];
  /** Engine runs the local search may spend. Defaults to `LOCAL_SEARCH_RUNS`. */
  searchRuns?: number;
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

export function createTurnOptimiser(host: AnalysisHost<object>, core: AnalysisCore) {
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
    /**
     * Every starting state is the finalState of a run this evaluator made and cached, so a state
     * reached again is the same array, and the array itself identifies the state.
     */
    private readonly stateIds = new Map<number[], number>();
    private readonly edition: string;
    constructor(private readonly input: TurnPlanInput) {
      this.edition = core.editionOf(input);
    }

    private key(attackerId: string, targetId: string, optionId: string | undefined, initial: number[] | undefined): string {
      let state = "-";
      if (initial) {
        let id = this.stateIds.get(initial);
        if (id === undefined) this.stateIds.set(initial, (id = this.stateIds.size));
        state = String(id);
      }
      return `${attackerId}|${targetId}|${optionId ?? ""}|${state}`;
    }

    run(att: TurnAttacker, tgt: TurnTarget, option: TurnOption | undefined, initial: number[] | undefined): SimResult {
      const k = this.key(att.id, tgt.id, option?.id, initial);
      const hit = this.cache.get(k);
      if (hit) return hit;
      this.evaluations++;
      const toggles = [...(this.input.enabledToggles ?? []), ...(option?.enabledToggles ?? [])];
      // Resolve the attacker in the phase it can actually fight in, the way every other analysis
      // does. Without this a melee-only attacker in a shooting-phase plan scored a flat zero.
      const scenario = core.makeScenario(att.unit, tgt.unit, { ...phaseFor(att.unit, this.input.context ?? {}), backend: "exact" }, toggles, this.edition);
      let r: SimResult;
      try {
        r = host.runScenario(scenario, { snapshot: this.input.snapshot, ...(initial ? { initialState: initial } : {}) });
        // The exact backend solves some targets whose full state space is too large to hand back as
        // a finalState. The next attacker on the target then starts from a fresh unit.
        if (!r.finalState) r.warnings.push(`${att.unit.name} vs ${tgt.unit.name}: too many states to carry into the next attack, so later attacks on this target start from a fresh unit.`);
      } catch {
        // exact path refused (state space too large): fall back to MC without chaining
        r = host.runScenario(core.makeScenario(att.unit, tgt.unit, { ...phaseFor(att.unit, this.input.context ?? {}), backend: "mc" }, toggles, this.edition), { snapshot: this.input.snapshot });
        r.warnings.push(`${att.unit.name} vs ${tgt.unit.name}: exact chaining unavailable; used Monte Carlo (not chained).`);
      }
      this.cache.set(k, r);
      return r;
    }

    options(att: TurnAttacker): readonly TurnOption[] {
      return att.options?.length ? att.options : host.defaultTurnOptions;
    }

    /** The attacker a plan step names, or nothing when the input no longer carries it. */
    attacker(id: string): TurnAttacker | undefined {
      return this.input.attackers.find((x) => x.id === id);
    }

    evaluate(plan: Plan): Eval {
      const input = this.input;
      const objective = input.objective ?? "points";
      const warnings = new Set<string>();
      const byTarget = new Map<string, Plan>();
      const targetIds = new Set(input.targets.map((t) => t.id));
      // A step naming a unit the input no longer holds is reported and left out. Reading the attacker
      // back with a non-null assertion threw inside the worker instead, and a step naming a target
      // that has gone was dropped in silence while its CP still counted against the budget.
      for (const a of plan) {
        const att = this.attacker(a.attackerId);
        if (!att) warnings.add(`The plan assigns "${a.attackerId}", which is not one of the attackers.`);
        else if (!targetIds.has(a.targetId)) warnings.add(`${att.unit.name} is assigned to "${a.targetId}", which is not one of the targets.`);
        else byTarget.set(a.targetId, [...(byTarget.get(a.targetId) ?? []), a]);
      }
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
          const att = this.attacker(a.attackerId);
          if (!att) continue;
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

  /** The option each step of a plan takes, for the steps `evaluate` resolves. */
  function takenOptions(plan: Plan, ev: Evaluator, input: TurnPlanInput): TurnOption[] {
    const targetIds = new Set(input.targets.map((t) => t.id));
    const out: TurnOption[] = [];
    for (const a of plan) {
      const att = ev.attacker(a.attackerId);
      // Count exactly the steps `evaluate` resolves, so the budget checked here and the CP reported
      // there are the same number.
      if (!att || !targetIds.has(a.targetId)) continue;
      const option = ev.options(att).find((o) => o.id === a.optionId);
      if (option) out.push(option);
    }
    return out;
  }

  function withinBudget(plan: Plan, ev: Evaluator, input: TurnPlanInput): boolean {
    if (input.cpBudget === undefined) return true;
    return takenOptions(plan, ev, input).reduce((cp, o) => cp + o.cp, 0) <= input.cpBudget;
  }

  /** The stratagems a plan gives to more than one attacker, by the label of the first option that uses each. */
  function usedTwice(plan: Plan, ev: Evaluator, input: TurnPlanInput): string[] {
    const seen = new Set<string>();
    const twice = new Map<string, string>();
    for (const o of takenOptions(plan, ev, input)) {
      if (!o.stratagemId) continue;
      if (seen.has(o.stratagemId) && !twice.has(o.stratagemId)) twice.set(o.stratagemId, o.label);
      seen.add(o.stratagemId);
    }
    return [...twice.values()];
  }

  /** Whether the search may take a plan: within the budget, and no stratagem used twice. */
  const allowed = (plan: Plan, ev: Evaluator, input: TurnPlanInput): boolean => withinBudget(plan, ev, input) && usedTwice(plan, ev, input).length === 0;

  function evaluateTurnPlan(input: TurnPlanInput, plan: Plan): TurnPlanResult {
    const ev = new Evaluator(input);
    const r = ev.evaluate(plan).result;
    r.evaluations = ev.evaluations;
    if (!withinBudget(plan, ev, input)) r.warnings.push(`Plan spends ${r.cpSpent} CP; budget is ${input.cpBudget}.`);
    for (const label of usedTwice(plan, ev, input)) r.warnings.push(`${label} is used by more than one unit in this phase.`);
    return r;
  }

  /**
   * Greedy construction (best marginal gain per attacker, attackers ordered by points) followed by
   * local search: single reassignments (target and/or option) and pairwise target swaps, until no
   * improvement. Exact for the evaluation of any given plan; heuristic in the search.
   */
  /**
   * Engine runs the local search may spend beyond what the greedy pass cost.
   *
   * One run is a few milliseconds, so this is a search of about three seconds on top of the greedy
   * plan. A turn of six attackers against three targets finishes well inside it; one of twenty
   * against fourteen does not, and used to take twenty seconds.
   */
  function optimiseTurn(input: TurnPlanInput): TurnPlanResult {
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
          if (!allowed(cand, ev, input)) continue;
          const e = ev.evaluate(cand);
          if (!bestChoice || e.score > bestChoice.ev.score + 1e-12) bestChoice = { plan: cand, ev: e };
        }
      }
      // Every option this attacker carries costs more CP than is left. It fires with no stratagem
      // rather than leaving the plan. A unit that cannot afford a stratagem still shoots.
      if (!bestChoice) {
        for (const tgt of input.targets) {
          const cand: Plan = [...plan, { attackerId: att.id, targetId: tgt.id }];
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
    //
    // Every candidate that moves one step invalidates the chained state of every later step against
    // the same target, so each one is a fresh run of the engine. The number of candidates a round
    // holds is the square of the plan's length, which for a full army is twenty units a side: twenty
    // rounds of that took twenty seconds. The search stops once it has spent its allowance of engine
    // runs and reports the best plan it had reached, which is what a heuristic is for.
    const spentByGreedy = ev.evaluations;
    const allowance = input.searchRuns ?? LOCAL_SEARCH_RUNS;
    const outOfBudget = (): boolean => ev.evaluations - spentByGreedy > allowance;
    let improved = true;
    let rounds = 0;
    while (improved && rounds < 20 && !outOfBudget()) {
      improved = false;
      rounds++;
      for (let i = 0; i < plan.length && !outOfBudget(); i++) {
        const att = ev.attacker(plan[i]!.attackerId);
        if (!att) continue;
        for (const tgt of input.targets) {
          for (const opt of ev.options(att)) {
            if (tgt.id === plan[i]!.targetId && opt.id === plan[i]!.optionId) continue;
            const cand = plan.map((a, k) => (k === i ? { attackerId: a.attackerId, targetId: tgt.id, optionId: opt.id } : a));
            if (!allowed(cand, ev, input)) continue;
            const e = ev.evaluate(cand);
            if (e.score > best.score + 1e-9) {
              plan = cand;
              best = e;
              improved = true;
            }
          }
        }
      }
      for (let i = 0; i < plan.length && !outOfBudget(); i++) {
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
      for (let i = 0; i < plan.length && !outOfBudget(); i++) {
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
    if (outOfBudget()) result.warnings.push("The search stopped at its allowance of engine runs. This is the best plan it reached, and a smaller turn would be searched to the end.");
    // Name the attackers that ended up firing with nothing. This reads the finished plan rather than
    // the greedy pass, so it cannot outlive a stratagem the local search managed to afford after all.
    for (const a of result.assignments) {
      if (a.optionId !== undefined) continue;
      const att = ev.attacker(a.attackerId);
      if (!att || ev.options(att).some((o) => o.cp === 0)) continue;
      result.warnings.push(`${att.unit.name} fires with no stratagem. Every option it carries costs more CP than the budget leaves.`);
    }
    return result;
  }

  return { optimiseTurn, evaluateTurnPlan };
}
