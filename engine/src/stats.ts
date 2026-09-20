import { type PMF, survival } from "./pmf";

export function survivalFromPMF(p: PMF): number[] {
  return survival(p);
}
