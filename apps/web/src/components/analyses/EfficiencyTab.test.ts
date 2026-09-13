import { describe, expect, it } from "vitest";
import type { EfficiencyRow } from "@grimstat/game-40k-11e";
import { perTargetHalfWidth, rankLabel, tieRanks } from "./EfficiencyTab";

const row = (unit: string, damagePer100: number, over: Partial<EfficiencyRow> = {}): EfficiencyRow => ({
  unit,
  damagePer100,
  perPoints: true,
  byTarget: {},
  pointsByTarget: {},
  backend: "exact",
  ...over,
});

/** A ranking's places as they would be printed, so a test can pin the whole column at once. */
const labels = (rows: EfficiencyRow[]): string[] =>
  tieRanks(
    rows,
    (r) => r.damagePer100,
    (r) => r.ciHalfWidth,
  ).map(rankLabel);

describe("tieRanks", () => {
  it("numbers a ranking of exact rows 1, 2, 3 as it always has", () => {
    expect(labels([row("a", 9.31), row("b", 9.3), row("c", 4.2)])).toEqual(["1", "2", "3"]);
  });

  it("shares a place between two exact rows only when they hold the very same figure", () => {
    expect(labels([row("a", 9.3), row("b", 9.3), row("c", 4.2)])).toEqual(["=1", "=1", "3"]);
  });

  it("shares a place wherever two sampled rows reach each other", () => {
    const rows = [row("a", 9.31, { backend: "mc", ciHalfWidth: 0.06 }), row("b", 9.3, { backend: "mc", ciHalfWidth: 0.06 }), row("c", 4.2, { backend: "mc", ciHalfWidth: 0.06 })];
    expect(labels(rows)).toEqual(["=1", "=1", "3"]);
  });

  it("counts the rows a place is held by, so the next place carries the right number", () => {
    const near = (v: number) => row(`u${v}`, v, { backend: "mc", ciHalfWidth: 0.06 });
    expect(labels([near(9.32), near(9.31), near(9.3), near(4.2), near(4.19)])).toEqual(["=1", "=1", "=1", "=4", "=4"]);
  });

  it("ends a place at the first row it can tell from the row holding it", () => {
    // Each row here is within reach of the one above it, but 9.3 and 9.2 are 0.10 apart with 0.06 of
    // reach between them, so they are separable. Holding one place for all three would say 9.2 might
    // be first, which this run can rule out. The place is measured against the row holding it.
    const near = (v: number) => row(`u${v}`, v, { backend: "mc", ciHalfWidth: 0.03 });
    expect(labels([near(9.3), near(9.25), near(9.2), near(4.2)])).toEqual(["=1", "=1", "3", "4"]);
  });

  it("keeps a place for every row that really is within reach of the one holding it", () => {
    // The same shape with enough reach to cover the whole run: 9.3 to 9.2 is 0.10 against 0.12.
    const near = (v: number) => row(`u${v}`, v, { backend: "mc", ciHalfWidth: 0.06 });
    expect(labels([near(9.3), near(9.25), near(9.2), near(4.2)])).toEqual(["=1", "=1", "=1", "4"]);
  });

  it("leaves an exact row standing on its own beside a sampled one it is clear of", () => {
    expect(labels([row("a", 9.3, { backend: "mc", ciHalfWidth: 0.02 }), row("b", 9.0), row("c", 8.99, { backend: "mc", ciHalfWidth: 0.02 })])).toEqual(["1", "=2", "=2"]);
  });

  it("has nothing to place in an empty ranking", () => {
    expect(labels([])).toEqual([]);
    expect(labels([row("a", 9.3)])).toEqual(["1"]);
  });
});

describe("perTargetHalfWidth", () => {
  /*
   * The row's interval is denominated per 100 points and the per-target cells are raw damage. Using
   * the row's figure on those cells without taking the scaling back off would decide a cell's
   * decimals from an interval five times its own size on a 500-point unit.
   */
  it("takes the per-100 scaling back off for a ranking priced per 100 points", () => {
    expect(perTargetHalfWidth(row("a", 2.4, { points: 250, ciHalfWidth: 0.08 }))).toBeCloseTo(0.2, 12);
  });

  it("leaves the interval alone when the ranking is on raw damage", () => {
    expect(perTargetHalfWidth(row("a", 6, { perPoints: false, points: 250, ciHalfWidth: 0.08 }))).toBe(0.08);
    expect(perTargetHalfWidth(row("a", 6, { ciHalfWidth: 0.08 }))).toBe(0.08);
  });

  it("has no interval to give for a row that was worked out exactly", () => {
    expect(perTargetHalfWidth(row("a", 6, { points: 250 }))).toBeUndefined();
  });
});
