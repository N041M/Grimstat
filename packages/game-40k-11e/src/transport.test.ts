import { describe, expect, it } from "vitest";
import { hasKeywordPhrase, parseTransportCapacity, unitFitsKeywords } from "./transport";

describe("parseTransportCapacity", () => {
  it("capacity, single keyword and an exclusion", () => {
    const cap = parseTransportCapacity("This model has a transport capacity of 12 INFANTRY models. It cannot transport JUMP PACK models.")!;
    expect(cap.capacity).toBe(12);
    expect(cap.keywords).toEqual(["INFANTRY"]);
    expect(cap.excluded).toEqual(["JUMP PACK"]);
    expect(cap.sizes).toEqual([]);
    expect(cap.text).toContain("transport capacity of 12");
  });
  it("multi-word keyword phrase and a size multiplier", () => {
    const cap = parseTransportCapacity("This model has a transport capacity of 6 ADEPTUS ASTARTES INFANTRY models. Each TERMINATOR model takes up the space of 2 models.")!;
    expect(cap.capacity).toBe(6);
    expect(cap.keywords).toEqual(["ADEPTUS ASTARTES INFANTRY"]);
    expect(cap.sizes).toEqual([{ keyword: "TERMINATOR", takes: 2 }]);
    expect(cap.excluded).toEqual([]);
  });
  it("large capacity, several exclusions, several size keywords and a number word", () => {
    const cap = parseTransportCapacity("This model has a transport capacity of 22 ORKS INFANTRY models. Each MEGA ARMOUR or JUMP PACK model takes up the space of two models. It cannot transport GRETCHIN, BEAST or MONSTER models.")!;
    expect(cap.capacity).toBe(22);
    expect(cap.keywords).toEqual(["ORKS INFANTRY"]);
    expect(cap.sizes).toEqual([{ keyword: "MEGA ARMOUR", takes: 2 }, { keyword: "JUMP PACK", takes: 2 }]);
    expect(cap.excluded).toEqual(["GRETCHIN", "BEAST", "MONSTER"]);
  });
  it("singular model, no keyword phrase", () => {
    const cap = parseTransportCapacity("This model has a transport capacity of 1 model.")!;
    expect(cap.capacity).toBe(1);
    expect(cap.keywords).toEqual([]);
    expect(unitFitsKeywords(["VEHICLE"], cap)).toBe(true);
  });
  it("alternative capacity clauses: only the first is used; multi-word exclusions and 'takes up the space of 3'", () => {
    const cap = parseTransportCapacity("This model has a transport capacity of 20 TYRANIDS INFANTRY models or 1 TYRANIDS MONSTER model. Each TYRANT GUARD model takes up the space of 3 models. It cannot transport WRAITH CONSTRUCT or JUMP PACK models.")!;
    expect(cap.capacity).toBe(20);
    expect(cap.keywords).toEqual(["TYRANIDS INFANTRY"]);
    expect(cap.sizes).toEqual([{ keyword: "TYRANT GUARD", takes: 3 }]);
    expect(cap.excluded).toEqual(["WRAITH CONSTRUCT", "JUMP PACK"]);
  });
  it("exclusions spread over repeated 'models' nouns and title-case source text", () => {
    const cap = parseTransportCapacity("This model has a transport capacity of 10 Astra Militarum Infantry models. It cannot transport Ogryn models or Bullgryn models.")!;
    expect(cap.capacity).toBe(10);
    expect(cap.keywords).toEqual(["ASTRA MILITARUM INFANTRY"]);
    expect(cap.excluded).toEqual(["OGRYN", "BULLGRYN"]);
    expect(unitFitsKeywords(["Infantry", "Astra Militarum"], cap)).toBe(true);
  });
  it("keyword alternatives inside the capacity clause", () => {
    const cap = parseTransportCapacity("This model has a transport capacity of 6 ASURYANI INFANTRY or ASURYANI MOUNTED models.")!;
    expect(cap.keywords).toEqual(["ASURYANI INFANTRY", "ASURYANI MOUNTED"]);
    expect(unitFitsKeywords(["MOUNTED", "ASURYANI"], cap)).toBe(true);
    expect(unitFitsKeywords(["VEHICLE", "ASURYANI"], cap)).toBe(false);
  });
  it("returns undefined without a capacity number", () => {
    expect(parseTransportCapacity(undefined)).toBeUndefined();
    expect(parseTransportCapacity("")).toBeUndefined();
    expect(parseTransportCapacity("Firing Deck 6.")).toBeUndefined();
    expect(parseTransportCapacity("This model has a transport capacity of some INFANTRY models.")).toBeUndefined();
  });
});

describe("unitFitsKeywords / hasKeywordPhrase", () => {
  const cap = parseTransportCapacity("This model has a transport capacity of 12 ADEPTUS ASTARTES INFANTRY models.")!;
  it("matches when every word of the phrase appears among the unit keywords, case-insensitively", () => {
    expect(unitFitsKeywords(["INFANTRY", "ADEPTUS ASTARTES", "GRENADES"], cap)).toBe(true);
    expect(unitFitsKeywords(["infantry", "adeptus astartes"], cap)).toBe(true);
    expect(unitFitsKeywords(["INFANTRY"], cap)).toBe(false);
    expect(unitFitsKeywords(["ADEPTUS ASTARTES", "VEHICLE"], cap)).toBe(false);
    expect(unitFitsKeywords([], cap)).toBe(false);
  });
  it("hasKeywordPhrase works on whole keywords and on word sets", () => {
    expect(hasKeywordPhrase(["JUMP PACK", "INFANTRY"], "JUMP PACK")).toBe(true);
    expect(hasKeywordPhrase(["INFANTRY"], "JUMP PACK")).toBe(false);
    expect(hasKeywordPhrase(["WRAITH CONSTRUCT"], "WRAITH")).toBe(true);
    expect(hasKeywordPhrase(["INFANTRY"], "")).toBe(false);
  });
});
