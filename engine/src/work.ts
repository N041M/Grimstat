/**
 * Work the engine has done since it loaded. Tests read the difference across a call to check what
 * the call cost, so the counts are plain numbers and nothing reads them back inside the engine.
 */
export const engineWork = {
  /** Two-dimensional convolutions made while building per-hit tables. */
  convolutions: 0,
  /** Weapon profiles whose tables were built rather than found already built. */
  tableBuilds: 0,
  /** Reachable-state sets built rather than found already built. */
  reachBuilds: 0,
  /** Events applied to a state distribution. */
  events: 0,
  /** States read by those events. */
  stateVisits: 0,
  /** Cells of the tables that say where an event takes each reachable state. */
  moveCells: 0,
};
