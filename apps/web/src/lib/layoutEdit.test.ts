import { describe, expect, it } from "vitest";
import { BATTLE_SIZES, BREACHERS, CROSSFIRE, OPEN_APPROACH, RUINED_CITY, box, crater, ruin } from "@grimstat/board";
import {
  addObjective,
  addPiece,
  centre,
  copyLayout,
  duplicatePiece,
  isBuiltIn,
  placePieceSnapped,
  snap,
  snapPoint,
  edgeOffsetsOf,
  emptyLayout,
  extent,
  freeId,
  isSymmetric,
  layoutIssues,
  mirror,
  moveObjective,
  placeByEdges,
  movePiece,
  placePiece,
  removeObjective,
  removePiece,
  rename,
  resizePiece,
  rotatePiece,
  setSize,
  setStoreys,
  setTrait,
  updatePiece,
} from "./layoutEdit";

const SF = BATTLE_SIZES.strikeForce;
const blank = () => emptyLayout("mine", "Mine", SF);
const withRuin = () => addPiece(blank(), ruin("r1", { x: 20, y: 14 }, 8, 6, 2));

describe("ids", () => {
  it("takes the name asked for when it is free, and a suffix when it is not", () => {
    const layout = withRuin();
    expect(freeId(layout, "r2")).toBe("r2");
    expect(freeId(layout, "r1")).toBe("r1-2");
    expect(freeId(addPiece(layout, ruin("r1-2", { x: 40, y: 14 }, 6, 6)), "r1")).toBe("r1-3");
  });
});

describe("moving and shaping pieces", () => {
  it("adds and removes", () => {
    const layout = withRuin();
    expect(layout.pieces).toHaveLength(1);
    expect(removePiece(layout, "r1").pieces).toHaveLength(0);
    expect(removePiece(layout, "nope").pieces).toHaveLength(1);
  });

  it("moves by an offset and places by a centre", () => {
    const layout = movePiece(withRuin(), "r1", { x: 3, y: -2 });
    expect(centre(layout.pieces[0]!)).toEqual({ x: 23, y: 12 });
    expect(centre(placePiece(layout, "r1", { x: 30, y: 22 }).pieces[0]!)).toEqual({ x: 30, y: 22 });
  });

  it("resizes about its own centre", () => {
    const layout = resizePiece(withRuin(), "r1", 12, 4);
    expect(extent(layout.pieces[0]!)).toEqual({ width: 12, depth: 4 });
    expect(centre(layout.pieces[0]!)).toEqual({ x: 20, y: 14 }); // stayed put
  });

  it("refuses to resize a piece out of existence", () => {
    expect(extent(resizePiece(withRuin(), "r1", 0, -5).pieces[0]!).width).toBeGreaterThan(0);
  });

  it("rotates about its own centre", () => {
    const layout = rotatePiece(withRuin(), "r1", Math.PI / 2);
    const size = extent(layout.pieces[0]!);
    expect(size.width).toBeCloseTo(6); // 8 x 6 turned a quarter turn
    expect(size.depth).toBeCloseTo(8);
    expect(centre(layout.pieces[0]!).x).toBeCloseTo(20);
  });

  it("keeps the winding normalised after an edit", () => {
    // terrain() rewinds counter-clockwise; a rotation must not leave a mirrored ring behind.
    const layout = rotatePiece(withRuin(), "r1", Math.PI);
    expect(layoutIssues(layout)).toEqual([]);
  });

  it("names who may pass the walls the moment a piece becomes breachable", () => {
    const plain = addPiece(blank(), box("w", { x: 20, y: 14 }, 8, 6, 9));
    const walls = setTrait(plain, "w", "breachable", true);
    expect(walls.pieces[0]!.passableBy).toEqual([...BREACHERS]);
    // A list the user chose is theirs.
    const custom = updatePiece(walls, "w", (p) => ({ ...p, passableBy: ["MONSTER"] }));
    expect(setTrait(setTrait(custom, "w", "breachable", false), "w", "breachable", true).pieces[0]!.passableBy).toEqual(["MONSTER"]);
  });

  it("toggles a trait on and off without disturbing the others", () => {
    const on = setTrait(withRuin(), "r1", "difficult", true);
    expect(on.pieces[0]!.traits).toContain("difficult");
    expect(on.pieces[0]!.traits).toContain("obscuring");
    const off = setTrait(on, "r1", "difficult", false);
    expect(off.pieces[0]!.traits).not.toContain("difficult");
    expect(off.pieces[0]!.traits).toContain("obscuring");
    expect(setTrait(on, "r1", "difficult", true).pieces[0]!.traits.filter((t) => t === "difficult")).toHaveLength(1);
  });
});

