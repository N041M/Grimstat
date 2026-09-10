import { describe, expect, it } from "vitest";
import { pointsBarModel } from "./pointsBar";

describe("pointsBarModel", () => {
  it("groups by section in bar order and tones the ramp", () => {
    const m = pointsBarModel(
      [
        { section: "character", points: 95 },
        { section: "battleline", points: 195 },
        { section: "battleline", points: 170 },
        { section: "transport", points: 80 },
        { section: "other", points: 160 },
      ],
      1000,
    );
    expect(m.segments.map((s) => s.section)).toEqual(["battleline", "other", "transport", "character"]);
    expect(m.segments.map((s) => s.tone)).toEqual(["ink", "mid", "mid", "dim"]);
    expect(m.segments[0]!.points).toBe(365);
    expect(m.segments[0]!.fraction).toBeCloseTo(0.365);
    expect(m.total).toBe(700);
    expect(m.spare).toBe(300);
    expect(m.over).toBe(0);
  });

  it("drops empty sections so the track carries no zero-width segments", () => {
    const m = pointsBarModel([{ section: "battleline", points: 200 }], 2000);
    expect(m.segments).toHaveLength(1);
    expect(m.segments[0]!.fraction).toBeCloseTo(0.1);
  });

  it("fills the track and reports the overage when the army is over its limit", () => {
    const m = pointsBarModel(
      [
        { section: "battleline", points: 600 },
        { section: "character", points: 600 },
      ],
      1000,
    );
    expect(m.total).toBe(1200);
    expect(m.over).toBe(200);
    expect(m.spare).toBe(0);
    expect(m.segments.reduce((s, x) => s + x.fraction, 0)).toBeCloseTo(1);
    expect(m.segments[0]!.fraction).toBeCloseTo(0.5);
  });

  it("survives a zero limit, an empty army and non-finite costs", () => {
    expect(pointsBarModel([], 2000)).toEqual({ segments: [], total: 0, limit: 2000, spare: 2000, over: 0 });
    const zero = pointsBarModel([{ section: "battleline", points: 100 }], 0);
    expect(zero.segments[0]!.fraction).toBeCloseTo(1);
    expect(zero.over).toBe(100);
    const nan = pointsBarModel([{ section: "battleline", points: Number.NaN }], 100);
    expect(nan.total).toBe(0);
    expect(nan.segments).toEqual([]);
  });
});
