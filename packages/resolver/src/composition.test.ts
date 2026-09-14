import { describe, expect, it } from "vitest";
import { compositionBranches, compositionLineBounds, compositionPart, compositionParts, compositionSegments } from "./composition";

describe("compositionSegments", () => {
  it("splits a line on the joiners that separate one kind of model from the next", () => {
    expect(compositionSegments("1 Runtherd and 10 Gretchin")).toEqual(["1 Runtherd", "10 Gretchin"]);
    expect(compositionSegments("1 Sword Brother, 5 Initiates and 4 Neophytes")).toEqual(["1 Sword Brother", " 5 Initiates", "4 Neophytes"]);
  });

  it("leaves a line that names one kind whole", () => {
    expect(compositionSegments("4-9 Wardens")).toEqual(["4-9 Wardens"]);
  });
});

describe("compositionPart", () => {
  it("reads the count and the name a segment opens with", () => {
    expect(compositionPart("10 Gretchin")).toEqual({ min: 10, max: 10, name: "Gretchin" });
    expect(compositionPart(" 4-9 Wardens")).toEqual({ min: 4, max: 9, name: "Wardens" });
  });

  it("finds nothing in a segment that opens with no count", () => {
    expect(compositionPart("OR")).toBeUndefined();
    expect(compositionPart("This unit can contain a maximum of 10 models.")).toBeUndefined();
  });
});

describe("compositionParts", () => {
  it("reads a line that names one kind of model", () => {
    expect(compositionParts("4-9 Wardens")).toEqual([{ min: 4, max: 9, name: "Wardens" }]);
    expect(compositionParts("1 Warden Captain model")).toEqual([{ min: 1, max: 1, name: "Warden Captain" }]);
  });

  it("reads every kind a line names", () => {
    expect(compositionParts("1 Runtherd and 10 Gretchin")).toEqual([
      { min: 1, max: 1, name: "Runtherd" },
      { min: 10, max: 10, name: "Gretchin" },
    ]);
    expect(compositionParts("1 Master of Ordnance, 1 Officer of the Fleet and 1 Astropath.").map((p) => p.name)).toEqual(["Master of Ordnance", "Officer of the Fleet", "Astropath"]);
  });

  it("drops the keyword written after a model's name", () => {
    expect(compositionParts("1 Chaplain Cassius – EPIC HERO")).toEqual([{ min: 1, max: 1, name: "Chaplain Cassius" }]);
  });

  it("takes bracketed text as one model's pieces rather than more models", () => {
    expect(compositionParts("1 Imperial Fortress Walls (1 gate section, 2 gate tower sections and 2 wall sections)")).toEqual([{ min: 1, max: 1, name: "Imperial Fortress Walls" }]);
  });

  it("counts the models a line opens with when it then lists them by name", () => {
    expect(compositionParts("8 Kill Team Veterans:\n\n- Vael Donatus\n- Zameon Gydrael")).toEqual([{ min: 8, max: 8, name: "Kill Team Veterans" }]);
  });

  it("finds nothing in a line that states no count", () => {
    expect(compositionParts("OR")).toEqual([]);
    expect(compositionParts("This unit can contain a maximum of 10 models.")).toEqual([]);
  });
});

describe("compositionLineBounds", () => {
  it("adds up the kinds a line names", () => {
    expect(compositionLineBounds("1 Runtherd and 10 Gretchin")).toEqual({ min: 11, max: 11 });
    expect(compositionLineBounds("1 Grenadier Sergeant, 7 Grenadiers and 1 Heavy Weapons Team")).toEqual({ min: 9, max: 9 });
    expect(compositionLineBounds("4-9 Wardens")).toEqual({ min: 4, max: 9 });
  });

  it("states nothing for a line that carries no count", () => {
    expect(compositionLineBounds("OR")).toEqual({});
  });
});

describe("compositionBranches", () => {
  const line = (description: string, min?: number, max?: number) => ({ description, ...(min === undefined ? {} : { min, max: max ?? min }) });

  it("leaves a composition that offers one way of building the unit alone", () => {
    const lines = [line("1 Warden Sergeant", 1), line("4-9 Wardens", 4, 9)];
    expect(compositionBranches(lines)).toEqual([lines]);
  });

  it("splits on the OR between two ways of building the unit", () => {
    const lines = [line("1 Runtherd and 10 Gretchin", 11), line("OR"), line("2 Runtherds and 20 Gretchin", 22)];
    expect(compositionBranches(lines)).toEqual([[lines[0]], [lines[2]]]);
  });

  it("splits the lines a 'One of the following:' heading introduces", () => {
    const lines = [line("One of the following:"), line("1 Grenadier Sergeant and 9 Grenadiers", 10), line("1 Grenadier Sergeant, 7 Grenadiers and 1 Heavy Weapons Team", 9)];
    expect(compositionBranches(lines)).toEqual([[lines[1]], [lines[2]]]);
  });

  it("keeps a note about the unit in the branch it was written in", () => {
    const lines = [line("This unit can contain a maximum of 10 models."), line("1 Voidscarred Felarch", 1), line("4-9 Corsair Voidscarred", 4, 9)];
    expect(compositionBranches(lines)).toEqual([lines]);
  });

  it("gives an empty composition one empty branch", () => {
    expect(compositionBranches([])).toEqual([[]]);
  });
});
