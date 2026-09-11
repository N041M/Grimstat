import { describe, expect, it } from "vitest";
import {
  BATTLE_SIZES,
  CROSSFIRE,
  LAYOUTS,
  RUINED_CITY,
  TerrainIndex,
  box,
  circleBase,
  control,
  crater,
  edgeZones,
  inZone,
  layoutIssues,
  mayClimb,
  mirrored,
  opposite,
  quincunx,
  reachable,
  ruin,
  terrain,
  unitSight,
  type ModelHull,
  type TerrainLayout,
} from "./index";

const model = (x: number, y: number, z = 0): ModelHull => ({ pos: { x, y, z }, facing: 0, foot: circleBase(32), height: 2 });

describe("layout building blocks", () => {
  it("places a box by its centre and extents", () => {
    const piece = box("b", { x: 10, y: 10 }, 8, 4, 3);
    const xs = piece.polygon.map((p) => p.x);
    const ys = piece.polygon.map((p) => p.y);
    expect(Math.min(...xs)).toBe(6);
    expect(Math.max(...xs)).toBe(14);
    expect(Math.min(...ys)).toBe(8);
    expect(Math.max(...ys)).toBe(12);
  });

  it("gives a ruin a storey every four inches and walls a model can breach", () => {
    const piece = ruin("r", { x: 10, y: 10 }, 8, 6, 3);
    expect(piece.floors).toEqual([0, 4, 8]);
    expect(piece.height).toBeGreaterThan(8);
    expect(piece.traits).toContain("obscuring");
    expect(piece.traits).toContain("breachable");
  });

  it("keeps a crater out of the way of sight lines", () => {
    const piece = crater("c", { x: 10, y: 10 }, 8, 6);
    expect(piece.traits).toContain("light-cover");
    expect(piece.traits).toContain("transparent");
    expect(piece.height).toBeLessThan(2);
  });

  it("puts the quincunx where the quarter points are", () => {
    expect(quincunx(BATTLE_SIZES.strikeForce)).toEqual([
      { x: 30, y: 22 },
      { x: 15, y: 11 },
      { x: 45, y: 11 },
      { x: 15, y: 33 },
      { x: 45, y: 33 },
    ]);
  });
});

describe("mirroring", () => {
  const size = BATTLE_SIZES.strikeForce;

  it("rotates a point through the table centre", () => {
    expect(opposite({ x: 10, y: 8 }, size)).toEqual({ x: 50, y: 36 });
    expect(opposite({ x: 30, y: 22 }, size)).toEqual({ x: 30, y: 22 });
  });

  it("gives every piece a twin", () => {
    const layout = mirrored({ id: "t", name: "T", size, objectives: [{ x: 15, y: 11 }], half: ({ ruin }) => [ruin("a", { x: 12, y: 30 }, 8, 6)] });
    expect(layout.pieces).toHaveLength(2);
    expect(layout.objectives).toHaveLength(2);
  });

  it("does not double a piece or an objective that sits on the centre", () => {
    const layout = mirrored({ id: "t", name: "T", size, objectives: [{ x: 30, y: 22 }], half: ({ box }) => [box("core", { x: 30, y: 22 }, 10, 8, 6)] });
    expect(layout.pieces).toHaveLength(1);
    expect(layout.objectives).toHaveLength(1);
  });
});

describe("the shipped layouts", () => {
  it.each(LAYOUTS.map((l) => [l.name, l] as const))("%s is playable", (_name, layout: TerrainLayout) => {
    expect(layoutIssues(layout)).toEqual([]);
    expect(layout.pieces.length).toBeGreaterThan(0);
    expect(layout.objectives.length).toBeGreaterThan(0);
  });

  it.each(LAYOUTS.map((l) => [l.name, l] as const))("%s is fair to both sides", (_name, layout: TerrainLayout) => {
    // Rotating the whole layout 180° must give back the same set of footprints and objectives.
    const foot = (p: readonly { x: number; y: number }[]) =>
      p
        .map((q) => `${q.x.toFixed(2)},${q.y.toFixed(2)}`)
        .sort()
        .join("|");
    const original = new Set(layout.pieces.map((p) => foot(p.polygon)));
    const rotated = new Set(layout.pieces.map((p) => foot(p.polygon.map((q) => opposite(q, layout.size)))));
    expect(rotated).toEqual(original);

    const objectives = new Set(layout.objectives.map((o) => `${o.at.x.toFixed(2)},${o.at.y.toFixed(2)}`));
    const flipped = new Set(layout.objectives.map((o) => { const p = opposite(o.at, layout.size); return `${p.x.toFixed(2)},${p.y.toFixed(2)}`; }));
    expect(flipped).toEqual(objectives);
  });

  it("lets a unit walk from its deployment edge to the middle of a dense layout", () => {
    const index = new TerrainIndex(RUINED_CITY.pieces);
    const start = model(30, 4);
    const reach = reachable(start, 12, index);
    const centre = RUINED_CITY.objectives[0]!;
    expect(reach.nodes.some((n) => Math.hypot(n.at.x - centre.at.x, n.at.y - centre.at.y) < 8)).toBe(true);
  });

  it("makes a dense layout harder to shoot across than a sparse one", () => {
    const across = (layout: TerrainLayout) => unitSight([model(30, 4)], [model(30, 40)], new TerrainIndex(layout.pieces));
    expect(across(RUINED_CITY)).toBe(false); // the centre ruins are in the way
    expect(across(CROSSFIRE)).toBe(false); // so is the centrepiece
  });

  it("puts a ruin's upper floor within reach and worth standing on", () => {
    const index = new TerrainIndex(CROSSFIRE.pieces);
    // A ruin's storeys are for models on their own feet: without a climbing keyword there is no way up.
    expect(reachable(model(30, 16), 12, index, { keywords: ["VEHICLE"] }).nodes.every((n) => n.at.z < 3)).toBe(true);
    const reach = reachable(model(30, 16), 12, index, { keywords: ["INFANTRY"] });
    const upstairs = reach.nodes.filter((n) => n.at.z > 3);
    expect(upstairs.length).toBeGreaterThan(0);
    // Standing on the second storey of the centrepiece, a model sees across the table.
    const high = upstairs.reduce((a, b) => (b.at.z > a.at.z ? b : a));
    expect(unitSight([{ ...model(0, 0), pos: high.at }], [model(30, 40)], index)).toBe(true);
  });

  it("counts objective control on a real layout", () => {
    const objective = CROSSFIRE.objectives[0]!;
    const result = control(objective, [
      { side: "attacker", hull: model(objective.at.x + 1, objective.at.y), oc: 2 },
      { side: "defender", hull: model(objective.at.x - 1, objective.at.y), oc: 1 },
    ]);
    expect(result.controlledBy).toBe("attacker");
  });
});

