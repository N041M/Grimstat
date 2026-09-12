import { describe, expect, it } from "vitest";
import type { SimResult } from "@grimstat/schema";
import { csvFileName, resultToCsv } from "./resultCsv";

const result: SimResult = {
  backend: "exact",
  damagePMF: [0.5, 0.25, 0.25],
  slainPMF: [1],
  expectedDamage: 0.75,
  expectedSlain: 0,
  pKill: 0,
  pAtLeastSlain: [1],
  damagePercentiles: { p5: 0, p25: 0, p50: 0, p75: 1, p95: 2 },
  slainPercentiles: { p5: 0, p25: 0, p50: 0, p75: 0, p95: 0 },
  expectedWasted: 0,
  expectedSelfMortals: 0,
  weapons: [
    { name: "Bolt rifle", count: 5, expectedAttacks: 10, expectedHits: 6.6667, expectedWounds: 3.3333, expectedUnsaved: 1.1111, expectedDamage: 1.1111, trace: [] },
    { name: 'Plasma, "overcharged"', count: 1, expectedAttacks: 1, expectedHits: 0.5, expectedWounds: 0.25, expectedUnsaved: 0.2, expectedDamage: 0.4, trace: [] },
  ],
  coverage: { tier1: 0, tier2: 0, tier3: 0, unmodelled: [] },
  warnings: [],
};

describe("resultToCsv", () => {
  it("writes the weapon block, a blank line, then the distribution with both cumulative readings", () => {
    const lines = resultToCsv(result).split("\r\n");
    expect(lines[0]).toBe("weapon,count,expected_attacks,expected_hits,expected_wounds,expected_unsaved,expected_damage");
    expect(lines[1]).toBe("Bolt rifle,5,10,6.667,3.333,1.111,1.111");
    expect(lines[2]).toBe('"Plasma, ""overcharged""",1,1,0.5,0.25,0.2,0.4');
    expect(lines[3]).toBe("");
    expect(lines[4]).toBe("damage,probability,cumulative,at_least");
    expect(lines[5]).toBe("0,0.5,0.5,1");
    expect(lines[6]).toBe("1,0.25,0.75,0.5");
    expect(lines[7]).toBe("2,0.25,1,0.25");
    expect(lines[8]).toBe("");
    expect(lines).toHaveLength(9);
  });
});

describe("csvFileName", () => {
  it("slugs the scenario name and keeps letters of any script", () => {
    expect(csvFileName("Bolters into marines")).toBe("bolters-into-marines.csv");
    expect(csvFileName("  Útok / obrana!  ")).toBe("útok-obrana.csv");
    expect(csvFileName("")).toBe("scenario.csv");
  });
});
