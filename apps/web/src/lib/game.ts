import type { ScenarioUnit } from "@grimstat/schema";
import { newId, nowIso } from "./ids";

/**
 * The state of a game in progress, and the pure transitions over it.
 *
 * This is the first code in the project that owns round, phase, score and command points; the
 * engine only ever knew about one attack at a time. Everything here is arithmetic and bookkeeping:
 * no rules are enforced, because the players at the table are the authority and a companion that
 * argues with them is worse than useless.
 *
 * No Games Workshop data is encoded. Phases are the generic sequence every edition shares, and the
 * mission's specifics (what a primary is worth, which secondaries are in play) are supplied by the
 * user and stored on the game.
 */

export type Side = "you" | "them";
export const SIDES: readonly Side[] = ["you", "them"];
export const otherSide = (s: Side): Side => (s === "you" ? "them" : "you");

export type Phase = "command" | "movement" | "shooting" | "charge" | "fight" | "end";
export const PHASES: readonly Phase[] = ["command", "movement", "shooting", "charge", "fight", "end"];

/** The last battle round of a standard game. The tracker allows going past it. */
export const FINAL_ROUND = 5;
/** Command points gained at the start of each player's own command phase. */
export const CP_PER_COMMAND_PHASE = 1;

/** Per-turn flags a unit carries. They are cleared when its owner's turn begins. */
export interface UnitFlags {
  moved: boolean;
  advanced: boolean;
  fellBack: boolean;
  charged: boolean;
  /** Shot or fought this turn. The tracker never infers this; the player ticks it. */
  acted: boolean;
}

export const NO_FLAGS: UnitFlags = { moved: false, advanced: false, fellBack: false, charged: false, acted: false };

/** What has happened to one unit. Wounds are counted as lost so a unit's profile stays the truth. */
export interface UnitState {
  /** Whole models removed. */
  modelsLost: number;
  /** Wounds taken by the model currently being damaged, below its full total. */
  woundsLost: number;
  destroyed: boolean;
  flags: UnitFlags;
  /** In reserve or otherwise off the table. */
  offTable: boolean;
}

export const NEW_UNIT_STATE: UnitState = { modelsLost: 0, woundsLost: 0, destroyed: false, flags: NO_FLAGS, offTable: false };

/**
 * An enemy unit, entered as it is met. Either a handful of stats read off their datasheet or one
 * of the app's archetypes standing in, which is enough for the odds panel to solve against it.
 */
export interface OpponentUnit {
  id: string;
  name: string;
  /** Set when the player picked an archetype rather than typing stats. */
  archetypeId?: string;
  models: number;
  T: number;
  Sv: number;
  InvSv?: number | null;
  W: number;
  fnp?: number | null;
  points?: number;
}

/** A secondary mission the players agreed on. The name and cap come from the user. */
export interface Secondary {
  id: string;
  name: string;
  /** Most points it can score over the game, when the players set one. */
  cap?: number;
}

/** One scoring entry. Primaries and secondaries are both kept per round so the game can be read back. */
export interface ScoreEntry {
  round: number;
  /** Undefined for a primary. */
  secondaryId?: string;
  points: number;
}

export interface SideState {
  cp: number;
  scores: ScoreEntry[];
}

export const newSideState = (): SideState => ({ cp: 0, scores: [] });

export interface GameState {
  round: number;
  /** Whose turn it is. */
  active: Side;
  phase: Phase;
  you: SideState;
  them: SideState;
  /** Keyed by roster unit id. */
  units: Record<string, UnitState>;
  opponent: OpponentUnit[];
  /** Keyed by opponent unit id. */
  opponentUnits: Record<string, UnitState>;
  secondaries: Secondary[];
  /** True once the game has been called finished. */
  over: boolean;
}

export function newGameState(): GameState {
  return { round: 1, active: "you", phase: "command", you: newSideState(), them: newSideState(), units: {}, opponentUnits: {}, opponent: [], secondaries: [], over: false };
}

// ---------- actions ----------

export type GameAction =
  | { kind: "nextPhase" }
  | { kind: "setPhase"; phase: Phase }
  | { kind: "cp"; side: Side; delta: number }
  | { kind: "spendStratagem"; side: Side; cp: number; name: string }
  | { kind: "score"; side: Side; points: number; round?: number; secondaryId?: string }
  | { kind: "damage"; target: { side: Side; id: string }; wounds: number; profileWounds: number; models: number }
  | { kind: "heal"; target: { side: Side; id: string }; wounds: number; profileWounds: number }
  | { kind: "destroy"; target: { side: Side; id: string }; destroyed: boolean }
  | { kind: "flag"; target: { side: Side; id: string }; flag: keyof UnitFlags; on: boolean }
  | { kind: "offTable"; target: { side: Side; id: string }; off: boolean }
  | { kind: "addOpponent"; unit: OpponentUnit }
  | { kind: "removeOpponent"; id: string }
  | { kind: "addSecondary"; secondary: Secondary }
  | { kind: "removeSecondary"; id: string }
  | { kind: "finish"; over: boolean };

