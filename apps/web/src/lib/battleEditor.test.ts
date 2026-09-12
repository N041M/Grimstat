import { describe, expect, it } from "vitest";
import { BATTLE_SIZES, RUINED_CITY, ruin } from "@grimstat/board";
import { deployUnit, freshDeployment, sampleBattle, withdrawUnit } from "./battle";
import { addPiece, emptyLayout, movePiece } from "./layoutEdit";
import { FORK_SUFFIX, HISTORY_CAP, UNIT_HISTORY_CAP, canRedo, canUndo, canUndoUnits, editorReducer, initialEditor, type EditorAction, type EditorState } from "./battleEditor";

const mine = () => addPiece(emptyLayout("mine", "Mine", BATTLE_SIZES.strikeForce), ruin("r1", { x: 20, y: 14 }, 8, 6, 2));
const start = (layout = mine()) => initialEditor(sampleBattle(layout));
const run = (s: EditorState, ...actions: EditorAction[]) => actions.reduce(editorReducer, s);
const nudge = (by: number): Extract<EditorAction, { type: "layout" }> => ({ type: "layout", change: (l) => movePiece(l, "r1", { x: by, y: 0 }) });
const xOf = (s: EditorState) => s.battle.layout.pieces[0]!.polygon[0]!.x;

describe("editing with a history", () => {
  it("records each edit and walks back and forward through them", () => {
    let s = run(start(), nudge(1), nudge(1));
    expect(xOf(s)).toBe(18);
    expect(canUndo(s)).toBe(true);
    expect(canRedo(s)).toBe(false);

    s = editorReducer(s, { type: "undo" });
    expect(xOf(s)).toBe(17);
    s = editorReducer(s, { type: "undo" });
    expect(xOf(s)).toBe(16);
    expect(canUndo(s)).toBe(false);
    expect(canRedo(s)).toBe(true);

    s = editorReducer(s, { type: "redo" });
    expect(xOf(s)).toBe(17);
    s = editorReducer(s, { type: "redo" });
    expect(xOf(s)).toBe(18);
    expect(canRedo(s)).toBe(false);
  });

  it("does nothing on undo or redo with nothing to undo or redo", () => {
    const s = start();
    expect(editorReducer(s, { type: "undo" })).toBe(s);
    expect(editorReducer(s, { type: "redo" })).toBe(s);
  });

  it("throws the redo stack away when a new edit is made", () => {
    const s = run(start(), nudge(1), { type: "undo" }, nudge(5));
    expect(xOf(s)).toBe(21);
    expect(canRedo(s)).toBe(false);
  });

  it("leaves a drag as one step: the first move is recorded and the rest are not", () => {
    const s = run(start(), nudge(1), { ...nudge(1), record: false }, { ...nudge(1), record: false });
    expect(xOf(s)).toBe(19);
    expect(s.past).toHaveLength(1);
    expect(xOf(editorReducer(s, { type: "undo" }))).toBe(16);
  });

  it("ignores an edit that changed nothing", () => {
    const s = start();
    expect(editorReducer(s, { type: "layout", change: (l) => l })).toBe(s);
  });

  it("forks a shipped layout on the first edit, and undo brings the shipped one back untouched", () => {
    const s0 = start(RUINED_CITY);
    const s1 = editorReducer(s0, { type: "layout", change: (l) => movePiece(l, "a1", { x: 1, y: 0 }) });
    expect(s1.battle.layout.id).not.toBe(RUINED_CITY.id);
    expect(s1.battle.layout.name).toBe(`${RUINED_CITY.name}${FORK_SUFFIX}`);
    // Later edits stay on the fork rather than forking again.
    const s2 = editorReducer(s1, { type: "layout", change: (l) => movePiece(l, "a1", { x: 1, y: 0 }) });
    expect(s2.battle.layout.id).toBe(s1.battle.layout.id);

    const back = run(s2, { type: "undo" }, { type: "undo" });
    expect(back.battle.layout).toBe(RUINED_CITY);
    expect(RUINED_CITY.pieces.find((p) => p.id === "a1")!.polygon[0]!.x).toBe(6.5);
  });

  it("keeps the units where they were when the terrain changes, and the terrain when the units move", () => {
    const s0 = start();
    const s1 = editorReducer(s0, nudge(1));
    expect(s1.battle.units).toBe(s0.battle.units);
    const s2 = editorReducer(s1, { type: "units", change: (b) => ({ ...b, units: b.units.slice(1) }) });
    expect(s2.battle.layout).toBe(s1.battle.layout);
    expect(s2.past).toBe(s1.past);
  });

  it("starts a fresh history when the battle is replaced", () => {
    const s = run(start(), nudge(1), { type: "replace", battle: sampleBattle(RUINED_CITY) });
    expect(canUndo(s)).toBe(false);
    expect(s.battle.layout).toBe(RUINED_CITY);
  });

  it("adopts what the library stored: history kept under the same id, dropped under a new one", () => {
    const s1 = run(start(), nudge(1));
    const renamed = { ...s1.battle.layout, name: "Renamed" };
    const s2 = editorReducer(s1, { type: "adopt", layout: renamed });
    expect(s2.battle.layout.name).toBe("Renamed");
    expect(s2.past).toBe(s1.past);

    const saved = { ...s2.battle.layout, id: "saved-copy" };
    const s3 = editorReducer(s2, { type: "adopt", layout: saved });
    expect(s3.battle.layout.id).toBe("saved-copy");
    expect(canUndo(s3)).toBe(false);
    // Adopting is not editing: a shipped layout adopted verbatim stays a shipped layout.
    const shipped = editorReducer(start(), { type: "adopt", layout: RUINED_CITY });
    expect(shipped.battle.layout).toBe(RUINED_CITY);
  });

  it("forgets the oldest step past the cap", () => {
    let s = start();
    for (let i = 0; i < HISTORY_CAP + 10; i++) s = editorReducer(s, nudge(1));
    expect(s.past).toHaveLength(HISTORY_CAP);
    expect(s.past[0]!.pieces[0]!.polygon[0]!.x).toBe(16 + 10);
  });
});