describe("storeys", () => {
  it("gives a one-storey piece a walkable roof and nothing to climb", () => {
    const layout = setStoreys(addPiece(blank(), box("hill", { x: 20, y: 20 }, 8, 8, 3)), "hill", 1);
    expect(layout.pieces[0]!.floors).toEqual([3]);
    expect(layout.pieces[0]!.climbableBy).toEqual([]);
  });

  it("spaces storeys four inches apart and raises the roof to fit them", () => {
    const layout = setStoreys(addPiece(blank(), box("tower", { x: 20, y: 20 }, 8, 8, 3)), "tower", 3);
    expect(layout.pieces[0]!.floors).toEqual([0, 4, 8]);
    expect(layout.pieces[0]!.height).toBeGreaterThan(8);
  });

  it("decides who may go upstairs the moment there is an upstairs", () => {
    const layout = setStoreys(addPiece(blank(), box("tower", { x: 20, y: 20 }, 8, 8, 3)), "tower", 2);
    expect(layout.pieces[0]!.climbableBy).toContain("INFANTRY");
    expect(layout.pieces[0]!.climbableBy).not.toContain("VEHICLE");
  });

  it("leaves a hand-chosen climbing list alone", () => {
    const custom = updatePiece(addPiece(blank(), box("t", { x: 20, y: 20 }, 8, 8, 9, [], [0, 4])), "t", (p) => ({ ...p, climbableBy: ["MONSTER"] }));
    expect(setStoreys(custom, "t", 3).pieces[0]!.climbableBy).toEqual(["MONSTER"]);
  });
});

describe("placing by measurement", () => {
  // Published layouts give two distances and a corner, because that is how terrain is placed with a
  // tape measure. Transcribing one should be typing those numbers, not converting them to a centre.
  const at = (layout: ReturnType<typeof blank>) => edgeOffsetsOf(layout, layout.pieces[0]!);

  it("puts the named corner exactly where the measurements say", () => {
    const layout = placeByEdges(withRuin(), "r1", { fromLeft: 17, fromBottom: 8 });
    const box = at(layout);
    expect(box.fromLeft).toBeCloseTo(17);
    expect(box.fromBottom).toBeCloseTo(8);
    expect(extent(layout.pieces[0]!)).toEqual({ width: 8, depth: 6 }); // the piece kept its size
  });

  it("measures from whichever edge was named", () => {
    const layout = placeByEdges(withRuin(), "r1", { fromRight: 12, fromTop: 9 });
    const box = at(layout);
    expect(box.fromRight).toBeCloseTo(12);
    expect(box.fromTop).toBeCloseTo(9);
  });

  it("reads back every edge, so a transcription can be checked against the diagram", () => {
    const layout = placeByEdges(withRuin(), "r1", { fromLeft: 17, fromBottom: 8 });
    const box = at(layout);
    // Each reading is to the piece's own near side, so the four must account for the piece's size.
    expect(box.fromLeft + 8 + box.fromRight).toBeCloseTo(SF.width);
    expect(box.fromBottom + 6 + box.fromTop).toBeCloseTo(SF.depth);
  });

  it("prefers the edge that was named when both are given", () => {
    const layout = placeByEdges(withRuin(), "r1", { fromLeft: 10, fromRight: 99, fromBottom: 5, fromTop: 99 });
    const box = at(layout);
    expect(box.fromLeft).toBeCloseTo(10);
    expect(box.fromBottom).toBeCloseTo(5);
  });

  it("leaves an axis alone when that axis has no measurement", () => {
    const start = at(withRuin());
    const layout = placeByEdges(withRuin(), "r1", { fromLeft: 3 });
    expect(at(layout).fromLeft).toBeCloseTo(3);
    expect(at(layout).fromBottom).toBeCloseTo(start.fromBottom);
  });

  it("round-trips from either pair of edges", () => {
    const original = withRuin();
    const read = edgeOffsetsOf(original, original.pieces[0]!);
    const moved = movePiece(original, "r1", { x: 9, y: -4 });
    for (const pair of [{ fromLeft: read.fromLeft, fromBottom: read.fromBottom }, { fromRight: read.fromRight, fromTop: read.fromTop }]) {
      const replaced = placeByEdges(moved, "r1", pair);
      expect(centre(replaced.pieces[0]!).x).toBeCloseTo(centre(original.pieces[0]!).x);
      expect(centre(replaced.pieces[0]!).y).toBeCloseTo(centre(original.pieces[0]!).y);
    }
  });

  it("never needs a corner, because an edge distance names its own side", () => {
    // 17 from the left and 35 from the right describe the same 8" piece on a 60" table.
    const left = placeByEdges(withRuin(), "r1", { fromLeft: 17 });
    const right = placeByEdges(withRuin(), "r1", { fromRight: SF.width - 17 - 8 });
    expect(centre(left.pieces[0]!).x).toBeCloseTo(centre(right.pieces[0]!).x);
  });

  it("does nothing to a piece that is not there", () => {
    const layout = withRuin();
    expect(placeByEdges(layout, "nope", { fromLeft: 1 })).toEqual(layout);
  });
});