const clampPositive = (n: number): number => (Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);

function unitStateOf(state: GameState, side: Side, id: string): UnitState {
  const bag = side === "you" ? state.units : state.opponentUnits;
  return bag[id] ?? NEW_UNIT_STATE;
}

function withUnitState(state: GameState, side: Side, id: string, next: UnitState): GameState {
  return side === "you" ? { ...state, units: { ...state.units, [id]: next } } : { ...state, opponentUnits: { ...state.opponentUnits, [id]: next } };
}

/**
 * Spread `wounds` over a unit: fill the wounded model first, then whole models. `profileWounds` is
 * the wounds characteristic of one model and `models` the unit's starting size, so the arithmetic
 * stays correct for multi-wound units without the tracker holding a model list.
 */
export function applyDamage(unit: UnitState, wounds: number, profileWounds: number, models: number): UnitState {
  const w = Math.max(1, Math.floor(profileWounds));
  const size = Math.max(1, Math.floor(models));
  const taken = clampPositive(wounds);
  if (taken === 0) return unit;
  const total = unit.modelsLost * w + unit.woundsLost + taken;
  const cap = size * w;
  if (total >= cap) return { ...unit, modelsLost: size, woundsLost: 0, destroyed: true };
  return { ...unit, modelsLost: Math.floor(total / w), woundsLost: total % w, destroyed: false };
}

export function applyHeal(unit: UnitState, wounds: number, profileWounds: number): UnitState {
  const w = Math.max(1, Math.floor(profileWounds));
  const back = clampPositive(wounds);
  if (back === 0) return unit;
  const total = Math.max(0, unit.modelsLost * w + unit.woundsLost - back);
  return { ...unit, modelsLost: Math.floor(total / w), woundsLost: total % w, destroyed: false };
}

/** Wounds a unit has left, given its starting size and per-model wounds. */
export function woundsLeft(unit: UnitState, profileWounds: number, models: number): number {
  if (unit.destroyed) return 0;
  const w = Math.max(1, Math.floor(profileWounds));
  const size = Math.max(1, Math.floor(models));
  return Math.max(0, size * w - (unit.modelsLost * w + unit.woundsLost));
}

/** Models a unit has left. A part-wounded model still counts. */
export function modelsLeft(unit: UnitState, models: number): number {
  if (unit.destroyed) return 0;
  return Math.max(0, Math.floor(models) - unit.modelsLost);
}

/**
 * The next point in the sequence. The end phase hands the turn over; when both players have had a
 * turn the round advances. Nothing stops the round going past the last one, because games do.
 */
export function advance(state: GameState): GameState {
  const i = PHASES.indexOf(state.phase);
  const next = PHASES[i + 1];
  if (next) return { ...state, phase: next };
  if (state.active === "you") return startTurn({ ...state, active: "them", phase: "command" }, "them");
  return startTurn({ ...state, active: "you", phase: "command", round: state.round + 1 }, "you");
}

/** Beginning a player's turn clears their units' per-turn flags and pays the command phase point. */
function startTurn(state: GameState, side: Side): GameState {
  const bag = side === "you" ? state.units : state.opponentUnits;
  const cleared: Record<string, UnitState> = {};
  for (const [id, u] of Object.entries(bag)) cleared[id] = { ...u, flags: NO_FLAGS };
  const purse = { ...state[side], cp: state[side].cp + CP_PER_COMMAND_PHASE };
  const withFlags = side === "you" ? { ...state, units: cleared } : { ...state, opponentUnits: cleared };
  return { ...withFlags, [side]: purse };
}

