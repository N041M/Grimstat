/**
 * Reverse mathhammer, sensitivity ("what if") and channel labels — re-exported from the game plugin so the
 * worker and UI have one import path. (A local shim lived here until the package exported these.)
 */
export { reverseMathhammer, sensitivity, SENSITIVITY_VARIANTS, CHANNEL_INFO } from "@grimstat/game-40k-11e";
export type { ReverseCandidate, ReverseInput, ReverseRow, ReverseResult, SensitivityVariant, SensitivityResult, SensitivityVariantDef } from "@grimstat/game-40k-11e";
