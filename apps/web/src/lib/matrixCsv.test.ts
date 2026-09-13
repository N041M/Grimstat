import { describe, expect, it } from "vitest";
import { csvEscape, csvLine, durabilityToCsv } from "./matrixCsv";

describe("csvEscape", () => {
  it("quotes a field carrying a comma, a quote or a line break", () => {
    expect(csvEscape("Bolt rifle")).toBe("Bolt rifle");
    expect(csvEscape("Plasma, overcharged")).toBe('"Plasma, overcharged"');
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""');
    expect(csvEscape("two\r\nlines")).toBe('"two\r\nlines"');
    expect(csvEscape(undefined)).toBe("");
  });

  it("writes a number as a number, so a negative one keeps its sign", () => {
    expect(csvEscape(-1)).toBe("-1");
    expect(csvEscape(-0.5)).toBe("-0.5");
    expect(csvEscape(0)).toBe("0");
    expect(csvEscape(Number.NaN)).toBe("");
    expect(csvEscape(Number.POSITIVE_INFINITY)).toBe("");
  });

  it("stops a spreadsheet reading a name as a formula", () => {
    expect(csvEscape("=1+1")).toBe("'=1+1");
    expect(csvEscape("+SUM(A1)")).toBe("'+SUM(A1)");
    expect(csvEscape("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvEscape("-2+3")).toBe("'-2+3");
  });

  it("still quotes a neutralised field that also needs quoting", () => {
    expect(csvEscape('=HYPERLINK("http://x","go")')).toBe('"\'=HYPERLINK(""http://x"",""go"")"');
  });

  it("leaves a trigger that is not the first character", () => {
    expect(csvEscape("Krak=missile")).toBe("Krak=missile");
    expect(csvEscape("Lascannon (-1 AP)")).toBe("Lascannon (-1 AP)");
  });
});

describe("csvLine", () => {
  it("joins escaped fields with commas", () => {
    expect(csvLine(["=A1", "Plasma, overcharged", 3, -1, undefined])).toBe("'=A1,\"Plasma, overcharged\",3,-1,");
  });
});

describe("durabilityToCsv", () => {
  it("neutralises a defender name that came in from a pasted list", () => {
    const csv = durabilityToCsv("=2+5+cmd|' /C calc'!A0", [{ archetype: "bolter-squad", expectedDamage: 4.5, pKill: 0.25, damageTakenPer100: 2, backend: "exact" }]);
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe("defender,attacker,expected_damage,p_kill,damage_taken_per_100pts");
    expect(lines[1]).toBe("'=2+5+cmd|' /C calc'!A0,bolter-squad,4.5,0.25,2");
  });
});
