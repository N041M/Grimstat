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
  it("gives a chapter catalogue the army the points source lists it under", () => {
    // The structure source publishes one catalogue per chapter. Without this every Space Marine unit
    // arrives twice: once under the chapter and once under the codex the other sources name.
    expect(factionSlug("Adeptus Astartes - Space Marines")).toBe("space-marines");
    expect(factionSlug("Adeptus Astartes - Blood Angels")).toBe("blood-angels");
    expect(factionSlug("Adeptus Astartes - Deathwatch")).toBe("deathwatch");
    // A chapter without an army of its own is Space Marines, including one added upstream tomorrow.
    expect(factionSlug("Adeptus Astartes - Ultramarines")).toBe("space-marines");
    expect(factionSlug("Adeptus Astartes - Crimson Fists")).toBe("space-marines");
  });

  it("gives an army named by its keyword the codex name", () => {
    expect(factionSlug("Asuryani")).toBe("aeldari");
    expect(factionSlug("Harlequins")).toBe("aeldari");
    expect(factionSlug("Ynnari")).toBe("aeldari");
    expect(factionSlug("Heretic Astartes")).toBe("chaos-space-marines");
    expect(factionSlug("Legiones Daemonica")).toBe("chaos-daemons");
  });

  it("makes ids unique", () => {
    const used = new Set<string>();
    expect(uniqueId("a", used)).toBe("a");
    expect(uniqueId("a", used)).toBe("a-2");
    expect(uniqueId("a", used)).toBe("a-3");
  });
});
