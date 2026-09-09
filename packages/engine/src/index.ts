export * from "./pmf";
export * from "./dice";
export * from "./rng";
export * from "./bivariate";
export * from "./types";
export { runExact } from "./exact";
export { runMonteCarlo } from "./mc";
export { makeStateSpace, groupOrder } from "./allocation";

import { runExact } from "./exact";
import { runMonteCarlo } from "./mc";
import type { EngineInput, EngineOutput } from "./types";

/** Run a scenario: exact when feasible (or forced), otherwise Monte Carlo. */
export function run(input: EngineInput): EngineOutput {
  if (input.backend === "mc") return runMonteCarlo(input);
  const exact = runExact(input);
  if (exact) return exact;
  if (input.backend === "exact") throw new Error("Exact backend refused: state space too large");
  const mc = runMonteCarlo(input);
  mc.warnings.push("Exact computation infeasible for this target; used Monte Carlo.");
  return mc;
}
