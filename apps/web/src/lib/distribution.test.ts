import { describe, expect, it } from "vitest";
import { axisTick, barCount, damageBars, slainRows } from "./distribution";

describe("damageBars", () => {
  const pmf = [0.05, 0.1, 0.2, 0.3, 0.2, 0.1, 0.05];

  it("classifies bars inside the interquartile range as ink and the tails as dim", () => {
    const bars = damageBars(pmf, { p25: 2, p75: 4 });
    expect(bars.map((b) => b.inIqr)).toEqual([false, false, true, true, true, false, false]);
  });

  it("includes the percentile bounds themselves", () => {
    const bars = damageBars(pmf, { p25: 3, p75: 3 });
    expect(bars.filter((b) => b.inIqr).map((b) => b.value)).toEqual([3]);
  });

  it("normalises heights against the tallest bar", () => {
    const bars = damageBars(pmf, { p25: 0, p75: 0 });
    expect(bars[3]?.height).toBe(1);
    expect(bars[0]?.height).toBeCloseTo(0.05 / 0.3, 10);
    expect(bars.every((b) => b.height >= 0 && b.height <= 1)).toBe(true);
  });

  it("keeps a bar per integer value and never reorders them", () => {
    const bars = damageBars(pmf, { p25: 1, p75: 2 });
    expect(bars.map((b) => b.value)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(bars.map((b) => b.p)).toEqual(pmf);
  });

  it("survives an all-zero distribution", () => {
    const bars = damageBars([0, 0, 0], { p25: 0, p75: 0 });
    expect(bars.every((b) => b.height === 0)).toBe(true);
  });
});

describe("barCount", () => {
  it("trims a negligible tail", () => {
    const pmf = [0.5, 0.5, ...Array.from({ length: 40 }, () => 0.0000001)];
    expect(barCount(pmf, { minBars: 2 })).toBe(2);
  });

  it("keeps every value that carries visible mass", () => {
    const pmf = [0.2, 0.2, 0.2, 0.2, 0.2];
    expect(barCount(pmf, { minBars: 2 })).toBe(5);
  });

  it("pads a short distribution up to the minimum and caps a long one", () => {
    expect(barCount([1], { minBars: 8 })).toBe(1);
    expect(barCount([1, 0, 0, 0, 0, 0, 0, 0, 0, 0], { minBars: 8 })).toBe(8);
    expect(barCount(Array.from({ length: 200 }, () => 0.005), { maxBars: 61 })).toBe(61);
  });
});

describe("slainRows", () => {
  const pmf = [0.06, 0.22, 0.28, 0.31, 0.11, 0.02];

  it("marks the outcomes at the mode and leaves the rest de-emphasised", () => {
    expect(slainRows(pmf).map((r) => r.modal)).toEqual([false, false, true, true, false, false]);
  });

  it("scales bar widths against the most likely outcome", () => {
    const rows = slainRows(pmf);
    expect(rows[3]?.width).toBe(1);
    expect(rows[1]?.width).toBeCloseTo(0.22 / 0.31, 10);
  });

  it("keeps one row per model count and copes with an empty distribution", () => {
    expect(slainRows(pmf).map((r) => r.n)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(slainRows([0, 0])).toEqual([
      { n: 0, p: 0, width: 0, modal: false },
      { n: 1, p: 0, width: 0, modal: false },
    ]);
  });
});

describe("axisTick", () => {
  it("labels every fifth value", () => {
    expect([0, 1, 4, 5, 10, 13].map((v) => axisTick(v))).toEqual(["0", "", "", "5", "10", ""]);
  });
});
