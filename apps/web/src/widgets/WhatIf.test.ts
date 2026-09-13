import { describe, expect, it } from "vitest";
import { deltaDisplay } from "./WhatIf";

/*
 * The base and the variant are rolled from the same stream, so the two levels move together and the
 * difference between them is far tighter than either of them. Combining the two levels' own
 * intervals would put the delta at ±0.1 or worse and print it to whole numbers; measuring the delta
 * itself put it inside a tenth, which is where it is printed.
 */
describe("deltaDisplay", () => {
  it("prints a sampled delta to a tenth", () => {
    expect(deltaDisplay(1.2345, "mc")).toBe("+1.2");
    expect(deltaDisplay(-1.2345, "mc")).toBe("-1.2");
    expect(deltaDisplay(0.04, "mc")).toBe("+0.0");
  });

  it("prints an exact delta to two decimals, exactly as it always has", () => {
    expect(deltaDisplay(1.2345, "exact")).toBe("+1.23");
    expect(deltaDisplay(-1.2345, "exact")).toBe("-1.23");
  });

  it("gives a delta of nothing no sign", () => {
    expect(deltaDisplay(0, "mc")).toBe("0.0");
    expect(deltaDisplay(0, "exact")).toBe("0.00");
  });
});
