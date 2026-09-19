import { describe, expect, it } from "vitest";
import type { Roster, RosterUnit } from "@grimstat/schema";
import { halvesOf, headOf, isSplit, mergeModelGroups, wholeModelsOf } from "./halves";

const unit = (id: string, count: number, over: Partial<RosterUnit> = {}): RosterUnit => ({ id, datasheetId: "squad", models: [{ modelProfileId: "m", count, wargear: [] }], isWarlord: false, ...over });
const roster = (units: RosterUnit[]): Pick<Roster, "units"> => ({ units });

describe("split halves", () => {
  const r = roster([unit("a", 5), unit("b", 5, { halfOf: "a" }), unit("c", 10)]);
  it("find each other", () => {
    expect(headOf(r, r.units[1]!).id).toBe("a");
    expect(headOf(r, r.units[0]!).id).toBe("a");
    expect(halvesOf(r, r.units[0]!).map((u) => u.id)).toEqual(["b"]);
    expect(halvesOf(r, r.units[2]!)).toEqual([]);
    expect(isSplit(r, r.units[0]!)).toBe(true);
    expect(isSplit(r, r.units[1]!)).toBe(true);
    expect(isSplit(r, r.units[2]!)).toBe(false);
  });
  it("add up to the whole unit from either half", () => {
    expect(wholeModelsOf(r, r.units[0]!)).toEqual([{ modelProfileId: "m", count: 10, wargear: [] }]);
    expect(wholeModelsOf(r, r.units[1]!)).toEqual([{ modelProfileId: "m", count: 10, wargear: [] }]);
    expect(wholeModelsOf(r, r.units[2]!)).toEqual([{ modelProfileId: "m", count: 10, wargear: [] }]);
  });
  it("merge groups that hold the same models with the same wargear", () => {
    expect(mergeModelGroups([{ modelProfileId: "m", count: 1, wargear: ["Big gun"] }, { modelProfileId: "m", count: 4, wargear: [] }, { modelProfileId: "m", count: 5, wargear: [] }, { modelProfileId: "s", count: 1, wargear: [] }])).toEqual([
      { modelProfileId: "m", count: 1, wargear: ["Big gun"] },
      { modelProfileId: "m", count: 9, wargear: [] },
      { modelProfileId: "s", count: 1, wargear: [] },
    ]);
  });
});