describe("objectives", () => {
  it("adds, moves and removes, keeping ids unique", () => {
    let layout = addObjective(blank(), { x: 30, y: 22 });
    layout = addObjective(layout, { x: 15, y: 11 });
    expect(layout.objectives.map((o) => o.id)).toEqual(["obj1", "obj2"]);
    layout = moveObjective(layout, "obj1", { x: 31, y: 23 });
    expect(layout.objectives[0]!.at).toEqual({ x: 31, y: 23 });
    expect(removeObjective(layout, "obj1").objectives).toHaveLength(1);
    // A gap in the numbering must not produce a duplicate.
    expect(addObjective(removeObjective(layout, "obj1"), { x: 1, y: 1 }).objectives.map((o) => o.id)).toEqual(["obj2", "obj3"]);
  });
});

describe("the board itself", () => {
  it("renames", () => {
    expect(rename(blank(), "Sector Imperialis").name).toBe("Sector Imperialis");
  });

  it("keeps everything centred when the table changes size", () => {
    const layout = addObjective(addPiece(blank(), ruin("r1", { x: 30, y: 22 }, 8, 6)), { x: 30, y: 22 });
    const bigger = setSize(layout, BATTLE_SIZES.onslaught);
    expect(centre(bigger.pieces[0]!)).toEqual({ x: 45, y: 22 }); // still the middle of the new table
    expect(bigger.objectives[0]!.at).toEqual({ x: 45, y: 22 });
    expect(layoutIssues(bigger)).toEqual([]);
  });
});

