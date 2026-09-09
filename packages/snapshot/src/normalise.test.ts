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
});

describe("factionKey", () => {
  it("accepts ids and names and applies aliases", () => {
    expect(factionKey("faction:space-marines")).toBe("space-marines");
    expect(factionKey("Space Marines")).toBe("space-marines");
    expect(factionKey("Agents of the Imperium")).toBe("imperial-agents");
    expect(factionKey("faction:craftworlds")).toBe("aeldari");
    expect(factionKey(undefined)).toBe("");
  });
  it("turns slugs back into name keys", () => {
    expect(slugToNameKey("wolf-guard-battle-leader")).toBe("wolf guard battle leader");
  });
});
