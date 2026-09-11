import { describe, expect, it } from "vitest";
import {
  BREACHERS,
  MAX_CHARGE,
  TerrainIndex,
  canStand,
  chargeGeometry,
  circleBase,
  reachable,
  ruin,
  segPolygonDistance,
  terrain,
  type ModelHull,
  type Vec2,
} from "./index";

const model = (x: number, y: number, z = 0, height = 2, mm = 32): ModelHull => ({ pos: { x, y, z }, facing: 0, foot: circleBase(mm), height });
const rect = (a: number, b: number, c: number, d: number): Vec2[] => [{ x: a, y: b }, { x: c, y: b }, { x: c, y: d }, { x: a, y: d }];
const index = (...pieces: ReturnType<typeof terrain>[]) => new TerrainIndex(pieces);

/** Cheapest cost to stand at `(x, y)`, or undefined when the move cannot reach it. */
function costTo(result: ReturnType<typeof reachable>, x: number, y: number, z?: number): number | undefined {
  const i = result.find({ x, y }, z);
  return i === undefined ? undefined : result.nodes[i]!.cost;
}

describe("reachability on open ground", () => {
  const open = index();

  it("stops at the table's edge when told where the edge is", () => {
    const edge = reachable(model(2, 2), 6, open, { board: { width: 60, depth: 44 } });
    for (const n of edge.nodes) {
      expect(n.at.x).toBeGreaterThanOrEqual(0.63 - 1e-6);
      expect(n.at.y).toBeGreaterThanOrEqual(0.63 - 1e-6);
    }
    expect(costTo(edge, 1, 2)).toBeCloseTo(1, 1);
    expect(costTo(edge, 0, 2)).toBeUndefined();
    // Without a board there is no edge, which is what the kernel's own tests rely on.
    expect(costTo(reachable(model(2, 2), 6, open), -2, 2)).toBeDefined();
  });

  it("reaches straight ahead for the cost of the distance", () => {
    const reach = reachable(model(0, 0), 6, open);
    expect(costTo(reach, 5, 0)).toBeCloseTo(5, 1);
    expect(costTo(reach, 6, 0)).toBeCloseTo(6, 1);
  });

  it("stops at the edge of the budget", () => {
    const reach = reachable(model(0, 0), 6, open);
    expect(costTo(reach, 8, 0)).toBeUndefined();
    for (const n of reach.nodes) expect(n.cost).toBeLessThanOrEqual(6.0001);
  });

  it("costs a diagonal what a diagonal costs", () => {
    const reach = reachable(model(0, 0), 6, open);
    expect(costTo(reach, 3, 3)).toBeCloseTo(Math.hypot(3, 3), 1);
  });

  it("hands back a path that starts where the model stands", () => {
    const reach = reachable(model(0, 0), 6, open);
    const target = reach.find({ x: 4, y: 2 })!;
    const path = reach.pathTo(target);
    expect(path[0]).toEqual({ x: 0, y: 0, z: 0 });
    expect(path[path.length - 1]!.x).toBeCloseTo(4, 1);
  });
});

