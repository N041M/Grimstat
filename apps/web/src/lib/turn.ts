/** Turn optimiser types and entry points, plus the small UI-side vocabulary around them. */
export { optimiseTurn, evaluateTurnPlan, DEFAULT_TURN_OPTIONS } from "@grimstat/game-40k-11e";
export type { TurnOption, TurnAttacker, TurnTarget, TurnPlanInput, TurnAssignment, TurnTargetOutcome, TurnPlanResult } from "@grimstat/game-40k-11e";

/** One row of a manually specified plan (the argument shape of `evaluateTurnPlan`). */
export interface TurnPlanStep {
  attackerId: string;
  targetId: string;
  optionId?: string;
}

export type TurnObjective = "points" | "kills" | "damage";
export const TURN_OBJECTIVES: TurnObjective[] = ["points", "kills", "damage"];

/** Sentinel option id meaning "let the optimiser choose among DEFAULT_TURN_OPTIONS". */
export const OPTION_AUTO = "auto";
