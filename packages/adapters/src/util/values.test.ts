import { describe, expect, it } from "vitest";
import { parseAP, parseDice, parseInches, parseInt0, parseTargetNumber, parseWeaponRange } from "./values";

describe("value parsers", () => {
  it("parses target numbers", () => {
    expect(parseTargetNumber("3+")).toBe(3);
    expect(parseTargetNumber("4")).toBe(4);
    expect(parseTargetNumber("4*")).toBe(4);
    expect(parseTargetNumber("N/A")).toBeNull();
    expect(parseTargetNumber("-")).toBeNull();
    expect(parseTargetNumber("")).toBeNull();
  });
  it("parses inches and ranges", () => {
    expect(parseInches('24"')).toBe(24);
    expect(parseInches("6")).toBe(6);
    expect(parseWeaponRange("Melee")).toEqual({ kind: "melee", range: null });
    expect(parseWeaponRange('12"')).toEqual({ kind: "ranged", range: 12 });
  });
  it("parses AP as a magnitude", () => {
    expect(parseAP("-2")).toBe(2);
    expect(parseAP("0")).toBe(0);
    expect(parseAP("–1")).toBe(1);
    expect(parseAP("-")).toBeNull();
  });
  it("parses dice expressions", () => {
    expect(parseDice("3")).toBe(3);
    expect(parseDice("D6")).toBe("D6");
    expect(parseDice("d6+1")).toBe("D6+1");
    expect(parseDice("2D6")).toBe("2D6");
    expect(parseDice("D3 + 3")).toBe("D3+3");
    expect(parseDice("N/A")).toBeNull();
    expect(parseDice("x")).toBeNull();
    expect(parseInt0("5 ")).toBe(5);
  });
});
