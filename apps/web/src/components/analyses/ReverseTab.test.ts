import { describe, expect, it } from "vitest";
import { archetypes } from "@grimstat/game-40k-11e";
import type { ReverseRow } from "../../lib/gameExtras";
import { rankLabel, tieRanks } from "./EfficiencyTab";
import { metricDisplay, reverseFingerprint, reverseRan, rowHalfWidth, type ReverseRun } from "./ReverseTab";

const target = archetypes[0]!.unit;
const candidate = archetypes[1]!.unit;

const makeRun = (over: Partial<ReverseRun> = {}): ReverseRun => ({
  target,
  candidates: [{ id: "c1", unit: candidate }],
  metric: "pKill",
  threshold: 0.8,
  context: { rangeBand: "half", phase: "shooting", inCover: false, charged: false },
  maxCombo: 2,
  enabledToggles: [],
  ...over,
});

describe("reverseRan", () => {
  /*
   * The tab used to hold the target, the candidates and the metric in its own state, which a tab
   * switch threw away while the stored result stayed. The header then called the result current and
   * the body offered to run it.
   */
  it("reads the run back from the arguments the result was computed with", () => {
    const run = makeRun();
    expect(reverseRan([run, undefined])).toBe(run);
  });

  it("has nothing to report before a run", () => {
    expect(reverseRan(undefined)).toBeUndefined();
  });
});

describe("reverseFingerprint", () => {
  it("tells one set of settings from another", () => {
    const fp = reverseFingerprint(makeRun());
    expect(fp).toBe(reverseFingerprint(makeRun()));
    expect(fp).not.toBe(reverseFingerprint(makeRun({ metric: "expectedDamage" })));
    expect(fp).not.toBe(reverseFingerprint(makeRun({ threshold: 0.5 })));
    expect(fp).not.toBe(reverseFingerprint(makeRun({ maxCombo: 3 })));
    expect(fp).not.toBe(reverseFingerprint(makeRun({ candidates: [] })));
    expect(fp).not.toBe(reverseFingerprint(makeRun({ target: candidate })));
    expect(fp).not.toBe(reverseFingerprint(makeRun({ context: { rangeBand: "full", phase: "shooting", inCover: false, charged: false } })));
  });

  it("is empty before a run, so nothing is marked as no longer matching", () => {
    expect(reverseFingerprint(undefined)).toBe("");
  });
});

const makeRow = (over: Partial<ReverseRow> = {}): ReverseRow => ({
  candidateIds: ["c1"],
  names: ["Bolter squad"],
  points: 100,
  priced: true,
  value: 4.266,
  meets: true,
  expectedDamage: 4.266,
  expectedSlain: 2.133,
  pKill: 0.42,
  backend: "exact",
  ...over,
});

describe("metricDisplay", () => {
  it("prints a sampled damage figure only to the place the run can tell apart", () => {
    expect(metricDisplay("expectedDamage", 4.266, 0.05)).toBe("4.3");
    expect(metricDisplay("expectedDamage", 4.266, 0.005)).toBe("4.27");
  });

  it("prints an exact damage figure exactly as it always has", () => {
    expect(metricDisplay("expectedDamage", 4.266)).toBe("4.27");
  });

  /* The engine quotes an interval on expected damage alone, so nothing else moves. */
  it("leaves a model count and a kill chance alone, interval or no interval", () => {
    expect(metricDisplay("expectedSlain", 2.133, 0.5)).toBe("2.13");
    expect(metricDisplay("pKill", 0.4266, 0.5)).toBe("42.7%");
  });
});

describe("rowHalfWidth", () => {
  it("reads the interval only when the ranking is by expected damage", () => {
    const row = makeRow({ backend: "mc", ciHalfWidth: 0.05 });
    expect(rowHalfWidth(row, "expectedDamage")).toBe(0.05);
    expect(rowHalfWidth(row, "pKill")).toBeUndefined();
    expect(rowHalfWidth(row, "expectedSlain")).toBeUndefined();
  });
});

describe("the places a reverse ranking shows", () => {
  const places = (rows: ReverseRow[], metric: ReverseRun["metric"]) =>
    tieRanks(
      rows,
      (r) => r.value,
      (r) => rowHalfWidth(r, metric),
    ).map(rankLabel);

  it("shares a place between two rows a sampled run cannot separate", () => {
    const rows = [makeRow({ candidateIds: ["a"], value: 9.31, backend: "mc", ciHalfWidth: 0.06 }), makeRow({ candidateIds: ["b"], value: 9.3, backend: "mc", ciHalfWidth: 0.06 }), makeRow({ candidateIds: ["c"], value: 4.2, backend: "mc", ciHalfWidth: 0.06 })];
    expect(places(rows, "expectedDamage")).toEqual(["=1", "=1", "3"]);
  });

  /* The engine quotes no interval for a kill chance, so there is nothing to call a tie on. */
  it("marks nothing when the ranking is by a kill chance", () => {
    const rows = [makeRow({ candidateIds: ["a"], value: 0.81, backend: "mc", ciHalfWidth: 0.06 }), makeRow({ candidateIds: ["b"], value: 0.8, backend: "mc", ciHalfWidth: 0.06 })];
    expect(places(rows, "pKill")).toEqual(["1", "2"]);
  });
});
