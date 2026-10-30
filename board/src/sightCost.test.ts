import { describe, expect, it, vi } from "vitest";
import type * as Vec from "./vec";

// How often a line is traced through a footprint, counted. The real function still answers.
vi.mock("./vec", async (importOriginal) => {
  const actual = await importOriginal<typeof Vec>();
  return { ...actual, segInPolygonSpans: vi.fn(actual.segInPolygonSpans) };
});

import { TerrainIndex, circleBase, segInPolygonSpans, sight, terrain, type ModelHull, type Vec2 } from "./index";

const traced = vi.mocked(segInPolygonSpans);
const model = (x: number, y: number): ModelHull => ({ pos: { x, y, z: 0 }, facing: 0, foot: circleBase(32), height: 2 });
const rect = (a: number, b: number, c: number, d: number): Vec2[] => [{ x: a, y: b }, { x: c, y: b }, { x: c, y: d }, { x: a, y: d }];

describe("the cost of a sight line", () => {
  it("traces each line in plan once per piece it can reach, whatever the heights", () => {
    // A low bank and then an obscuring wall across the diagonal between the two models.
    const bank = terrain({ id: "bank", polygon: [{ x: 3, y: 7 }, { x: 7, y: 3 }, { x: 7.8, y: 3.8 }, { x: 3.8, y: 7.8 }], height: 1.5 });
    const wall = terrain({ id: "wall", polygon: [{ x: 8, y: 12 }, { x: 12, y: 8 }, { x: 13, y: 9 }, { x: 9, y: 13 }], height: 1, traits: ["obscuring"] });
    // Tall pieces inside the box the pair spans, but off every line between them.
    const aside = [terrain({ id: "a", polygon: rect(14, 1, 17, 4), height: 6 }), terrain({ id: "b", polygon: rect(1, 14, 4, 17), height: 6 })];
    const index = new TerrainIndex([bank, ...aside, wall]);
    traced.mockClear();
    const result = sight(model(0, 0), model(18, 18), index, { exhaustive: true });
    expect(result.tested).toBe(144);
    expect(result.clear).toBe(0);
    expect([...result.blockers].sort()).toEqual(["bank", "wall"]);
    // Four points on each model make sixteen lines, and two pieces lie across them. Tracing every
    // ray through every piece it was asked about took 224 traces.
    expect(traced.mock.calls.length).toBeLessThanOrEqual(32);
  });
});
