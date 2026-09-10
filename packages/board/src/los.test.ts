import { describe, expect, it } from "vitest";
import {
  HEIGHT_SAMPLES_FINE,
  TerrainIndex,
  canSee,
  circleBase,
  coverFor,
  hiddenFrom,
  segmentHitsPrism,
  sight,
  terrain,
  unitSight,
  visibleFraction,
  type ModelHull,
  type TerrainTrait,
  type Vec2,
} from "./index";

const model = (x: number, y: number, z: number, height: number, baseMm = 32): ModelHull => ({ pos: { x, y, z }, facing: 0, foot: circleBase(baseMm), height });
const trooper = (x: number, y: number, z = 0) => model(x, y, z, 2);
const rhino = (x: number, y: number, z = 0) => model(x, y, z, 3.5, 80);

const rect = (minX: number, minY: number, maxX: number, maxY: number): Vec2[] => [
  { x: minX, y: minY },
  { x: maxX, y: minY },
  { x: maxX, y: maxY },
  { x: minX, y: maxY },
];

/** A wall across the middle of the firing lane: `x` in [4, 5], `y` in [-yHalf, yHalf]. */
const wall = (height: number, yHalf = 6, traits: TerrainTrait[] = ["obscuring"]) => terrain({ id: "wall", polygon: rect(4, -yHalf, 5, yHalf), height, traits });

const index = (...pieces: ReturnType<typeof terrain>[]) => new TerrainIndex(pieces);

describe("segment versus prism", () => {
  const block = terrain({ id: "block", polygon: rect(0, 0, 2, 2), height: 3 });

  it("hits a segment that passes through the solid", () => {
    expect(segmentHitsPrism({ x: -1, y: 1, z: 1 }, { x: 3, y: 1, z: 1 }, block)).toBe(true);
  });

  it("misses a segment that passes over the top", () => {
    expect(segmentHitsPrism({ x: -1, y: 1, z: 4 }, { x: 3, y: 1, z: 4 }, block)).toBe(false);
  });

  it("misses a segment that passes to one side", () => {
    expect(segmentHitsPrism({ x: -1, y: 5, z: 1 }, { x: 3, y: 5, z: 1 }, block)).toBe(false);
  });

  it("hits a segment that dives into the top", () => {
    expect(segmentHitsPrism({ x: -1, y: 1, z: 5 }, { x: 1, y: 1, z: 0 }, block)).toBe(true);
  });

  it("ignores a footprint with no height", () => {
    expect(segmentHitsPrism({ x: -1, y: 1, z: 0 }, { x: 3, y: 1, z: 0 }, terrain({ id: "flat", polygon: rect(0, 0, 2, 2), height: 0 }))).toBe(false);
  });
});

describe("true line of sight", () => {
  it("sees over a wall shorter than both models", () => {
    expect(canSee(trooper(0, 0), trooper(10, 0), index(wall(1.5)))).toBe(true);
  });

  it("is blocked by a wall taller than both models", () => {
    expect(canSee(trooper(0, 0), trooper(10, 0), index(wall(3)))).toBe(false);
  });

  it("lets a tall model be seen over a wall that hides an infantry model", () => {
    // The point of a 3D kernel: same wall, same shooter, different target height.
    const board = index(wall(3));
    expect(canSee(trooper(0, 0), trooper(10, 0), board)).toBe(false);
    expect(canSee(trooper(0, 0), model(10, 0, 0, 6, 100), board)).toBe(true);
  });

  it("lets a tall model see over a wall that blinds an infantry model", () => {
    const board = index(wall(3));
    expect(canSee(rhino(0, 0), trooper(10, 0), board)).toBe(false); // 3.5" tall, but the target is 2"
    expect(canSee(model(0, 0, 0, 6, 100), trooper(10, 0), board)).toBe(true);
  });

  it("is symmetric: if I can see you, you can see me", () => {
    const board = index(wall(3));
    const tall = model(10, 0, 0, 6, 100);
    expect(canSee(trooper(0, 0), tall, board)).toBe(canSee(tall, trooper(0, 0), board));
  });

  it("sees past the end of a wall, using the target's silhouette", () => {
    // The wall stops at y = 0.5; the target's near edge is hidden but its flank is not.
    expect(canSee(trooper(0, 0), trooper(10, 0), index(wall(4, 6)))).toBe(false);
    expect(canSee(trooper(0, 0), trooper(10, 0), index(terrain({ id: "wall", polygon: rect(4, -6, 5, 0.2), height: 4 })))).toBe(true);
  });

  it("sees out of the ruin it is standing in", () => {
    const ruin = terrain({ id: "ruin", polygon: rect(-2, -2, 2, 2), height: 6, traits: ["obscuring"], floors: [0, 3] });
    const board = index(ruin);
    expect(canSee(trooper(0, 0), trooper(10, 0), board)).toBe(true);
    // Raw geometry says otherwise; the exemption is what makes the answer right.
    expect(canSee(trooper(0, 0), trooper(10, 0), board, { selfExempt: false })).toBe(false);
  });

  it("sees from an upper floor over a wall that blocks the ground floor", () => {
    const board = index(wall(4));
    expect(canSee(trooper(0, 0, 0), trooper(10, 0), board)).toBe(false);
    expect(canSee(trooper(0, 0, 5), trooper(10, 0), board)).toBe(true); // one storey up
  });

  it("ignores terrain flagged transparent", () => {
    expect(canSee(trooper(0, 0), trooper(10, 0), index(wall(6, 6, ["transparent", "light-cover"])))).toBe(true);
  });

  it("names what blocked it", () => {
    const result = sight(trooper(0, 0), trooper(10, 0), index(wall(6)), { exhaustive: true });
    expect(result.visible).toBe(false);
    expect(result.blockers).toEqual(["wall"]);
    expect(result.rays.every((r) => r.blockedBy === "wall")).toBe(true);
  });

  it("stops at the first clear ray but tests them all when asked", () => {
    const open = index();
    expect(sight(trooper(0, 0), trooper(10, 0), open).tested).toBe(1);
    const all = sight(trooper(0, 0), trooper(10, 0), open, { exhaustive: true });
    expect(all.tested).toBe(144); // 4 lateral samples x 3 heights, both models
    expect(all.exposure).toBe(1);
  });

  it("reports partial exposure for a model that only sticks out above a wall", () => {
    // A 2.2" wall hides a 2" trooper outright, but a 3.5" Rhino's upper hull clears it.
    expect(sight(trooper(0, 0), trooper(10, 0), index(wall(2.2)), { exhaustive: true }).exposure).toBe(0);
    const result = sight(trooper(0, 0), rhino(10, 0), index(wall(2.2)), { exhaustive: true, heights: HEIGHT_SAMPLES_FINE });
    expect(result.visible).toBe(true);
    expect(result.exposure).toBeGreaterThan(0);
    expect(result.exposure).toBeLessThan(1);
  });

  it("respects the ray cap", () => {
    expect(sight(trooper(0, 0), trooper(10, 0), index(wall(6)), { exhaustive: true, maxRays: 10 }).tested).toBe(10);
  });
});

