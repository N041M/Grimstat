import type { Roster, ScenarioUnit, Snapshot } from "@grimstat/schema";
import type { GameHandle } from "../../hooks/useGame";
import type { OpponentUnit, Side, UnitState } from "../../lib/game";

/** One of the player's units as the assistant needs it: resolved stats plus what has happened to it. */
export interface PlayUnit {
  /** Roster unit id, which is also the key into `state.units`. */
  id: string;
  /** The unit as the list has it, at full strength. */
  unit: ScenarioUnit;
  /** The unit as it stands now, scaled to the models still alive. Solve with this one. */
  current: ScenarioUnit;
  state: UnitState;
  /** Wounds of one model, and the unit's starting size: the arithmetic the wound tracker needs. */
  profileWounds: number;
  models: number;
  woundsLeft: number;
  modelsLeft: number;
}

/** An enemy unit with the same shape, built from typed stats or a stand-in archetype. */
export interface PlayFoe {
  id: string;
  foe: OpponentUnit;
  unit: ScenarioUnit;
  /** The unit as it stands now. Solve with this one. */
  current: ScenarioUnit;
  state: UnitState;
  profileWounds: number;
  models: number;
  woundsLeft: number;
  modelsLeft: number;
}

/** Everything the panels share. The page owns it; panels take the slice they need. */
export interface PlayContext {
  game: GameHandle;
  roster: Roster | undefined;
  snapshot: Snapshot | undefined;
  mine: PlayUnit[];
  foes: PlayFoe[];
}

/** Which side a tracked unit belongs to, for the damage actions. */
export type TargetRef = { side: Side; id: string };
