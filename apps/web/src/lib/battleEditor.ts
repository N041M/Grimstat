/**
 * The Battle page's state with a history behind the terrain.
 *
 * A reducer rather than a handful of `useState`s, for two reasons that are the same reason. Terrain
 * edits arrive faster than React renders while a piece is being dragged, so an edit has to be computed
 * from the state as it *is* when the edit is applied, never from the state a component saw when it
 * rendered — or two moves in one frame put the piece back where the first one found it. And undo needs
 * the layout as it was *before* each edit, which only the place applying the edit can know. Both
 * belong to a pure function of (state, action), and that function is this file.
 *
 * Only the terrain has a history. Moving models is the game being played, not a document being edited,
 * and it has its own "undo" in `resetMove`.
 */

import type { TerrainLayout } from "@grimstat/board";
import type { BattleState } from "./battle";
import { withLayout } from "./battle";
import { copyLayout, isBuiltIn } from "./layoutEdit";

export interface EditorState {
  readonly battle: BattleState;
  /** The layout as it stood before each recorded edit, oldest first. */
  readonly past: readonly TerrainLayout[];
  /** Edits undone, most recently undone first. */
  readonly future: readonly TerrainLayout[];
}

export type EditorAction =
  /** A different battle altogether: another layout, a reset. The history goes with the old one. */
  | { type: "replace"; battle: BattleState }
  /** Something happened to the units. Not recorded. */
  | { type: "units"; change: (battle: BattleState) => BattleState }
  /**
   * An edit to the terrain. Recorded unless told otherwise — a drag records its first move and not
   * the hundreds that follow, so one gesture is one step back.
   */
  | { type: "layout"; change: (layout: TerrainLayout) => TerrainLayout; record?: boolean }
  /**
   * The layout as the library just stored it: same table, possibly a new id or name. Not an edit, so
   * not recorded — and not a fork, even when the table was a shipped layout a moment ago. The
   * history survives when the id does; a layout saved under a new id is a new document.
   */
  | { type: "adopt"; layout: TerrainLayout }
  | { type: "undo" }
  | { type: "redo" };

/** Steps kept. A layout is a few kilobytes, so this is generous without being unbounded. */
export const HISTORY_CAP = 100;

/** What a shipped layout is called once it has been touched. The copy is the user's to rename. */
export const FORK_SUFFIX = " (edited)";

export const initialEditor = (battle: BattleState): EditorState => ({ battle, past: [], future: [] });

export const canUndo = (s: EditorState): boolean => s.past.length > 0;
export const canRedo = (s: EditorState): boolean => s.future.length > 0;

const push = (stack: readonly TerrainLayout[], layout: TerrainLayout): TerrainLayout[] => [...stack.slice(Math.max(0, stack.length + 1 - HISTORY_CAP)), layout];

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case "replace":
      return initialEditor(action.battle);

    case "units":
      return { ...state, battle: action.change(state.battle) };

    case "layout": {
      const current = state.battle.layout;
      const next = action.change(current);
      if (next === current) return state;
      // A shipped layout is never edited in place: the first change forks it into one of the user's,
      // so the four that come with the app stay as a place to start from.
      const layout = isBuiltIn(current.id) ? copyLayout(next, `${next.name}${FORK_SUFFIX}`) : next;
      const battle = withLayout(state.battle, layout);
      if (action.record === false) return { ...state, battle };
      return { battle, past: push(state.past, current), future: [] };
    }

    case "adopt": {
      const same = action.layout.id === state.battle.layout.id;
      return { battle: withLayout(state.battle, action.layout), past: same ? state.past : [], future: same ? state.future : [] };
    }

    case "undo": {
      const previous = state.past[state.past.length - 1];
      if (!previous) return state;
      return { battle: withLayout(state.battle, previous), past: state.past.slice(0, -1), future: [state.battle.layout, ...state.future] };
    }

    case "redo": {
      const [next, ...rest] = state.future;
      if (!next) return state;
      return { battle: withLayout(state.battle, next), past: push(state.past, state.battle.layout), future: rest };
    }
  }
}
