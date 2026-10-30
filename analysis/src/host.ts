import type { Archetype, Scenario, ScenarioContext, ScenarioUnit, SimResult, Snapshot } from "./schema";

/**
 * Army-level analyses, over whatever game system supplies the pieces below.
 *
 * Every analysis in this package is the same shape: build scenarios, run them, and put the results
 * together. None of them reads a Strength, a Toughness or a save. They need a function that scores
 * one scenario, a set of preset units to score against, and a list of the one-at-a-time changes the
 * what-if analysis offers. Those three are what one game system's rules model supplies; the matrix,
 * the durability profile, the efficiency ranking, the turn optimiser and the reverse search are the
 * same arithmetic whichever system supplies them.
 *
 * The functions come from `createAnalyses(host)` rather than taking the host at each call, so a
 * caller holding one game system's analyses cannot accidentally score against another's.
 */
export interface AnalysisHost<Ref extends object = ReferenceAttack> {
  /** The game system an analysis scores under when neither a snapshot nor the caller names one. */
  defaultGameSystemId: string;
  /** Score one scenario. Pure and synchronous. */
  runScenario(scenario: Scenario, opts?: { snapshot?: Snapshot; initialState?: number[] }): SimResult;
  /** Preset units the durability, efficiency and incoming-fire analyses score against. */
  archetypes: readonly Archetype[];
  /** The one-at-a-time changes the what-if analysis offers. */
  sensitivityVariants: readonly SensitivityVariantDef[];
  /** The plain attack `effectiveWounds` measures a unit against. */
  referenceAttack: Ref;
  /** A unit carrying one reference attack and nothing else, for firing at a defender. */
  referenceAttacker(ref: Ref): ScenarioUnit;
  /** Archetype ids the durability profile and the durability index score against by default. */
  defaultAttackerIds: readonly string[];
  /** Archetype ids the efficiency ranking scores against by default. */
  defaultTargetIds: readonly string[];
  /** What a turn may spend command points on, for an attacker that names no options of its own. */
  defaultTurnOptions: readonly TurnOption[];
}

/** One stratagem-like choice a turn may spend command points on. */
export interface TurnOption {
  id: string;
  label: string;
  cp: number;
  enabledToggles: string[];
  /**
   * The stratagem the option uses. A stratagem is used once in a phase, so a plan gives it to one
   * attacker at most. Options without one can be taken by every attacker.
   */
  stratagemId?: string;
}

/**
 * The default shape of a reference attack, for a host that does not say what its own is.
 *
 * `AnalysisHost` is generic over it, so a game system that names its own type keeps that type all the
 * way through `pReferenceSticks` and `effectiveWounds` and its `referenceAttacker` reads the fields
 * it declared rather than whatever a caller passed.
 */
export type ReferenceAttack = Record<string, number>;

/** One change the what-if analysis applies to a scenario on its own. */
export interface SensitivityVariantDef {
  id: string;
  label: string;
  side: "attacker" | "defender";
  toggles?: string[];
  context?: Partial<ScenarioContext>;
}

/** Everything an analysis needs to pick a game system. Every entry point accepts both. */
export interface EditionOpts {
  snapshot?: Snapshot;
  /** The game system to score under, for a caller with no snapshot to read it off. */
  gameSystemId?: string;
}

/** How a figure was worked out, and how wide its interval is. Every analysis row carries one. */
export interface RunSampling {
  /** "mc" when sampling produced the figure, so it carries sampling error. */
  backend: "exact" | "mc";
  /**
   * 95% confidence half-width on the figure, on the figure's own scale. Absent when no interval can
   * be quoted, which covers a figure solved exactly and a sampled one the engine declined to quote.
   */
  ciHalfWidth?: number;
}

/** The two scenario helpers the turn optimiser and the reverse search need from the analyses. */
export interface AnalysisCore {
  editionOf(opts: EditionOpts): string;
  makeScenario(attacker: ScenarioUnit, defender: ScenarioUnit, context?: Partial<ScenarioContext>, enabledToggles?: string[], gameSystemId?: string): Scenario;
}
