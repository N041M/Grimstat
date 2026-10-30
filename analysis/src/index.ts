import { createAnalyses as createCore } from "./analyses";
import { createExchange } from "./exchange";
import { createReverse } from "./reverse";
import { createSensitivity } from "./sensitivity";
import { createTurnOptimiser } from "./turn";
import type { AnalysisHost, ReferenceAttack } from "./host";

export type { AnalysisCore, AnalysisHost, EditionOpts, ReferenceAttack, RunSampling, SensitivityVariantDef, TurnOption } from "./host";
export { combineSampling, phaseFor } from "./analyses";
export type { DurabilityEntry, DurabilityIndexRow, EfficiencyRow, IncomingEntry, IncomingFireRow, MatrixCell, MatrixResult, RemovalChain, WeightedTarget } from "./analyses";
export type { SensitivityOpts, SensitivityResult, SensitivityVariant } from "./sensitivity";
export type { ReverseCandidate, ReverseInput, ReverseResult, ReverseRow } from "./reverse";
export type { ExchangeInput, ExchangeResult, ExchangeSide } from "./exchange";
export { withCasualties, TAIL_WARNING } from "./exchange";
export type { TurnAssignment, TurnAttacker, TurnPlanInput, TurnPlanResult, TurnTarget, TurnTargetOutcome } from "./turn";
export { LOCAL_SEARCH_RUNS } from "./turn";

/**
 * Every army-level analysis, bound to one game system.
 *
 * A game system calls this once with its own `runScenario`, its preset units and the what-if
 * variants it offers, and re-exports what comes back. A second system does the same and gets the
 * matrix, the durability profile and index, the efficiency ranking, incoming fire, the turn
 * optimiser, the reverse search, the exchange and the what-if analysis without any of them being
 * written again.
 */
export function createAnalyses<Ref extends object = ReferenceAttack>(host: AnalysisHost<Ref>) {
  const core = createCore(host);
  return { ...core, ...createSensitivity(host), ...createReverse(host, core), ...createExchange(host, core), ...createTurnOptimiser(host, core) };
}