describe("taking unit actions back", () => {
  const withdrawFirst: EditorAction = { type: "units", record: true, change: (b) => ({ ...b, units: b.units.map((u, i) => (i === 0 ? withdrawUnit(u) : u)) }) };

  it("records a unit action when asked and puts the units back on undo, leaving the terrain history alone", () => {
    const s0 = run(start(), nudge(1));
    expect(canUndoUnits(s0)).toBe(false);
    const s1 = editorReducer(s0, withdrawFirst);
    expect(s1.battle.units[0]!.reserve).toBe(true);
    expect(canUndoUnits(s1)).toBe(true);
    expect(s1.past).toBe(s0.past);

    const s2 = editorReducer(s1, { type: "undoUnits" });
    expect(s2.battle.units).toBe(s0.battle.units);
    expect(canUndoUnits(s2)).toBe(false);
    expect(s2.past).toBe(s0.past);
    expect(canUndo(s2)).toBe(true);
  });

  it("does not record an unrecorded action, an action that changed nothing, or an undo with nothing to undo", () => {
    const s0 = start();
    const quiet = editorReducer(s0, { ...withdrawFirst, record: false });
    expect(quiet.battle.units[0]!.reserve).toBe(true);
    expect(canUndoUnits(quiet)).toBe(false);
    expect(editorReducer(s0, { type: "units", record: true, change: (b) => b })).toBe(s0);
    expect(editorReducer(s0, { type: "undoUnits" })).toBe(s0);
  });

  it("keeps the layout history through a reset of the deployment", () => {
    const s0 = run(start(), nudge(1), withdrawFirst);
    const s1 = editorReducer(s0, { type: "units", record: true, change: freshDeployment });
    expect(s1.battle.units[0]!.reserve).toBe(false);
    expect(s1.past).toBe(s0.past);
    expect(editorReducer(s1, { type: "undoUnits" }).battle.units).toBe(s0.battle.units);
  });

  it("forgets the oldest unit positions past the cap, and drops them all when the battle is replaced", () => {
    let s = start();
    for (let i = 0; i < UNIT_HISTORY_CAP + 5; i++) {
      const at = { x: 10 + (i % 5), y: 5 };
      s = editorReducer(s, { type: "units", record: true, change: (b) => ({ ...b, units: b.units.map((u, j) => (j === 0 ? deployUnit(u, at) : u)) }) });
    }
    expect(s.unitsPast).toHaveLength(UNIT_HISTORY_CAP);
    expect(canUndoUnits(editorReducer(s, { type: "replace", battle: sampleBattle(RUINED_CITY) }))).toBe(false);
  });
});
