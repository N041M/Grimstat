import { describe, expect, it } from "vitest";
import {
  BREACHERS,
  CLIMBERS,
  MAX_CHARGE,
  RUINED_CITY,
  TerrainIndex,
  canStand,
  chargeGeometry,
  circleBase,
  containsPoint,
  ovalBase,
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

describe("straight moves", () => {
  const open = index();
  const length = (path: readonly { x: number; y: number }[]): number => path.reduce((sum, p, i) => (i ? sum + Math.hypot(p.x - path[i - 1]!.x, p.y - path[i - 1]!.y) : 0), 0);

  it("cost the distance between the two points in any direction on open ground", () => {
    const reach = reachable(model(0, 0), 6, open);
    for (const n of reach.nodes) expect(n.cost).toBeCloseTo(Math.hypot(n.at.x, n.at.y), 9);
    // Eight-way steps charge 5.8" at 22.5 degrees as 6.28". A 6" move reaches it.
    const a = (22.5 * Math.PI) / 180;
    const far = reach.firstWithin({ x: 5.8 * Math.cos(a), y: 5.8 * Math.sin(a) }, (0.5 * Math.SQRT2) / 2);
    expect(far).toBeDefined();
    expect(reach.nodes[far!]!.cost).toBeLessThanOrEqual(6);
    expect(reach.firstWithin({ x: 6.3 * Math.cos(a), y: 6.3 * Math.sin(a) }, 0.2)).toBeUndefined();
  });

  it("still pay for the way round something in the way, and never go through it", () => {
    const wall = terrain({ id: "wall", polygon: rect(3, -3, 3.1, 3), height: 5, traits: ["impassable"] });
    const reach = reachable(model(0, 0), 12, index(wall));
    const target = reach.find({ x: 6, y: 0 })!;
    // Round the end of the wall: out to beyond y = 3 and back, well over six inches.
    expect(reach.nodes[target]!.cost).toBeGreaterThan(2 * Math.hypot(3, 3.6) - 0.5);
    for (const n of reach.nodes) {
      const path = reach.pathTo(reach.nodes.indexOf(n));
      expect(n.cost).toBeGreaterThanOrEqual(Math.hypot(n.at.x, n.at.y) - 1e-9);
      expect(n.cost).toBeCloseTo(length(path), 6);
      for (let i = 1; i < path.length; i++) expect(segPolygonDistance({ a: path[i - 1]!, b: path[i]! }, wall.polygon)).toBeGreaterThan(0.5);
    }
  });

  it("keep to the lattice's steps where a climb is involved", () => {
    const ruin = index(terrain({ id: "ruin", polygon: rect(2, -4, 8, 4), height: 9, traits: ["obscuring", "scalable"], floors: [0, 4.5] }));
    const reach = reachable(model(0, 0), 12, ruin);
    const up = reach.find({ x: 5, y: 1 }, 4.5)!;
    const path = reach.pathTo(up);
    // The climb is charged once, on the step that rises, and every run along the path is level.
    expect(reach.nodes[up]!.cost).toBeCloseTo(Math.hypot(5, 1) + 4.5, 0);
    for (let i = 1; i < path.length; i++) {
      const rise = Math.abs(path[i]!.z - path[i - 1]!.z);
      if (rise > 0) expect(Math.hypot(path[i]!.x - path[i - 1]!.x, path[i]!.y - path[i - 1]!.y)).toBeLessThanOrEqual(0.5 * Math.SQRT2 + 1e-9);
    }
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

  it("climbs onto a scalable piece's roof, which is a surface like any storey", () => {
    // A Ruined City ruin: 9" tall with storeys at 0" and 4", so its roof is five inches above the
    // highest floor the piece lists.
    const a1 = RUINED_CITY.pieces.find((p) => p.id === "a1")!;
    expect(a1.height).toBe(9);
    expect(a1.floors).toEqual([0, 4]);
    const idx = index(a1);
    const climber = { keywords: [...CLIMBERS] };
    expect(canStand(model(11, 33, 9), { x: 11, y: 33, z: 9 }, idx, climber)).toBe(true);
    // And the search settles on that height too, so the roof a player sees drawn is one the move
    // can be sent to.
    const reach = reachable(model(4, 33), 30, idx, climber);
    const heights = new Set(reach.nodes.filter((n) => containsPoint(a1, n.at)).map((n) => n.at.z));
    expect([...heights].sort((a, b) => a - b)).toEqual([0, 4, 9]);
  });

  it("offers no roof on a piece that cannot be scaled", () => {
    // Two floors make a staircase to the first floor; without `scalable` the top is still nowhere.
    const sheer = index(terrain({ id: "sheer", polygon: rect(2, -4, 8, 4), height: 9, floors: [0, 4.5] }));
    expect(costTo(reachable(model(0, 0), 24, sheer), 5, 0, 4.5)).toBeDefined();
    expect(costTo(reachable(model(0, 0), 24, sheer), 5, 0, 9)).toBeUndefined();
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

describe("standing an oval base beside terrain", () => {
  // A 120 x 92 mm tank: 1.811" across the base, 0.551" of extra length each way, and an enclosing
  // circle of 2.362". The 0.551" between the last two is the ground the enclosing circle refuses it.
  const walled = index(terrain({ id: "wall", polygon: rect(2, -10, 12, 10), height: 6, traits: ["impassable"] }));
  const tank = (gap: number, facing: number): ModelHull => ({ pos: { x: 2 - gap, y: 0, z: 0 }, facing, foot: ovalBase(120, 92), height: 3.5 });
  const stands = (gap: number, facing: number): boolean => canStand(tank(gap, facing), tank(gap, facing).pos, walled);
  /** Long axis along the wall, so the base reaches only its half-width towards it. */
  const BROADSIDE = Math.PI / 2;

  it("measures the base rather than the circle that encloses it", () => {
    expect(stands(2.5, BROADSIDE)).toBe(true);
    expect(stands(2.2, BROADSIDE)).toBe(true); // 0.39" of clearance, and refused before the footprint test
    expect(stands(2.0, BROADSIDE)).toBe(true); // 0.19" of clearance
    expect(stands(1.8, BROADSIDE)).toBe(false); // inside the 1.811" half-width: the base is in the wall
  });

  it("takes the facing into account", () => {
    expect(stands(2.0, BROADSIDE)).toBe(true);
    expect(stands(2.0, 0)).toBe(false); // nose-on the base reaches 2.362" and does overlap
  });

  it("allows an oval the ground a circle of the same width is allowed", () => {
    const round: ModelHull = { ...tank(2.0, 0), foot: circleBase(92) };
    expect(canStand(round, round.pos, walled)).toBe(true);
  });
});

describe("something to stand on", () => {
  it("refuses a position with nothing underneath it", () => {
    expect(canStand(model(30, 22, 20), { x: 30, y: 22, z: 20 }, index())).toBe(false);
    expect(canStand(model(30, 22), { x: 30, y: 22, z: 0 }, index())).toBe(true);
  });

  it("offers a storey only where the storey is", () => {
    const ruin = index(terrain({ id: "ruin", polygon: rect(4, -4, 10, 4), height: 12, traits: ["scalable"], floors: [0, 4.5, 9] }));
    expect(canStand(model(7, 0, 4.5), { x: 7, y: 0, z: 4.5 }, ruin)).toBe(true);
    expect(canStand(model(11, 0, 4.5), { x: 11, y: 0, z: 4.5 }, ruin)).toBe(false); // a foot past the wall
    expect(canStand(model(7, 0, 6), { x: 7, y: 0, z: 6 }, ruin)).toBe(false); // between two storeys
  });

  it("keeps a charge from running off the edge of an upper floor", () => {
    // A twelve-inch ruin with storeys at 0, 4.5 and 9. The charger stands on the first floor half an
    // inch inside its wall; the target is on the ground three inches beyond it.
    const ruin = index(terrain({ id: "ruin", polygon: rect(4, -4, 10, 4), height: 12, traits: ["scalable", "obscuring"], floors: [0, 4.5, 9] }));
    const result = chargeGeometry([model(9.5, 0, 4.5)], [model(13, 0, 0)], ruin);

    // Down the storey and then the run in, which is 5.74". A dash straight out of the window at the
    // floor's own height measures 1.24" and needs a 2 on 2D6.
    expect(result.distance).toBeCloseTo(5.74, 2);
    expect(result.minimumRoll).toBe(6);
    expect(result.path.some((p) => p.z === 0)).toBe(true);
    for (const at of result.path) expect(canStand(model(at.x, at.y, at.z), at, ruin)).toBe(true);
  });
});

describe("canStand and reachable answer alike", () => {
  it("keeps a model out of a low impassable piece it could never leave", () => {
    const bunker = terrain({ id: "bunker", polygon: rect(24, 2, 36, 10), height: 2, traits: ["impassable"] });
    const sealed = index(bunker);
    // Two inches is inside the step-over allowance, but the piece is impassable at any height.
    expect(canStand(model(30, 6), { x: 30, y: 6, z: 0 }, sealed)).toBe(false);
    expect(canStand(model(30, 6), { x: 30, y: 6, z: 0 }, index(terrain({ ...bunker, height: 2.01 })))).toBe(false);
    // The search says the same from outside: there is nothing to walk to in there.
    expect(reachable(model(20, 6), 12, sealed).nodes.filter((n) => containsPoint(bunker, n.at))).toEqual([]);
    // The keywords it lets through may stand in it.
    expect(canStand(model(30, 6), { x: 30, y: 6, z: 0 }, index(terrain({ ...bunker, passableBy: ["INFANTRY"] })), { keywords: ["INFANTRY"] })).toBe(true);
  });

  it("keeps a tank off a floor the terrain says only infantry may climb", () => {
    const board = index(terrain({ id: "ruin", polygon: rect(2, -4, 8, 4), height: 9, traits: ["scalable"], floors: [0, 4.5], climbableBy: ["INFANTRY"] }));
    const tank = model(5, 0, 4.5, 3.5, 100);
    expect(canStand(tank, tank.pos, board, { keywords: ["VEHICLE"] })).toBe(false);
    expect(reachable(model(0, 0, 0, 3.5, 100), 12, board, { keywords: ["VEHICLE"] }).nodes.some((n) => n.at.z > 0)).toBe(false);
    // Infantry may, and both answers say so.
    expect(canStand(model(5, 0, 4.5), { x: 5, y: 0, z: 4.5 }, board, { keywords: ["INFANTRY"] })).toBe(true);
    expect(costTo(reachable(model(0, 0), 12, board, { keywords: ["INFANTRY"] }), 5, 0, 4.5)).toBeDefined();
  });

  it("allows every position the search settles on", () => {
    const a1 = RUINED_CITY.pieces.find((p) => p.id === "a1")!;
    const idx = index(a1);
    const climber = { keywords: [...CLIMBERS] };
    const reach = reachable(model(4, 33), 24, idx, climber);
    expect(reach.nodes.length).toBeGreaterThan(100);
    for (const n of reach.nodes) expect(canStand(model(n.at.x, n.at.y, n.at.z), n.at, idx, climber)).toBe(true);
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

  it("measures the dash only to targets that could shorten the charge", () => {
    // Two ten-model squads with twelve inches between the front ranks. Each read of a target's
    // position is counted. The exact dash reads it about a hundred times, and the lower bound twice.
    let reads = 0;
    const counted = (x: number, y: number): ModelHull => {
      const pos = { x, y, z: 0 };
      return {
        get pos() {
          reads++;
          return pos;
        },
        facing: 0,
        foot: circleBase(32),
        height: 2,
      };
    };
    const chargers = Array.from({ length: 10 }, (_, i) => model(24 + (i % 5) * 1.9, 10 + Math.floor(i / 5) * 1.9));
    const targets = Array.from({ length: 10 }, (_, i) => counted(24 + (i % 5) * 1.9, 23.9 + Math.floor(i / 5) * 1.9));
    const result = chargeGeometry(chargers, targets, index(), { blockers: targets });
    // Twelve inches between the centres, less both bases and the inch of engagement range.
    expect(result.distance).toBeCloseTo(12 - 32 / 25.4 - 1, 2);
    expect(result.minimumRoll).toBe(10);
    // Measuring the dash to every target from every reached position reads them 5.6 million times.
    expect(reads).toBeLessThan(300_000);
  });
});

describe("the search's cost", () => {
  /** A 32 mm model that counts how often its position is read. */
  const counted = (x: number, y: number, z: number, tally: { n: number }): ModelHull => {
    const pos = { x, y, z };
    return {
      get pos() {
        tally.n++;
        return pos;
      },
      facing: 0,
      foot: circleBase(32),
      height: 2,
    };
  };

  it("measures only the models near each position it checks", () => {
    const tally = { n: 0 };
    // A crowd filling the whole search, a base and a half apart, hovering well above the table so
    // that none of it is ever in the way: the region is the open table's, and every check has to ask.
    const crowd: ModelHull[] = [];
    for (let x = -9; x <= 9; x += 1.5) for (let y = -9; y <= 9; y += 1.5) if (Math.hypot(x, y) <= 8.7) crowd.push(counted(x, y, 30, tally));
    const reach = reachable(model(0, 0), 6, index(), { blockers: crowd, enemies: crowd });
    const nodes = reach.nodes.length;
    expect(nodes).toBe(reachable(model(0, 0), 6, index()).nodes.length);
    // Each check measures the handful of models within reach of it. Measuring the whole crowd at
    // every check reads positions more than eight hundred times a node.
    expect(tally.n).toBeLessThan(200 * nodes);
  });

  it("looks a destination up without reading every node", () => {
    const small = reachable(model(0, 0), 6, index());
    const large = reachable(model(0, 0), 24, index());
    expect(large.nodes.length).toBeGreaterThan(15 * small.nodes.length);
    /** The quickest of three runs of 20,000 lookups within 4" of the start either way, in milliseconds. */
    const lookups = (reach: ReturnType<typeof reachable>): number => {
      let best = Infinity;
      for (let run = 0; run < 3; run++) {
        const started = performance.now();
        let found = 0;
        for (let i = 0; i < 10000; i++) {
          const at = { x: ((i * 7.13) % 8) - 4, y: ((i * 3.71) % 8) - 4 };
          if (reach.find(at) !== undefined) found++;
          if (reach.firstWithin(at, 0.36) !== undefined) found++;
        }
        expect(found).toBe(20000);
        best = Math.min(best, performance.now() - started);
      }
      return best;
    };
    // Sixteen times the nodes makes a scan of every node sixteen times as long. A lookup reads the
    // same few cells whatever the size of the search.
    expect(lookups(large)).toBeLessThan(4 * lookups(small));
  });
});

describe("looking a destination up in a finished search", () => {
  const ruins = index(ruin("r1", { x: 5, y: 2 }, 6, 4, 2), terrain({ id: "rock", polygon: rect(-4, -6, -2, 1), height: 5 }), terrain({ id: "low", polygon: rect(1, -5, 6, -4), height: 1.5 }));
  const crowd = [model(3, -2), model(-1, 4), model(8, -3)];

  it("finds the node a search told to stop there stops on", () => {
    const opts = { keywords: ["INFANTRY"], blockers: crowd, enemies: [model(-7, -7)] };
    const everywhere = reachable(model(0, 0), 9, ruins, opts);
    for (let i = 0; i < 300; i++) {
      const to = { x: ((i * 5.37) % 20) - 10, y: ((i * 2.91) % 20) - 10 };
      const stopped = reachable(model(0, 0), 9, ruins, { ...opts, until: (at) => Math.hypot(at.x - to.x, at.y - to.y) <= 0.3536 });
      const first = everywhere.firstWithin(to, 0.3536);
      if (stopped.stoppedAt === undefined) {
        expect(first).toBeUndefined();
        continue;
      }
      expect(first).toBeDefined();
      expect(everywhere.nodes[first!]).toEqual(stopped.nodes[stopped.stoppedAt]);
      expect(everywhere.pathTo(first!)).toEqual(stopped.pathTo(stopped.stoppedAt));
    }
  });

  it("hands every node over nearest first, then cheapest, then in the order found", () => {
    const reach = reachable(model(0, 0), 9, ruins, { keywords: ["INFANTRY"], blockers: crowd });
    for (const at of [{ x: 0.13, y: -0.21 }, { x: 6.4, y: 2.2 }, { x: -12, y: 15 }, { x: 3.25, y: 3.25 }]) {
      const order = [...reach.byDistance(at)];
      const gap = (i: number) => Math.hypot(reach.nodes[i]!.at.x - at.x, reach.nodes[i]!.at.y - at.y);
      const sorted = reach.nodes.map((_, i) => i).sort((a, b) => gap(a) - gap(b) || reach.nodes[a]!.cost - reach.nodes[b]!.cost || a - b);
      expect(order).toEqual(sorted);
    }
  });

  it("finds the cheapest node near a point, as a scan of every node does", () => {
    const reach = reachable(model(0, 0), 9, ruins, { keywords: ["INFANTRY"], blockers: crowd });
    for (let i = 0; i < 300; i++) {
      const at = { x: ((i * 5.37) % 20) - 10, y: ((i * 2.91) % 20) - 10 };
      for (const z of [undefined, 0, 4]) {
        let best: number | undefined;
        reach.nodes.forEach((n, k) => {
          if (Math.hypot(n.at.x - at.x, n.at.y - at.y) > 0.375) return;
          if (z !== undefined && Math.abs(n.at.z - z) > 0.1) return;
          if (best === undefined || n.cost < reach.nodes[best]!.cost) best = k;
        });
        expect(reach.find(at, z)).toBe(best);
      }
    }
  });
});