describe("reachability with terrain", () => {
  it("walks over terrain two inches or shorter without paying for it", () => {
    const lowWall = index(terrain({ id: "low", polygon: rect(2, -6, 3, 6), height: 1.5 }));
    expect(costTo(reachable(model(0, 0), 6, lowWall), 5, 0)).toBeCloseTo(5, 1);
  });

  it("goes around a solid block rather than through it", () => {
    const block = index(terrain({ id: "rock", polygon: rect(2, -3, 4, 3), height: 5 }));
    const reach = reachable(model(0, 0), 12, block);
    expect(costTo(reach, 3, 0)).toBeUndefined(); // inside the rock
    const around = costTo(reach, 6, 0);
    expect(around).toBeDefined();
    expect(around!).toBeGreaterThan(6.5); // the detour costs more than the six inches as the crow flies
  });

  it("walks into a ruin at ground level, because a ruin is hollow", () => {
    const ruin = index(terrain({ id: "ruin", polygon: rect(2, -4, 8, 4), height: 9, traits: ["obscuring"], floors: [0, 4.5] }));
    expect(costTo(reachable(model(0, 0), 6, ruin), 5, 0, 0)).toBeCloseTo(5, 1);
  });

  it("charges the climb to an upper floor against the move", () => {
    const ruin = index(terrain({ id: "ruin", polygon: rect(2, -4, 8, 4), height: 9, traits: ["obscuring", "scalable"], floors: [0, 4.5] }));
    const reach = reachable(model(0, 0), 12, ruin);
    const ground = costTo(reach, 5, 0, 0)!;
    const upstairs = costTo(reach, 5, 0, 4.5)!;
    expect(upstairs - ground).toBeCloseTo(4.5, 1); // the storey costs its height
  });

  it("will not climb what cannot be climbed", () => {
    const sheer = index(terrain({ id: "sheer", polygon: rect(2, -4, 8, 4), height: 9, floors: [0, 4.5] }));
    const noFloors = index(terrain({ id: "pillar", polygon: rect(2, -4, 8, 4), height: 9, traits: ["scalable"], floors: [9] }));
    // Two floors are a staircase; a single roof with no way up is not.
    expect(costTo(reachable(model(0, 0), 12, sheer), 5, 0, 4.5)).toBeDefined();
    expect(costTo(reachable(model(0, 0), 12, noFloors), 5, 0, 9)).toBeUndefined();
  });

  it("keeps off an upper floor when the terrain says who may climb it", () => {
    const ruin = index(terrain({ id: "ruin", polygon: rect(2, -4, 8, 4), height: 9, traits: ["scalable"], floors: [0, 4.5], climbableBy: ["INFANTRY"] }));
    expect(costTo(reachable(model(0, 0), 12, ruin, { keywords: ["INFANTRY"] }), 5, 0, 4.5)).toBeDefined();
    expect(costTo(reachable(model(0, 0), 12, ruin, { keywords: ["VEHICLE"] }), 5, 0, 4.5)).toBeUndefined();
    // Without breachable walls the ground floor is open to anyone, tank included.
    expect(costTo(reachable(model(0, 0), 12, ruin, { keywords: ["VEHICLE"] }), 5, 0, 0)).toBeCloseTo(5, 1);
  });

  it("keeps a tank out of a ruin's walls and lets those who may breach them through", () => {
    // A real ruin: the footprint is the walls, and only the listed keywords pass them.
    const walls = ruin("r", { x: 6, y: 0 }, 8, 8, 2);
    const idx = index(walls);
    const tank = model(0, 0, 0, 3.5, 100);
    const trooper = model(0, 0);
    expect(walls.passableBy).toEqual([...BREACHERS]);

    const tankReach = reachable(tank, 12, idx, { keywords: ["VEHICLE"] });
    expect(costTo(tankReach, 6, 0, 0)).toBeUndefined();
    // Not inside, and not overlapping the wall either: the base stays clear of the footprint.
    for (const n of tankReach.nodes) expect(segPolygonDistance({ a: n.at, b: n.at }, walls.polygon)).toBeGreaterThanOrEqual(tank.foot.r - 1e-6);
    expect(canStand(tank, { x: 6, y: 0, z: 0 }, idx, { keywords: ["VEHICLE"] })).toBe(false);
    // A flyer crosses the walls; so does infantry, who may also go upstairs.
    expect(costTo(reachable(model(0, 0, 0, 3.5, 100), 12, idx, { keywords: ["VEHICLE", "FLY"] }), 6, 0, 0)).toBeCloseTo(6, 1);
    expect(costTo(reachable(trooper, 12, idx, { keywords: ["INFANTRY"] }), 6, 0, 0)).toBeCloseTo(6, 1);
    expect(costTo(reachable(trooper, 12, idx, { keywords: ["INFANTRY"] }), 6, 0, 4)).toBeDefined();
    // The tank gets round: the far side is reachable, just not through the middle, and it costs
    // the detour rather than the fourteen inches a straight line would.
    const detour = costTo(reachable(tank, 26, idx, { keywords: ["VEHICLE"] }), 14, 0, 0);
    expect(detour).toBeDefined();
    expect(detour!).toBeGreaterThan(16);
  });

  it("lets anyone climb when the terrain names nobody", () => {
    const ruin = index(terrain({ id: "ruin", polygon: rect(2, -4, 8, 4), height: 9, traits: ["scalable"], floors: [0, 4.5] }));
    expect(costTo(reachable(model(0, 0), 12, ruin, { keywords: ["VEHICLE"] }), 5, 0, 4.5)).toBeDefined();
  });

  it("stands on a hill top but not inside the hill", () => {
    const hill = index(terrain({ id: "hill", polygon: rect(2, -4, 8, 4), height: 1.8, floors: [1.8] }));
    const reach = reachable(model(0, 0), 8, hill);
    expect(costTo(reach, 5, 0, 0)).toBeCloseTo(5, 1); // 1.8" is inside the step-over allowance
    expect(costTo(reach, 5, 0, 1.8)).toBeCloseTo(5, 1);
  });

  it("keeps impassable terrain impassable, except for those it lets through", () => {
    const walls = terrain({ id: "walls", polygon: rect(2, -4, 4, 4), height: 6, traits: ["impassable"], passableBy: ["INFANTRY"], floors: [0] });
    expect(costTo(reachable(model(0, 0), 10, index(walls)), 3, 0, 0)).toBeUndefined();
    expect(costTo(reachable(model(0, 0), 10, index(walls), { keywords: ["INFANTRY"] }), 3, 0, 0)).toBeCloseTo(3, 1);
  });

  it("charges extra for difficult ground when the edition says to", () => {
    const mire = index(terrain({ id: "mire", polygon: rect(-6, -6, 6, 6), height: 0.2, traits: ["difficult"] }));
    const normal = costTo(reachable(model(0, 0), 12, mire), 5, 0)!;
    const slowed = costTo(reachable(model(0, 0), 12, mire, { rules: { difficultMultiplier: 2 } }), 5, 0)!;
    expect(normal).toBeCloseTo(5, 1);
    expect(slowed).toBeCloseTo(10, 1);
  });
});