describe("mirroring", () => {
  it("gives the far side what the near side has", () => {
    const layout = addObjective(addPiece(blank(), ruin("r1", { x: 16, y: 10 }, 8, 6)), { x: 16, y: 10 });
    const fair = mirror(layout);
    expect(fair.pieces).toHaveLength(2);
    expect(fair.objectives).toHaveLength(2);
    expect(isSymmetric(fair)).toBe(true);
    expect(layoutIssues(fair)).toEqual([]);
  });

  it("throws away whatever was on the side it is not keeping", () => {
    let layout = addPiece(blank(), ruin("near", { x: 16, y: 10 }, 8, 6));
    layout = addPiece(layout, ruin("far", { x: 40, y: 36 }, 6, 6));
    const fair = mirror(layout, "near");
    expect(fair.pieces.map((p) => p.id)).toEqual(["near", "near'"]);
  });

  it("keeps a centrepiece once rather than doubling it", () => {
    const layout = addPiece(blank(), box("core", { x: 30, y: 22 }, 12, 10, 13));
    const fair = mirror(layout);
    expect(fair.pieces).toHaveLength(1);
    expect(isSymmetric(fair)).toBe(true);
  });

  it("keeps an objective on the centre line once", () => {
    const layout = addObjective(blank(), { x: 30, y: 22 });
    expect(mirror(layout).objectives).toHaveLength(1);
  });

  it("never leaves two pieces sharing an id", () => {
    let layout = addPiece(blank(), crater("c", { x: 12, y: 10 }, 6, 6));
    layout = addPiece(layout, crater("c'", { x: 24, y: 10 }, 6, 6));
    const ids = mirror(layout).pieces.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("agrees with the shipped layouts, which are already fair", () => {
    for (const layout of [OPEN_APPROACH, RUINED_CITY, CROSSFIRE]) expect(isSymmetric(layout)).toBe(true);
  });

  it("calls a lopsided layout what it is", () => {
    expect(isSymmetric(addPiece(blank(), ruin("r1", { x: 16, y: 10 }, 8, 6)))).toBe(false);
  });
});

describe("validation while editing", () => {
  it("reports a piece dragged off the table", () => {
    const layout = placePiece(withRuin(), "r1", { x: 1, y: 22 });
    expect(layoutIssues(layout)).toContain("r1: hangs off the table");
  });

  it("passes a layout built entirely through the editor", () => {
    let layout = emptyLayout("built", "Built", SF);
    layout = addPiece(layout, ruin(freeId(layout, "ruin"), { x: 14, y: 12 }, 9, 6, 2));
    layout = addPiece(layout, crater(freeId(layout, "crater"), { x: 30, y: 8 }, 7, 5));
    layout = addObjective(layout, { x: 30, y: 22 });
    layout = addObjective(layout, { x: 15, y: 11 });
    layout = mirror(layout);
    expect(layoutIssues(layout)).toEqual([]);
    expect(isSymmetric(layout)).toBe(true);
    expect(layout.pieces.length).toBe(4);
  });
});

describe("snapping", () => {
  it("rounds onto the half-inch grid and leaves no float noise behind", () => {
    expect(snap(17.26)).toBe(17.5);
    expect(snap(17.24)).toBe(17);
    expect(snap(0.1 + 0.2, 0.1)).toBe(0.3);
    expect(snapPoint({ x: 1.3, y: 2.8 })).toEqual({ x: 1.5, y: 3 });
  });

  it("settles a dragged piece so its sides, not its centre, read in half inches", () => {
    // An 11.5" piece: a centre on the grid would put both sides a quarter inch off it.
    const l = addPiece(blank(), box("big", { x: 20, y: 14 }, 11.5, 7, 9));
    const moved = placePieceSnapped(l, "big", { x: 30.17, y: 22.41 });
    const big = moved.pieces[0]!;
    const off = edgeOffsetsOf(moved, big);
    expect(off.fromLeft % 0.5).toBe(0);
    expect(off.fromBottom % 0.5).toBe(0);
    expect(extent(big)).toEqual({ width: 11.5, depth: 7 });
    // Never more than half a step from where the pointer asked for.
    expect(Math.abs(centre(big).x - 30.17)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(centre(big).y - 22.41)).toBeLessThanOrEqual(0.5);
  });

  it("does nothing for a piece that is not there", () => {
    const l = blank();
    expect(placePieceSnapped(l, "ghost", { x: 1, y: 1 })).toEqual(l);
  });

  it("returns the very same layout when the snapped position is where the piece already is", () => {
    const l = addPiece(blank(), box("b", { x: 20, y: 14 }, 8, 6, 3));
    expect(placePieceSnapped(l, "b", { x: 20.1, y: 13.9 })).toBe(l);
    const marked = addObjective(l, { x: 30, y: 22 });
    expect(moveObjective(marked, "obj1", { x: 30, y: 22 })).toBe(marked);
    expect(moveObjective(marked, "nope", { x: 1, y: 1 })).toBe(marked);
  });
});

describe("duplicating a piece", () => {
  it("copies everything but the position and finds a free id from the same stem", () => {
    const l = addPiece(withRuin(), box("wall-2", { x: 30, y: 30 }, 6, 2, 3, ["light-cover"]));
    const out = duplicatePiece(l, "wall-2")!;
    expect(out.id).toBe("wall");
    const twin = out.layout.pieces.find((p) => p.id === out.id)!;
    const original = l.pieces.find((p) => p.id === "wall-2")!;
    expect(extent(twin)).toEqual(extent(original));
    expect(twin.height).toBe(original.height);
    expect(twin.traits).toEqual(original.traits);
    expect(centre(twin)).toEqual({ x: 32, y: 28 });
    expect(duplicatePiece(l, "nope")).toBeUndefined();
  });
});

describe("shipped versus yours", () => {
  it("knows which layouts came with the app", () => {
    expect(isBuiltIn(RUINED_CITY.id)).toBe(true);
    expect(isBuiltIn("mine")).toBe(false);
  });

  it("copies under a fresh id, keeping the name asked for", () => {
    const copy = copyLayout(RUINED_CITY, "Mine now");
    expect(copy.id).not.toBe(RUINED_CITY.id);
    expect(copy.name).toBe("Mine now");
    expect(copy.pieces).toBe(RUINED_CITY.pieces);
    expect(copyLayout(RUINED_CITY).name).toBe(`${RUINED_CITY.name} copy`);
  });
});