describe("unit-level visibility", () => {
  const board = index(terrain({ id: "wall", polygon: rect(4, -6, 5, 1), height: 4 }));
  const shooters = [trooper(0, 0), trooper(0, 2)];
  const targets = [trooper(10, -3), trooper(10, 3)];

  it("is true when any model sees any model", () => {
    expect(unitSight(shooters, targets, board)).toBe(true);
  });

  it("counts how much of the target unit is exposed", () => {
    // The wall covers y up to 1, so the model at y = -3 is hidden and the one at y = 3 is not.
    expect(visibleFraction(shooters, targets, board)).toBe(0.5);
    expect(visibleFraction(shooters, [], board)).toBe(0);
  });

  it("calls a unit hidden when nothing in range can see it", () => {
    const bunker = index(terrain({ id: "bunker", polygon: rect(4, -20, 5, 20), height: 8 }));
    expect(hiddenFrom([trooper(10, 0)], [trooper(0, 0)], bunker, 15)).toBe(true);
    expect(hiddenFrom([trooper(10, 0)], [trooper(0, 0)], index(), 15)).toBe(false);
    // Out of range: not "hidden from" anyone, because nobody is close enough to look.
    expect(hiddenFrom([trooper(40, 0)], [trooper(0, 0)], index(), 15)).toBe(true);
  });
});

describe("cover", () => {
  const crater = terrain({ id: "crater", polygon: rect(9, -2, 12, 2), height: 0.5, traits: ["light-cover", "transparent"] });
  const ruin = terrain({ id: "ruin", polygon: rect(4, -6, 5, 6), height: 1.5, traits: ["heavy-cover"] });

  it("grants cover to a model standing in a cover footprint", () => {
    const result = coverFor(trooper(10, 0), trooper(0, 0), index(crater));
    expect(result).toMatchObject({ level: "light", from: "crater", reason: "within" });
  });

  it("grants cover from an intervening footprint", () => {
    const result = coverFor(trooper(10, 0), trooper(0, 0), index(ruin));
    expect(result).toMatchObject({ level: "heavy", from: "ruin", reason: "intervening" });
  });

  it("gives nothing in the open", () => {
    expect(coverFor(trooper(10, 0), trooper(0, 0), index()).level).toBe("none");
    expect(coverFor(trooper(10, 0), trooper(0, 0), index(terrain({ id: "hill", polygon: rect(4, -6, 5, 6), height: 4 }))).level).toBe("none");
  });

  it("does not count a footprint the attacker is also standing in", () => {
    expect(coverFor(trooper(11, 0), trooper(10, 0), index(crater)).reason).toBe("within"); // the target's own footprint still counts
    const wide = terrain({ id: "wide", polygon: rect(-2, -6, 6, 6), height: 1.5, traits: ["heavy-cover"] });
    expect(coverFor(trooper(10, 0), trooper(0, 0), index(wide)).level).toBe("none"); // attacker is inside it
  });

  it("prefers heavy cover when both apply", () => {
    expect(coverFor(trooper(10, 0), trooper(0, 0), index(crater, ruin)).level).toBe("heavy");
  });
});
