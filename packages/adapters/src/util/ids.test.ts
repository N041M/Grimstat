import { describe, expect, it } from "vitest";
import { datasheetId, factionId, factionSlug, slugify, uniqueId } from "./ids";

describe("ids", () => {
  it("slugifies names deterministically", () => {
    expect(slugify("C'tan Shard of the Void Dragon")).toBe("ctan-shard-of-the-void-dragon");
    expect(slugify("T’au Empire")).toBe("tau-empire");
    expect(slugify("Emperor’s Children")).toBe("emperors-children");
    expect(slugify("Dêlvewerke Navigator")).toBe("delvewerke-navigator");
    expect(slugify("Kaptin's Hat & Coat")).toBe("kaptins-hat-and-coat");
  });
  it("aliases upstream faction names", () => {
    expect(factionSlug("Agents of the Imperium")).toBe("imperial-agents");
    expect(factionSlug("Craftworlds")).toBe("aeldari");
    expect(factionSlug("Adeptus Titanicus")).toBe("titan-legions");
    expect(factionId("Necrons")).toBe("faction:necrons");
    expect(datasheetId("Xenos Faction", "Some Unit")).toBe("ds:xenos-faction:some-unit");
  });
  it("makes ids unique", () => {
    const used = new Set<string>();
    expect(uniqueId("a", used)).toBe("a");
    expect(uniqueId("a", used)).toBe("a-2");
    expect(uniqueId("a", used)).toBe("a-3");
  });
});
