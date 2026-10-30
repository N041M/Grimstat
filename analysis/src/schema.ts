/**
 * The types the analyses read, written out for this repository.
 *
 * In the application these are inferred from runtime schemas in a package that is not published.
 * The fields here match those types, with two exceptions that the analyses hand on to the game
 * system. A snapshot holds the imported game data, and only the game system it names is read here.
 * An effect record is read only by the game system's rules model, so it is left opaque.
 */

export interface Snapshot {
  gameSystemId: string;
}
export type EffectRecord = unknown;

/** Accepts "3", "D6", "2D6", "D3+1" and "2D6+2", or a whole number. */
export type DiceExpr = string | number;

export interface WeaponKeyword {
  name: string;
  value?: number | string;
  keyword?: string;
  raw?: string;
}

export interface ScenarioModel {
  name: string;
  count: number;
  T: number;
  Sv: number;
  InvSv?: number | null;
  invSvAgainst?: "ranged" | "melee";
  W: number;
  fnp?: number | null;
  fnpSource?: string;
  woundsFrom?: { W: number; sources: string[] };
  isCharacter: boolean;
  keywords: string[];
}

export interface ScenarioWeapon {
  name: string;
  count: number;
  kind: "ranged" | "melee";
  range?: number | null;
  A: DiceExpr;
  skill: number | null;
  S: number;
  AP: number;
  D: DiceExpr;
  keywords: WeaponKeyword[];
  enabled: boolean;
}

export interface AttachedCharacter {
  name: string;
  role: "leader" | "support";
  datasheetId?: string;
}

export interface UnitRef {
  snapshotId: string;
  datasheetId: string;
  attachedDatasheetIds: string[];
  detachmentIds?: string[];
  enhancementIds?: string[];
}

export interface ScenarioUnit {
  name: string;
  ref?: UnitRef;
  keywords: string[];
  models: ScenarioModel[];
  weapons: ScenarioWeapon[];
  attached: AttachedCharacter[];
  effects: EffectRecord[];
  points?: number;
}

export interface ScenarioContext {
  rangeBand: "half" | "full";
  charged: boolean;
  stationary: boolean;
  inCover: boolean;
  snapShooting: boolean;
  phase: "shooting" | "fight";
  flags: string[];
  allocationPolicy: "in-order" | "protect-character";
  lethalChoice: "auto" | "always" | "never";
  weaponOrder: "listed" | "heuristic";
  mcIterations: number;
  backend: "auto" | "exact" | "mc";
}

export interface Scenario {
  ownerId: string;
  createdAt: string;
  updatedAt: string;
  revision: number;
  id: string;
  name: string;
  gameSystemId: string;
  snapshotId?: string;
  attacker: ScenarioUnit;
  defender: ScenarioUnit;
  context: ScenarioContext;
  enabledToggles: string[];
  extraEffects: EffectRecord[];
}

/** A preset unit the analyses score against, supplied by the game system. */
export interface Archetype {
  id: string;
  name: string;
  description?: string;
  unit: ScenarioUnit;
}

export interface Percentiles {
  p5: number;
  p25: number;
  p50: number;
  p75: number;
  p95: number;
}

export interface StageTrace {
  stage: string;
  label: string;
  expected: number;
  note?: string;
}

export interface WeaponResult {
  name: string;
  count: number;
  expectedAttacks: number;
  expectedHits: number;
  expectedWounds: number;
  expectedUnsaved: number;
  expectedDamage: number;
  trace: StageTrace[];
}

export interface CoverageReport {
  tier1: number;
  tier2: number;
  tier3: number;
  unmodelled: string[];
  advice: Record<string, string>;
}

export interface SimResult {
  backend: "exact" | "mc";
  iterations?: number;
  ciHalfWidth?: number;
  damagePMF: number[];
  slainPMF: number[];
  expectedDamage: number;
  expectedSlain: number;
  pKill: number;
  pAtLeastSlain: number[];
  damagePercentiles: Percentiles;
  slainPercentiles: Percentiles;
  expectedWasted: number;
  expectedSelfMortals: number;
  expectedReturnDamage?: number;
  weapons: WeaponResult[];
  attackerPoints?: number;
  defenderPoints?: number;
  defenderModels?: number;
  defenderWounds?: number;
  damagePerPoint?: number;
  pointsSlain?: number;
  coverage: CoverageReport;
  warnings: string[];
  finalState?: number[];
}