describe("reachability around other models", () => {
  it("will not end a normal move within engagement range of an enemy", () => {
    const enemy = model(6, 0);
    const reach = reachable(model(0, 0), 8, index(), { enemies: [enemy] });
    expect(costTo(reach, 3, 0)).toBeCloseTo(3, 1);
    expect(costTo(reach, 4.5, 0)).toBeUndefined(); // inside the enemy's 1" bubble
  });

  it("lets a charge close to engagement range", () => {
    const enemy = model(6, 0);
    const reach = reachable(model(0, 0), 8, index(), { enemies: [enemy], allowEngagement: true });
    expect(costTo(reach, 4.5, 0)).toBeDefined();
  });

  it("does not move through another model's base", () => {
    const friend = model(3, 0, 0, 2, 100); // a big base square in the way
    const reach = reachable(model(0, 0), 8, index(), { blockers: [friend] });
    expect(costTo(reach, 3, 0)).toBeUndefined();
    expect(costTo(reach, 3, 4)).toBeDefined(); // past its flank
  });
});

describe("stopping early", () => {
  it("settles nodes in cost order and stops on the first that satisfies `until`", () => {
    const reach = reachable(model(0, 0), 12, index(), { until: (at) => at.x >= 4 });
    expect(reach.stoppedAt).toBeDefined();
    const stop = reach.nodes[reach.stoppedAt!]!;
    expect(stop.at.x).toBeGreaterThanOrEqual(4);
    expect(stop.cost).toBeCloseTo(4, 1); // not a step further than it had to go
    // The search stopped rather than filling the whole 12" disc.
    expect(reach.nodes.length).toBeLessThan(reachable(model(0, 0), 12, index()).nodes.length);
  });

  it("stops on the starting position when that already satisfies the condition", () => {
    const reach = reachable(model(5, 5), 6, index(), { until: (at) => Math.hypot(at.x - 5, at.y - 5) < 0.1 });
    expect(reach.stoppedAt).toBe(0);
    expect(reach.nodes[0]!.cost).toBe(0);
  });

  it("leaves `stoppedAt` unset when the condition is never met", () => {
    expect(reachable(model(0, 0), 6, index(), { until: (at) => at.x > 100 }).stoppedAt).toBeUndefined();
  });
});