export function applyAction(state: GameState, action: GameAction): GameState {
  switch (action.kind) {
    case "nextPhase":
      return advance(state);
    case "setPhase":
      return { ...state, phase: action.phase };
    case "cp": {
      const side = state[action.side];
      return { ...state, [action.side]: { ...side, cp: Math.max(0, side.cp + Math.floor(action.delta)) } };
    }
    case "spendStratagem": {
      const side = state[action.side];
      return { ...state, [action.side]: { ...side, cp: Math.max(0, side.cp - clampPositive(action.cp)) } };
    }
    case "score": {
      const side = state[action.side];
      const entry: ScoreEntry = { round: action.round ?? state.round, points: Math.floor(action.points), ...(action.secondaryId ? { secondaryId: action.secondaryId } : {}) };
      // One entry per round per scoring line; scoring again replaces it.
      const rest = side.scores.filter((s) => !(s.round === entry.round && s.secondaryId === entry.secondaryId));
      return { ...state, [action.side]: { ...side, scores: [...rest, entry].sort(byRoundThenLine) } };
    }
    case "damage": {
      const { side, id } = action.target;
      return withUnitState(state, side, id, applyDamage(unitStateOf(state, side, id), action.wounds, action.profileWounds, action.models));
    }
    case "heal": {
      const { side, id } = action.target;
      return withUnitState(state, side, id, applyHeal(unitStateOf(state, side, id), action.wounds, action.profileWounds));
    }
    case "destroy": {
      const { side, id } = action.target;
      const u = unitStateOf(state, side, id);
      return withUnitState(state, side, id, { ...u, destroyed: action.destroyed, ...(action.destroyed ? {} : { modelsLost: 0, woundsLost: 0 }) });
    }
    case "flag": {
      const { side, id } = action.target;
      const u = unitStateOf(state, side, id);
      return withUnitState(state, side, id, { ...u, flags: { ...u.flags, [action.flag]: action.on } });
    }
    case "offTable": {
      const { side, id } = action.target;
      const u = unitStateOf(state, side, id);
      return withUnitState(state, side, id, { ...u, offTable: action.off });
    }
    case "addOpponent":
      return { ...state, opponent: [...state.opponent, action.unit] };
    case "removeOpponent": {
      const { [action.id]: _drop, ...rest } = state.opponentUnits;
      return { ...state, opponent: state.opponent.filter((u) => u.id !== action.id), opponentUnits: rest };
    }
    case "addSecondary":
      return { ...state, secondaries: [...state.secondaries, action.secondary] };
    case "removeSecondary":
      return { ...state, secondaries: state.secondaries.filter((s) => s.id !== action.id), you: dropSecondary(state.you, action.id), them: dropSecondary(state.them, action.id) };
    case "finish":
      return { ...state, over: action.over };
  }
}

const dropSecondary = (side: SideState, id: string): SideState => ({ ...side, scores: side.scores.filter((s) => s.secondaryId !== id) });

function byRoundThenLine(a: ScoreEntry, b: ScoreEntry): number {
  if (a.round !== b.round) return a.round - b.round;
  return (a.secondaryId ?? "").localeCompare(b.secondaryId ?? "");
}

// ---------- reading the score ----------

export interface SideTotals {
  primary: number;
  secondary: number;
  total: number;
  /** Points scored in each round, primary and secondary together. */
  byRound: Map<number, number>;
}

export function totalsFor(side: SideState, secondaries: readonly Secondary[]): SideTotals {
  const caps = new Map(secondaries.map((s) => [s.id, s.cap] as const));
  const perSecondary = new Map<string, number>();
  let primary = 0;
  const byRound = new Map<number, number>();
  for (const e of side.scores) {
    if (e.secondaryId) perSecondary.set(e.secondaryId, (perSecondary.get(e.secondaryId) ?? 0) + e.points);
    else primary += e.points;
    byRound.set(e.round, (byRound.get(e.round) ?? 0) + e.points);
  }
  let secondary = 0;
  for (const [id, points] of perSecondary) {
    const cap = caps.get(id);
    secondary += cap === undefined ? points : Math.min(points, cap);
  }
  return { primary, secondary, total: primary + secondary, byRound };
}

/** What a side has scored on one line in one round, or undefined when it has not been entered. */
export function scoredIn(side: SideState, round: number, secondaryId?: string): number | undefined {
  return side.scores.find((s) => s.round === round && s.secondaryId === secondaryId)?.points;
}

// ---------- the log ----------

export type LogKind = "phase" | "cp" | "score" | "damage" | "destroy" | "stratagem" | "note" | "setup";

export interface LogEntry {
  id: string;
  at: string;
  round: number;
  phase: Phase;
  active: Side;
  kind: LogKind;
  text: string;
  /** Wounds, command points or victory points the line carried, when it carried a number. */
  amount?: number;
  /** Which side the number applies to. */
  side?: Side;
  /** The unit the line is about, for the per-unit summary. */
  unitId?: string;
  /** What the solver said to expect, when the line came from an estimate the player accepted. */
  predicted?: number;
}

/** Extra facts a log line may carry, so the end-of-game summary is arithmetic rather than parsing. */
export type LogFacts = Pick<LogEntry, "amount" | "side" | "unitId" | "predicted">;

export function logEntry(state: GameState, kind: LogKind, text: string, facts: LogFacts = {}): LogEntry {
  const extra: LogFacts = {};
  if (facts.amount !== undefined) extra.amount = facts.amount;
  if (facts.side !== undefined) extra.side = facts.side;
  if (facts.unitId !== undefined) extra.unitId = facts.unitId;
  if (facts.predicted !== undefined) extra.predicted = facts.predicted;
  return { id: newId("log"), at: nowIso(), round: state.round, phase: state.phase, active: state.active, kind, text, ...extra };
}

