import { describe, expect, it } from "vitest";
import {
  BATTLE_SIZES,
  OBJECTIVE_RANGE,
  TerrainIndex,
  circleBase,
  control,
  inZone,
  objectiveHull,
  onBoard,
  ovalBase,
  rectZone,
  terrain,
  touchesZone,
  withinObjective,
  type ControlInput,
  type ModelHull,
  type Objective,
} from "./index";

const trooper = (x: number, y: number, z = 0): ModelHull => ({ pos: { x, y, z }, facing: 0, foot: circleBase(32), height: 2 });
const size = BATTLE_SIZES.strikeForce;

describe("the table", () => {
  it("keeps a whole base on the board", () => {
    expect(onBoard(trooper(30, 22), size)).toBe(true);
    expect(onBoard(trooper(0.1, 22), size)).toBe(false); // base overhangs the table edge
    expect(onBoard(trooper(-5, 22), size)).toBe(false);
    expect(onBoard(trooper(59.9, 22), size)).toBe(false);
  });

  it("accounts for a capsule's facing at the edge", () => {
    const lengthwise: ModelHull = { pos: { x: 2.5, y: 22, z: 0 }, facing: 0, foot: ovalBase(170, 105), height: 4 };
    const acrosswise: ModelHull = { ...lengthwise, facing: Math.PI / 2 };
    expect(onBoard(lengthwise, size)).toBe(false); // 3.35" half-length overhangs x = 0
    expect(onBoard(acrosswise, size)).toBe(true); // 2.07" half-width clears it
  });
});

describe("deployment zones", () => {
  const zone = rectZone("attacker", "attacker", 0, 0, 60, 12);

  it("asks for the whole base to be inside", () => {
    expect(inZone(trooper(30, 6), zone)).toBe(true);
    expect(inZone(trooper(30, 11.9), zone)).toBe(false); // base crosses the zone line
    expect(inZone(trooper(30, 14), zone)).toBe(false);
  });

  it("distinguishes touching from being wholly within", () => {
    expect(touchesZone(trooper(30, 12.3), zone)).toBe(true);
    expect(inZone(trooper(30, 12.3), zone)).toBe(false);
    expect(touchesZone(trooper(30, 20), zone)).toBe(false);
  });

  it("does not care about height: a zone reaches all the way up", () => {
    expect(inZone(trooper(30, 6, 12), zone)).toBe(true);
  });
});

describe("objectives", () => {
  const objective: Objective = { id: "centre", at: { x: 30, y: 22 } };

  it("measures control range from the marker's edge", () => {
    expect(withinObjective(trooper(30, 22), objective)).toBe(true);
    expect(withinObjective(trooper(30, 25), objective)).toBe(true);
    expect(withinObjective(trooper(30, 27), objective)).toBe(false);
  });

  it("measures it in three dimensions, so a gantry above the marker still holds it", () => {
    expect(withinObjective(trooper(30, 22, 2.5), objective)).toBe(true);
    expect(withinObjective(trooper(30, 22, 6), objective)).toBe(false); // four storeys is too far up
  });

  it("gives control to the higher total Objective Control", () => {
    const models: ControlInput[] = [
      { side: "attacker", hull: trooper(30, 23), oc: 2 },
      { side: "attacker", hull: trooper(31, 23), oc: 2 },
      { side: "defender", hull: trooper(29, 23), oc: 3 },
      { side: "defender", hull: trooper(50, 5), oc: 10 }, // nowhere near it
    ];
    const result = control(objective, models);
    expect(result.totals).toEqual({ attacker: 4, defender: 3 });
    expect(result.controlledBy).toBe("attacker");
    expect(result.contributors).toEqual([0, 1, 2]);
  });

  it("leaves a tie uncontrolled and ignores models with no Objective Control", () => {
    expect(
      control(objective, [
        { side: "attacker", hull: trooper(30, 23), oc: 2 },
        { side: "defender", hull: trooper(29, 23), oc: 2 },
      ]).controlledBy,
    ).toBeUndefined();
    expect(control(objective, [{ side: "attacker", hull: trooper(30, 23), oc: 0 }]).totals.attacker).toBe(0);
  });

  it("exposes the marker as a hull so it measures like anything else on the table", () => {
    const marker = objectiveHull({ id: "up", at: { x: 30, y: 22 }, z: 5 });
    expect(marker.pos.z).toBe(5);
    expect(marker.height).toBe(0);
    expect(OBJECTIVE_RANGE).toBe(3);
  });
});

describe("terrain normalisation", () => {
  it("winds the ring counter-clockwise whichever way it was authored", () => {
    const ring = [
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 2 },
    ];
    const forwards = terrain({ id: "a", polygon: ring, height: 3 });
    const backwards = terrain({ id: "b", polygon: [...ring].reverse(), height: 3 });
    expect(forwards.polygon).toEqual(backwards.polygon);
  });

  it("sorts floors and fills in the defaults", () => {
    const piece = terrain({ id: "ruin", polygon: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }], height: 9, floors: [6, 0, 3] });
    expect(piece.floors).toEqual([0, 3, 6]);
    expect(piece.base).toBe(0);
    expect(piece.traits).toEqual([]);
    expect(piece.passableBy).toEqual([]);
  });

  it("finds pieces by point and by proximity", () => {
    const idx = new TerrainIndex([
      terrain({ id: "near", polygon: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }], height: 3 }),
      terrain({ id: "far", polygon: [{ x: 40, y: 0 }, { x: 44, y: 0 }, { x: 44, y: 4 }, { x: 40, y: 4 }], height: 3 }),
    ]);
    expect(idx.at({ x: 2, y: 2 }).map((p) => p.id)).toEqual(["near"]);
    expect(idx.at({ x: 20, y: 2 })).toEqual([]);
    expect(idx.near({ x: 6, y: 2 }, 3).map((p) => p.id)).toEqual(["near"]);
    expect(idx.near({ x: 6, y: 2 }, 1)).toEqual([]);
  });
});
