import { describe, expect, it } from "vitest";
import { parseWeaponKeywords } from "./weapon-keywords";

const one = (t: string) => parseWeaponKeywords(t)[0]!;

describe("parseWeaponKeywords", () => {
  it.each([
    ["Anti-vehicle 4+", { name: "ANTI", keyword: "VEHICLE", value: 4 }],
    ["ANTI-MONSTER/VEHICLE 2+", { name: "ANTI", keyword: "MONSTER/VEHICLE", value: 2 }],
    ["Sustained Hits D3", { name: "SUSTAINED HITS", value: "D3" }],
    ["Sustained Hits 1", { name: "SUSTAINED HITS", value: 1 }],
    ["Rapid Fire 2", { name: "RAPID FIRE", value: 2 }],
    ["Melta 2", { name: "MELTA", value: 2 }],
    ["Blast", { name: "BLAST" }],
    ["Twin-linked", { name: "TWIN-LINKED" }],
    ["twin linked", { name: "TWIN LINKED" }],
    ["Hazardous", { name: "HAZARDOUS" }],
    ["Precision", { name: "PRECISION" }],
    ["Devastating Wounds", { name: "DEVASTATING WOUNDS" }],
    ["Lethal Hits", { name: "LETHAL HITS" }],
    ["Heavy", { name: "HEAVY" }],
    ["Torrent", { name: "TORRENT" }],
    ["Cleave 2", { name: "CLEAVE", value: 2 }],
    ["Conversion", { name: "CONVERSION" }],
    ["Firing Deck 6", { name: "FIRING DECK", value: 6 }],
  ])("parses %s", (text, expected) => {
    expect(one(text)).toMatchObject(expected);
    expect(one(text).raw).toBe(text);
  });

  it("keeps unknown keywords raw", () => {
    const kw = one("Krakstorm 3");
    expect(kw).toMatchObject({ name: "KRAKSTORM", value: 3, raw: "Krakstorm 3" });
    expect(one("C'tan Power").name).toBe("C'TAN POWER");
  });

  it("splits comma separated lists and strips brackets", () => {
    const list = parseWeaponKeywords("[BLAST], Heavy,  Ignores Cover");
    expect(list.map((k) => k.name)).toEqual(["BLAST", "HEAVY", "IGNORES COVER"]);
  });

  it("parses conditional forms", () => {
    expect(one("LETHAL HITS: non-MONSTER/VEHICLE")).toMatchObject({ name: "LETHAL HITS", keyword: "NON-MONSTER/VEHICLE" });
  });

  it("returns an empty list for empty or dash input", () => {
    expect(parseWeaponKeywords("")).toEqual([]);
    expect(parseWeaponKeywords("-")).toEqual([]);
    expect(parseWeaponKeywords(null)).toEqual([]);
  });
});
