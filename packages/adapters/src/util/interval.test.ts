import { describe, expect, it } from "vitest";
import { formatInterval, parseCopyRangeLabel, parseInterval } from "./interval";

describe("parseInterval", () => {
  it.each([
    ["[1,2]", { min: 1, max: 2 }],
    ["[3,)", { min: 3 }],
    ["[1,)", { min: 1 }],
    ["[1,1]", { min: 1, max: 1 }],
    [" [2, 4] ", { min: 2, max: 4 }],
    ["(1,3)", { min: 2, max: 2 }],
  ])("parses %s", (text, expected) => {
    expect(parseInterval(text)).toEqual(expected);
  });
  it("rejects garbage and inverted ranges", () => {
    expect(parseInterval("1-2")).toBeNull();
    expect(parseInterval("[3,2]")).toBeNull();
    expect(parseInterval("")).toBeNull();
  });
  it("round-trips through formatInterval", () => {
    expect(formatInterval({ min: 1 })).toBe("[1,)");
    expect(formatInterval({ min: 1, max: 2 })).toBe("[1,2]");
    expect(parseInterval(formatInterval({ min: 3, max: 5 }))).toEqual({ min: 3, max: 5 });
  });
});

describe("parseCopyRangeLabel", () => {
  it.each([
    ["Your Unit Costs", { min: 1 }],
    ["YOUR UNIT COSTS", { min: 1 }],
    ["Your 1st Unit Costs", { min: 1, max: 1 }],
    ["Your 2nd + Unit Costs", { min: 2 }],
    ["YOUR 3RD + UNIT COSTS", { min: 3 }],
    ["Your 1st To 2nd Units Cost", { min: 1, max: 2 }],
    ["YOUR 1ST TO 3RD UNITS COST", { min: 1, max: 3 }],
    ["Your first to second units cost", { min: 1, max: 2 }],
  ])("parses %s", (label, expected) => {
    expect(parseCopyRangeLabel(label)).toEqual(expected);
  });
  it("returns null for unknown headings", () => {
    expect(parseCopyRangeLabel("WARGEAR OPTIONS")).toBeNull();
    expect(parseCopyRangeLabel("Assigned Agent")).toBeNull();
  });
});