describe("deployment zones", () => {
  const size = BATTLE_SIZES.strikeForce;

  it("puts a strip along each short edge, facing one another", () => {
    const [attacker, defender] = edgeZones(size);
    expect(attacker.owner).toBe("attacker");
    expect(defender.owner).toBe("defender");
    expect(inZone(model(30, 6), attacker)).toBe(true);
    expect(inZone(model(30, 38), defender)).toBe(true);
    expect(inZone(model(30, 22), attacker)).toBe(false);
    expect(inZone(model(30, 22), defender)).toBe(false);
  });

  it("mirrors: whatever is in one zone is in the other when rotated", () => {
    const [attacker, defender] = edgeZones(size);
    const here = model(18, 5);
    const there = { ...here, pos: { ...opposite(here.pos, size), z: 0 } };
    expect(inZone(here, attacker)).toBe(inZone(there, defender));
  });

  it("takes a depth", () => {
    const [attacker] = edgeZones(size, 9);
    expect(inZone(model(30, 8), attacker)).toBe(true);
    expect(inZone(model(30, 11), attacker)).toBe(false);
  });
});

describe("who may climb", () => {
  const tri = [{ x: 20, y: 20 }, { x: 26, y: 20 }, { x: 26, y: 26 }];

  it("lets anyone up a piece that names nobody", () => {
    expect(mayClimb(terrain({ id: "r", polygon: tri, height: 9, floors: [0, 4] }), new Set(["VEHICLE"]))).toBe(true);
  });

  it("matches keywords whichever case either side is written in", () => {
    const ruin = terrain({ id: "r", polygon: tri, height: 9, floors: [0, 4], climbableBy: ["Infantry"] });
    expect(mayClimb(ruin, new Set(["INFANTRY"]))).toBe(true);
    expect(mayClimb(ruin, new Set(["infantry"]))).toBe(true);
    expect(mayClimb(ruin, ["Infantry"])).toBe(true); // any iterable, not only a Set
    expect(mayClimb(ruin, new Set(["VEHICLE"]))).toBe(false);
  });

  it("keeps a tank out of the ruins the layouts ship", () => {
    const storeyed = RUINED_CITY.pieces.filter((p) => p.floors.length > 1);
    expect(storeyed.length).toBeGreaterThan(0);
    for (const piece of storeyed) {
      expect(mayClimb(piece, ["INFANTRY"])).toBe(true);
      expect(mayClimb(piece, ["VEHICLE"])).toBe(false);
    }
  });
});

describe("layout validation", () => {
  const size = BATTLE_SIZES.strikeForce;
  const bad = (pieces: TerrainLayout["pieces"], objectives: TerrainLayout["objectives"] = []): TerrainLayout => ({ id: "x", name: "X", size, pieces, objectives });

  it("catches a piece hanging off the table", () => {
    expect(layoutIssues(bad([box("edge", { x: 1, y: 22 }, 8, 4, 3)]))).toEqual(["edge: hangs off the table"]);
  });

  it("catches a floor above the roof", () => {
    const piece = terrain({ id: "odd", polygon: box("t", { x: 30, y: 22 }, 8, 6, 4).polygon, height: 4, floors: [0, 9] });
    expect(layoutIssues(bad([piece]))).toEqual(['odd: floor at 9" is outside the piece']);
  });

  it("catches two pieces sharing an id", () => {
    expect(layoutIssues(bad([box("same", { x: 20, y: 22 }, 4, 4, 3), box("same", { x: 40, y: 22 }, 4, 4, 3)]))).toEqual(["same: duplicate piece id"]);
  });

  it("catches a footprint that encloses nothing", () => {
    const flat = terrain({ id: "sliver", polygon: [{ x: 20, y: 20 }, { x: 28, y: 20 }, { x: 24, y: 20 }], height: 6 });
    expect(layoutIssues(bad([flat]))).toContain("sliver: footprint encloses no area");
  });

  it("catches two objectives sharing an id", () => {
    expect(layoutIssues(bad([], [{ id: "o1", at: { x: 20, y: 20 } }, { id: "o1", at: { x: 40, y: 20 } }]))).toContain("o1: duplicate objective id");
  });

  it("catches an objective inside a bunker or off the table", () => {
    const bunker = box("bunker", { x: 30, y: 22 }, 10, 8, 5, ["impassable"], [5]);
    expect(layoutIssues(bad([bunker], [{ id: "o1", at: { x: 30, y: 22 } }]))).toEqual(["o1: sits inside impassable terrain (bunker)"]);
    expect(layoutIssues(bad([], [{ id: "o2", at: { x: 99, y: 22 } }]))).toEqual(["o2: off the table"]);
  });
});