// ---------- reading a finished game back ----------

export interface RoundSummary {
  round: number;
  /** Wounds each side dealt in that round, from the damage lines. */
  dealt: { you: number; them: number };
  cpSpent: { you: number; them: number };
  scored: { you: number; them: number };
}

export interface GameSummary {
  rounds: RoundSummary[];
  dealt: { you: number; them: number };
  cpSpent: { you: number; them: number };
  /** Every estimate the player accepted, against what was actually applied. */
  estimates: Array<{ predicted: number; actual: number; unitId?: string }>;
}

const emptyPair = () => ({ you: 0, them: 0 });

/**
 * What happened, read back from the log and the scores. Damage lines name the side that took the
 * wounds, so dealing is the other side's doing.
 */
export function summarise(log: readonly LogEntry[], state: GameState): GameSummary {
  const byRound = new Map<number, RoundSummary>();
  const at = (round: number): RoundSummary => {
    let r = byRound.get(round);
    if (!r) {
      r = { round, dealt: emptyPair(), cpSpent: emptyPair(), scored: emptyPair() };
      byRound.set(round, r);
    }
    return r;
  };
  const estimates: GameSummary["estimates"] = [];
  const dealt = emptyPair();
  const cpSpent = emptyPair();
  for (const e of log) {
    const row = at(e.round);
    if (e.kind === "damage" && e.amount !== undefined && e.side) {
      const dealer = otherSide(e.side);
      row.dealt[dealer] += e.amount;
      dealt[dealer] += e.amount;
      if (e.predicted !== undefined) estimates.push({ predicted: e.predicted, actual: e.amount, ...(e.unitId ? { unitId: e.unitId } : {}) });
    }
    if (e.kind === "stratagem" && e.amount !== undefined) {
      const side = e.side ?? "you";
      row.cpSpent[side] += e.amount;
      cpSpent[side] += e.amount;
    }
  }
  for (const side of SIDES) for (const entry of state[side].scores) at(entry.round).scored[side] += entry.points;
  return { rounds: [...byRound.values()].sort((a, b) => a.round - b.round), dealt, cpSpent, estimates };
}

// ---------- solving against a tracked unit ----------

/**
 * An opponent unit as the solver sees it. Archetype-backed units are resolved by the caller, which
 * owns the plugin; this builds the typed-stats case.
 */
export function opponentScenarioUnit(u: OpponentUnit, state?: UnitState): ScenarioUnit {
  const alive = state ? modelsLeft(state, u.models) : u.models;
  return {
    name: u.name,
    keywords: [],
    models: [
      {
        name: u.name,
        count: Math.max(1, alive),
        T: u.T,
        Sv: u.Sv,
        ...(u.InvSv === undefined || u.InvSv === null ? {} : { InvSv: u.InvSv }),
        W: Math.max(1, Math.floor(u.W)),
        ...(u.fnp === undefined || u.fnp === null ? {} : { fnp: u.fnp }),
        isCharacter: false,
        keywords: [],
      },
    ],
    weapons: [],
    effects: [],
    ...(u.points === undefined ? {} : { points: u.points }),
  };
}

/**
 * The unit as it stands now: model groups and weapon counts scaled to the models still alive.
 *
 * Casualties are taken from the back of the unit, which is how a squad is usually removed, and
 * weapon counts fall with the models carrying them. The tracker does not know which specific models
 * died, so this is proportional rather than exact; it is far closer than solving at full strength,
 * which is what a companion would otherwise report in the middle of a game.
 */
export function atStrength(unit: ScenarioUnit, state: UnitState, startingModels: number): ScenarioUnit {
  const alive = modelsLeft(state, startingModels);
  const start = Math.max(1, Math.floor(startingModels));
  if (alive >= start) return unit;
  if (alive <= 0) return { ...unit, models: unit.models.map((m) => ({ ...m, count: 0 })), weapons: unit.weapons.map((w) => ({ ...w, count: 0 })) };

  // Fill the groups from the front until the survivors run out.
  let left = alive;
  const models = unit.models.map((m) => {
    const keep = Math.min(m.count, left);
    left -= keep;
    return { ...m, count: keep };
  });
  const ratio = alive / start;
  const weapons = unit.weapons.map((w) => ({ ...w, count: w.count === 0 ? 0 : Math.max(1, Math.round(w.count * ratio)) }));
  return { ...unit, models, weapons };
}

/** A blank enemy unit for the "add what I am looking at" form. */
export function newOpponentUnit(name = ""): OpponentUnit {
  return { id: newId("foe"), name, models: 1, T: 4, Sv: 3, W: 2 };
}
