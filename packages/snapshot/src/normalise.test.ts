import { describe, expect, it } from "vitest";
import { factionKey, normaliseName, slugToNameKey } from "./normalise";

describe("normaliseName", () => {
  it.each([
    ["C'tan Shard of the Void Dragon", "ctan shard of the void dragon"],
    ["Anrakyr The Traveller", "anrakyr the traveller"],
    ["Anrakyr the Traveller (Legends)", "anrakyr the traveller"],
    ["Lord [Legends]", "lord"],
    ["T’au Empire", "tau empire"],
    ["Dêlvewerke   Navigator", "delvewerke navigator"],
    ["Myphitic Blight-hauler", "myphitic blight hauler"],
    ["Kaptin's Hat & Coat", "kaptins hat and coat"],
    ["  spaced   out  ", "spaced out"],
  ])("%s -> %s", (input, expected) => {
    expect(normaliseName(input)).toBe(expected);
  });

  it.each([
    ["Anrakyr ( Legends )", "anrakyr"],
    ["Anrakyr(Legends)", "anrakyr"],
    ["Anrakyr   (Legends)   ", "anrakyr"],
    // the marker's two brackets are read on their own, so a name that opens with one and closes with the other still counts
    ["Anrakyr (legend]", "anrakyr"],
    ["Anrakyr [Legends)", "anrakyr"],
    ["Anrakyr (legendss)", "anrakyr legendss"],
    ["Anrakyr (legend", "anrakyr legend"],
    ["Legends", "legends"],
  ])("%s -> %s", (input, expected) => {
    expect(normaliseName(input)).toBe(expected);
  });

  // A name padded with spaces used to take the pattern the marker was read with time quadratic in its
  // length, and the list importer calls this two to three times for every line it reads.
  it("reads a name padded with spaces in bounded time", () => {
    for (const pad of [2000, 20000]) {
      const started = performance.now();
      normaliseName(`Anrakyr${" ".repeat(pad)}(`);
      expect(performance.now() - started).toBeLessThan(50);
    }
  });
});

describe("factionKey", () => {
  it("accepts ids and names and applies aliases", () => {
    expect(factionKey("faction:space-marines")).toBe("space-marines");
    expect(factionKey("Space Marines")).toBe("space-marines");
    expect(factionKey("Agents of the Imperium")).toBe("imperial-agents");
    expect(factionKey("faction:craftworlds")).toBe("aeldari");
    expect(factionKey(undefined)).toBe("");
  });
  it("reads a chapter catalogue and a keyword name as the army they belong to", () => {
    // The same mapping as `factionSlug` in @grimstat/adapters, applied to ids the adapters already
    // built. The two are kept in step by hand; these cases are the same on both sides.
    expect(factionKey("faction:adeptus-astartes-space-marines")).toBe("space-marines");
    expect(factionKey("Adeptus Astartes - Blood Angels")).toBe("blood-angels");
    expect(factionKey("faction:adeptus-astartes-ultramarines")).toBe("space-marines");
    expect(factionKey("faction:adeptus-astartes-crimson-fists")).toBe("space-marines");
    expect(factionKey("Asuryani")).toBe("aeldari");
    expect(factionKey("faction:legiones-daemonica")).toBe("chaos-daemons");
    expect(factionKey("Heretic Astartes")).toBe("chaos-space-marines");
  });

  it("turns slugs back into name keys", () => {
    expect(slugToNameKey("wolf-guard-battle-leader")).toBe("wolf guard battle leader");
  });
});
