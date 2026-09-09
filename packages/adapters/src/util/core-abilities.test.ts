import { describe, expect, it } from "vitest";
import { parseCoreAbility, parseCoreValue } from "./core-abilities";

describe("parseCoreAbility", () => {
  it.each([
    ["Feel No Pain 5+", { keyword: "FEEL NO PAIN", value: 5 }],
    ["FEEL NO PAIN 6+*", { keyword: "FEEL NO PAIN", value: 6, qualifier: "*" }],
    ['Scouts 6"', { keyword: "SCOUTS", value: 6 }],
    ["Deadly Demise D3", { keyword: "DEADLY DEMISE", value: "D3" }],
    ["Deadly Demise D6+3 (Szarekh model only)", { keyword: "DEADLY DEMISE", value: "D6+3", qualifier: "(Szarekh model only)" }],
    ["Deep Strike", { keyword: "DEEP STRIKE" }],
    ["Lone Operative", { keyword: "LONE OPERATIVE" }],
    ["Fights First", { keyword: "FIGHTS FIRST" }],
    ["Damaged: 1-4 wounds remaining", { keyword: "DAMAGED", value: "1-4" }],
    ["Firing Deck 12", { keyword: "FIRING DECK", value: 12 }],
    ["Leader", { keyword: "LEADER" }],
  ])("parses %s", (name, expected) => {
    expect(parseCoreAbility(name)).toEqual(expected);
  });
  it("returns null for datasheet abilities", () => {
    expect(parseCoreAbility("Rally the Line")).toBeNull();
    expect(parseCoreAbility("Stealthy Advance")).toBeNull();
    expect(parseCoreAbility("")).toBeNull();
  });
  it("parses values", () => {
    expect(parseCoreValue("5+")).toBe(5);
    expect(parseCoreValue("D6+2")).toBe("D6+2");
    expect(parseCoreValue("")).toBeUndefined();
    expect(parseCoreValue("weird")).toBe("weird");
  });
});
