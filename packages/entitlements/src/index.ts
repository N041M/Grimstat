/**
 * Feature gating seam. The local provider unlocks everything; a future server-backed provider
 * can gate paid *services* (sync, hosted compute) — never data access or the core calculator.
 */
export type FeatureKey = "sync" | "cloud-storage" | "hosted-optimiser" | "team-tools" | (string & {});

export interface EntitlementsProvider {
  can(feature: FeatureKey): boolean;
  /** Human-readable plan name for the UI. */
  plan(): string;
}

export const LocalAllUnlocked: EntitlementsProvider = {
  can: () => true,
  plan: () => "local",
};

let current: EntitlementsProvider = LocalAllUnlocked;

export function setEntitlementsProvider(p: EntitlementsProvider): void {
  current = p;
}

export function can(feature: FeatureKey): boolean {
  return current.can(feature);
}

export function currentPlan(): string {
  return current.plan();
}
