import { describe, expect, it } from "vitest";
import { keywordsToText, parseKeywordText } from "./keywordParser";

describe("parseKeywordText", () => {
  it("parses the documented example", () => {
    const out = parseKeywordText("Sustained Hits D3, Lethal Hits, Anti-vehicle 4+, Blast, Rapid Fire 1, Melta 2");
    expect(out.map(({ raw: _raw, ...rest }) => rest)).toEqual([
      { name: "SUSTAINED HITS", value: "D3" },
      { name: "LETHAL HITS" },
      { name: "ANTI", keyword: "VEHICLE", value: 4 },
      { name: "BLAST" },
      { name: "RAPID FIRE", value: 1 },
      { name: "MELTA", value: 2 },
    ]);
    expect(out.every((k) => typeof k.raw === "string" && k.raw.length > 0)).toBe(true);
  });

  it("is tolerant of spacing, case, brackets and separators", () => {
    const out = parseKeywordText("[sustained hits 2]; twin linked\n anti   infantry 3 , heavy");
    expect(out.map(({ raw: _raw, ...rest }) => rest)).toEqual([
      { name: "SUSTAINED HITS", value: 2 },
      { name: "TWIN-LINKED" },
      { name: "ANTI", keyword: "INFANTRY", value: 3 },
      { name: "HEAVY" },
    ]);
  });

  it("keeps unknown keywords with their raw text", () => {
    const out = parseKeywordText("Frobnicate 3, Something Odd");
    expect(out).toEqual([
      { name: "FROBNICATE", value: 3, raw: "Frobnicate 3" },
      { name: "SOMETHING ODD", raw: "Something Odd" },
    ]);
  });

  it("parses dice values and N+ values", () => {
    expect(parseKeywordText("Sustained Hits 2D3+1")[0]).toMatchObject({ name: "SUSTAINED HITS", value: "2D3+1" });
    expect(parseKeywordText("Anti-monster 2+")[0]).toMatchObject({ name: "ANTI", keyword: "MONSTER", value: 2 });
  });

  it("returns an empty list for empty text", () => {
    expect(parseKeywordText("")).toEqual([]);
    expect(parseKeywordText("  , ,")).toEqual([]);
  });

  it("round-trips through keywordsToText", () => {
    const text = "Sustained Hits D3, Lethal Hits, Anti-vehicle 4+, Blast, Rapid Fire 1, Melta 2";
    const parsed = parseKeywordText(text);
    expect(keywordsToText(parsed)).toBe(text);
    expect(parseKeywordText(keywordsToText(parsed))).toEqual(parsed);
    // without raw text the fields are rebuilt
    expect(keywordsToText([{ name: "ANTI", keyword: "VEHICLE", value: 4 }, { name: "RAPID FIRE", value: 1 }, { name: "BLAST" }])).toBe("Anti-vehicle 4+, Rapid Fire 1, Blast");
  });
});