describe("charge geometry", () => {
  it("needs the distance to engagement range, rounded up", () => {
    // Bases 0.63" in radius: 8" between centres is 6.74" of gap, less the 1" engagement range.
    const result = chargeGeometry([model(0, 0)], [model(8, 0)], index());
    expect(result.distance).toBeCloseTo(5.74, 1);
    expect(result.minimumRoll).toBe(6);
    expect(result.model).toBe(0);
    expect(result.path.length).toBeGreaterThan(1);
  });

  it("charges from whichever model is closest", () => {
    // From x = 4 the gap is 4.74"; one inch of that is engagement range, so 3.74" of travel.
    const result = chargeGeometry([model(0, 0), model(4, 0)], [model(10, 0)], index());
    expect(result.model).toBe(1);
    expect(result.distance).toBeCloseTo(3.74, 2);
    expect(result.minimumRoll).toBe(4);
  });

  it("lengthens a charge that has to go round a building", () => {
    const block = index(terrain({ id: "block", polygon: rect(3, -4, 6, 4), height: 8 }));
    const open = chargeGeometry([model(0, 0)], [model(9, 0)], index());
    const blocked = chargeGeometry([model(0, 0)], [model(9, 0)], block);
    expect(blocked.distance).toBeGreaterThan(open.distance + 1.5);
  });

  it("reports an impossible charge rather than guessing at one", () => {
    const result = chargeGeometry([model(0, 0)], [model(40, 0)], index());
    expect(result.distance).toBe(Infinity);
    expect(result.minimumRoll).toBe(Infinity);
    expect(result.model).toBeUndefined();
    expect(MAX_CHARGE).toBe(12);
  });

  it("never asks for less than the two dice can roll", () => {
    expect(chargeGeometry([model(0, 0)], [model(2, 0)], index()).minimumRoll).toBe(2);
  });

  it("reaches a first floor from the ground, because engagement range is five inches up", () => {
    const ruin = index(terrain({ id: "ruin", polygon: rect(4, -4, 10, 4), height: 12, traits: ["scalable"], floors: [0, 4.5, 9] }));
    const ground = chargeGeometry([model(0, 0)], [model(7, 0, 0)], ruin);
    const firstFloor = chargeGeometry([model(0, 0)], [model(7, 0, 4.5)], ruin);
    // A model at 4.5" is 2.5" above the charger's head: inside the vertical half of engagement range.
    expect(firstFloor.distance).toBeCloseTo(ground.distance, 2);
  });

  it("makes the charger climb to reach a model too high to engage from below", () => {
    const ruin = index(terrain({ id: "ruin", polygon: rect(4, -4, 10, 4), height: 12, traits: ["scalable"], floors: [0, 4.5, 9] }));
    const ground = chargeGeometry([model(0, 0)], [model(7, 0, 0)], ruin);
    const topFloor = chargeGeometry([model(0, 0)], [model(7, 0, 9)], ruin);
    expect(topFloor.distance).toBeGreaterThan(ground.distance + 4); // it has to go up a storey first
    expect(topFloor.path.some((p) => p.z > 4)).toBe(true);
  });
});
