import { describe, expect, it } from "vitest";
import { UNIT_ART_CREDITS, UNIT_ART_IDS, UNIT_CLASS_IDS, UNIT_FACTION_IDS, unitArtAuthors, unitArtFor, unitArtPath, unitClassFor, unitFactionFor } from "./unitArt";

describe("a picture for what a unit is", () => {
  it("picks the most specific class first", () => {
    expect(unitClassFor(["INFANTRY"])).toBe("infantry");
    expect(unitClassFor(["INFANTRY", "CHARACTER"])).toBe("character");
    expect(unitClassFor(["VEHICLE"])).toBe("vehicle");
    expect(unitClassFor(["VEHICLE", "TRANSPORT"])).toBe("transport");
    expect(unitClassFor(["VEHICLE", "DEDICATED TRANSPORT"])).toBe("transport");
    expect(unitClassFor(["VEHICLE", "WALKER"])).toBe("walker");
    expect(unitClassFor(["VEHICLE", "TITANIC", "WALKER"])).toBe("titanic");
    expect(unitClassFor(["VEHICLE", "AIRCRAFT", "FLY"])).toBe("aircraft");
    expect(unitClassFor(["MONSTER", "CHARACTER"])).toBe("monster");
    expect(unitClassFor(["MOUNTED", "CHARACTER"])).toBe("mounted");
    expect(unitClassFor(["INFANTRY", "BIKE"])).toBe("bike");
    expect(unitClassFor(["SWARM"])).toBe("swarm");
    expect(unitClassFor(["BEAST"])).toBe("beast");
    expect(unitClassFor(["FORTIFICATION"])).toBe("fortification");
  });

  it("is not fussy about case or spacing, and falls back to infantry", () => {
    expect(unitClassFor(["vehicle", " Walker "])).toBe("walker");
    expect(unitClassFor([])).toBe("infantry");
    expect(unitClassFor(["IMPERIUM", "ADEPTUS SOMETHING"])).toBe("infantry");
  });
});

describe("a picture for whose a unit is", () => {
  it("gives plain infantry its faction's picture", () => {
    expect(unitArtFor(["INFANTRY", "BATTLELINE", "MOB"], ["ORKS"])).toBe("orks");
    expect(unitArtFor(["INFANTRY", "IMPERIUM"], ["ADEPTUS ASTARTES", "BLOOD ANGELS"])).toBe("space-marines");
    expect(unitArtFor(["INFANTRY"], ["T’AU EMPIRE"])).toBe("tau-empire");
    expect(unitArtFor(["INFANTRY"], ["EMPEROR’S CHILDREN"])).toBe("emperors-children");
    expect(unitArtFor(["infantry"], ["orks"])).toBe("orks");
  });

  it("keeps the class for everything that is not plain infantry", () => {
    expect(unitArtFor(["INFANTRY", "CHARACTER"], ["ORKS"])).toBe("character");
    expect(unitArtFor(["VEHICLE"], ["ORKS"])).toBe("vehicle");
    expect(unitArtFor(["INFANTRY", "BIKE"], ["ORKS"])).toBe("bike");
    expect(unitArtFor(["MONSTER"], ["TYRANIDS"])).toBe("monster");
  });

  it("reads the most specific faction first", () => {
    expect(unitFactionFor(["HERETIC ASTARTES", "DEATH GUARD"])).toBe("death-guard");
    expect(unitFactionFor(["HERETIC ASTARTES"])).toBe("chaos-space-marines");
    expect(unitFactionFor(["LEGIONES DAEMONICA", "PLAGUE LEGIONS"])).toBe("chaos-daemons");
    expect(unitFactionFor(["AELDARI", "DRUKHARI"])).toBe("drukhari");
    expect(unitFactionFor(["HARLEQUINS"])).toBe("aeldari");
    expect(unitFactionFor(["ADEPTUS ASTARTES", "GREY KNIGHTS"])).toBe("grey-knights");
    expect(unitFactionFor(["AGENTS OF THE IMPERIUM"])).toBe("imperial-agents");
  });

  it("falls through to the class for a faction with no picture", () => {
    expect(unitFactionFor(["IMPERIAL KNIGHTS"])).toBeUndefined();
    expect(unitFactionFor([])).toBeUndefined();
    expect(unitArtFor(["INFANTRY"], ["UNALIGNED FORCES"])).toBe("infantry");
    expect(unitArtFor(["VEHICLE", "WALKER", "TITANIC"], ["CHAOS KNIGHTS"])).toBe("titanic");
    expect(unitArtFor(["INFANTRY"])).toBe("infantry");
  });
});

describe("the credits", () => {
  it("list every class and then every faction, each once", () => {
    expect(UNIT_ART_IDS).toEqual([...UNIT_CLASS_IDS, ...UNIT_FACTION_IDS]);
    expect(new Set(UNIT_ART_IDS).size).toBe(UNIT_ART_IDS.length);
  });

  it("credit every picture to an author on the source site", () => {
    for (const id of UNIT_ART_IDS) {
      const credit = UNIT_ART_CREDITS[id];
      expect(credit.author.length).toBeGreaterThan(0);
      expect(credit.slug).toMatch(/^[a-z-]+\/[a-z-]+$/);
    }
    expect(unitArtAuthors()).toEqual(expect.arrayContaining(["Lorc", "Delapouite"]));
  });
});

describe("the vendored silhouettes", () => {
  it("has path data for every picture, on the source's 512-unit canvas", () => {
    for (const id of UNIT_ART_IDS) {
      const d = unitArtPath(id);
      expect(d.length, id).toBeGreaterThan(100);
      expect(d, id).toMatch(/^\s*[Mm]/);
    }
  });
});
