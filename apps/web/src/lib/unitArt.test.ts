import { describe, expect, it } from "vitest";
import { UNIT_ART_CREDITS, UNIT_ART_IDS, unitArtAuthors, unitArtFor, unitArtPath } from "./unitArt";

describe("a picture for what a unit is", () => {
  it("picks the most specific kind first", () => {
    expect(unitArtFor(["INFANTRY"])).toBe("infantry");
    expect(unitArtFor(["INFANTRY", "CHARACTER"])).toBe("character");
    expect(unitArtFor(["VEHICLE"])).toBe("vehicle");
    expect(unitArtFor(["VEHICLE", "TRANSPORT"])).toBe("transport");
    expect(unitArtFor(["VEHICLE", "DEDICATED TRANSPORT"])).toBe("transport");
    expect(unitArtFor(["VEHICLE", "WALKER"])).toBe("walker");
    expect(unitArtFor(["VEHICLE", "TITANIC", "WALKER"])).toBe("titanic");
    expect(unitArtFor(["VEHICLE", "AIRCRAFT", "FLY"])).toBe("aircraft");
    expect(unitArtFor(["MONSTER", "CHARACTER"])).toBe("monster");
    expect(unitArtFor(["MOUNTED", "CHARACTER"])).toBe("mounted");
    expect(unitArtFor(["INFANTRY", "BIKE"])).toBe("bike");
    expect(unitArtFor(["SWARM"])).toBe("swarm");
    expect(unitArtFor(["BEAST"])).toBe("beast");
    expect(unitArtFor(["FORTIFICATION"])).toBe("fortification");
  });

  it("is not fussy about case or spacing, and falls back to infantry", () => {
    expect(unitArtFor(["vehicle", " Walker "])).toBe("walker");
    expect(unitArtFor([])).toBe("infantry");
    expect(unitArtFor(["IMPERIUM", "ADEPTUS SOMETHING"])).toBe("infantry");
  });

  it("credits every picture to an author on the source site", () => {
    for (const id of UNIT_ART_IDS) {
      const credit = UNIT_ART_CREDITS[id];
      expect(credit.author.length).toBeGreaterThan(0);
      expect(credit.slug).toMatch(/^[a-z-]+\/[a-z-]+$/);
    }
    expect(unitArtAuthors()).toEqual(expect.arrayContaining(["Lorc", "Delapouite"]));
  });
});

describe("the vendored silhouettes", () => {
  it("has path data for every kind, on the source's 512-unit canvas", () => {
    for (const id of UNIT_ART_IDS) {
      const d = unitArtPath(id);
      expect(d.length, id).toBeGreaterThan(100);
      expect(d, id).toMatch(/^\s*[Mm]/);
    }
  });
});
