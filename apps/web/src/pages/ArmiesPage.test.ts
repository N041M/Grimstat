import { describe, expect, it } from "vitest";
import { typedPointsLimit } from "./ArmiesPage";

describe("the Custom battle size's points field", () => {
  it("reads a whole number of points", () => {
    expect(typedPointsLimit("2000")).toBe(2000);
    expect(typedPointsLimit(" 1500 ")).toBe(1500);
    expect(typedPointsLimit("1")).toBe(1);
    expect(typedPointsLimit("1250.75")).toBe(1250);
  });

  // The field used to become 0 the moment it was cleared, and Create then built a 2000-point army
  // while the dialog still read 0. A typed minus sign built a one-point army.
  it("holds nothing while the field is empty or below a point", () => {
    expect(typedPointsLimit("")).toBeUndefined();
    expect(typedPointsLimit("   ")).toBeUndefined();
    expect(typedPointsLimit("0")).toBeUndefined();
    expect(typedPointsLimit("-5")).toBeUndefined();
    expect(typedPointsLimit("0.5")).toBeUndefined();
    expect(typedPointsLimit("two thousand")).toBeUndefined();
  });
});
