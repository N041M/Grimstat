import { describe, expect, it } from "vitest";
import type { Datasheet, Snapshot } from "@grimstat/schema";
import { exportRosterText, importRosterText } from "./index";

/**
 * A model with a datasheet of its own that comes with another unit, as Sir Hekhtur comes with
 * Canis Rex. Lists write him inside the Knight's entry and count him in its header.
 */
const now = new Date().toISOString();
const model = { id: "m", name: "Model", T: 4, Sv: 3, W: 2 };
function sheet(id: string, name: string, over: Partial<Datasheet> = {}): Datasheet {
  return { id, gameSystemId: "wh40k-11e", factionId: "f1", name, isLegends: false, isCharacter: true, isEpicHero: true, isBattleline: false, isSupport: false, keywords: ["CHARACTER", "EPIC HERO"], factionKeywords: ["HOUSE"], models: [{ ...model, id: `${id}-m`, name }], weapons: [], abilityIds: [], stratagemIds: [], leaderTo: [], supportTo: [], composition: [{ description: `1 ${name} – EPIC HERO`, min: 1, max: 1 }], wargearOptions: [], ...over };
}
const knight = sheet("knight", "Canis Rex", { weapons: [{ id: "w-hand", name: "Freedom’s Hand", kind: "melee", skill: 3, A: "6", S: 12, AP: 3, D: "6", keywords: [] }], loadout: "Canis Rex is equipped with: Freedom’s Hand." });
const rider = sheet("rider", "Sir Hekhtur", { abilityIds: ["using"], weapons: [{ id: "w-pistol", name: "Hekhtur’s pistol", kind: "ranged", range: 12, skill: 3, A: "1", S: 4, AP: 0, D: "1", keywords: [] }], loadout: "Sir Hekhtur is equipped with: Hekhtur’s pistol." });
const snapshot: Snapshot = {
  id: "snap_companion",
  ownerId: "local",
  createdAt: now,
  updatedAt: now,
  revision: 0,
  gameSystemId: "wh40k-11e",
  checksum: "x",
  sources: [],
  conflicts: [],
  data: {
    gameSystem: { id: "wh40k-11e", name: "40k", edition: "11", costTypes: [] },
    factions: [{ id: "f1", gameSystemId: "wh40k-11e", name: "Imperial Knights", keywords: [] }],
    publications: [],
    datasheets: [knight, rider],
    abilities: [{ id: "using", name: "Using Sir Hekhtur", scope: "other", text: "If your Canis Rex model is destroyed, this model disembarks.", isLegends: false }],
    detachments: [],
    enhancements: [],
    stratagems: [],
    priceRules: [{ datasheetId: "knight", copyRange: { min: 1 }, tiers: [{ models: 1, points: 415 }] }],
    wargearPrices: [],
  },
};

describe("a model that comes with another unit", () => {
  it("is read from a header that counts it among the unit's models", () => {
    const text = ["+++ Knights [415pts] +++", "++ Imperial Knights — Strike Force [2000pts] ++", "", "+ CHARACTERS +", "Char1: 2x Canis Rex (415 pts): Warlord", "  1x Canis Rex: Freedom’s Hand", "  1x Sir Hekhtur: Hekhtur’s pistol", ""].join("\n");
    const { roster, warnings } = importRosterText(text, snapshot);
    expect(warnings).toEqual([]);
    expect(roster.units.map((u) => [u.datasheetId, u.models.map((g) => g.count), u.isWarlord])).toEqual([
      ["knight", [1], true],
      ["rider", [1], false],
    ]);
  });
  it("is written inside the unit's entry and read back as its own unit", () => {
    const text = ["Knights (415 points)", "", "Imperial Knights", "Strike Force (2000 points)", "", "CHARACTERS", "", "Canis Rex (415 points)", "  • Warlord", "  • 1x Canis Rex", "     1x Freedom’s Hand", "  • 1x Sir Hekhtur", "     1x Hekhtur’s pistol", ""].join("\n");
    const { roster, warnings } = importRosterText(text, snapshot);
    expect(warnings).toEqual([]);
    expect(roster.name).toBe("Knights");
    expect(roster.units.map((u) => u.datasheetId)).toEqual(["knight", "rider"]);
    const out = exportRosterText(roster, snapshot, "gw-app");
    expect(out).toContain("Canis Rex (415 points)");
    expect(out).toContain("  • 1x Sir Hekhtur");
    expect(out).not.toContain("Sir Hekhtur (0 points)");
    const back = importRosterText(out, snapshot);
    expect(back.warnings).toEqual([]);
    expect(back.roster.units.map((u) => u.datasheetId)).toEqual(["knight", "rider"]);
    expect(exportRosterText(back.roster, snapshot, "nr-tournament")).toContain("1x Sir Hekhtur (Hekhtur’s pistol)");
  });
  it("is read from a header that counts it with nothing written underneath", () => {
    const { roster, warnings } = importRosterText(["Knights", "Imperial Knights", "", "CHARACTERS", "", "2x Canis Rex (415 pts): Warlord", ""].join("\n"), snapshot);
    expect(warnings).toEqual([]);
    expect(roster.units.map((u) => [u.datasheetId, u.models.map((g) => g.count), u.isWarlord])).toEqual([
      ["knight", [1], true],
      ["rider", [1], false],
    ]);
  });
  it("is read from a counted header whose lines give only wargear", () => {
    const { roster, warnings } = importRosterText(["Knights", "Imperial Knights", "", "CHARACTERS", "", "2x Canis Rex (415 pts)", "  • Freedom’s Hand", ""].join("\n"), snapshot);
    expect(warnings).toEqual([]);
    // A unit a list gives no wargear for keeps its datasheet's default loadout, which is written nowhere.
    expect(roster.units.map((u) => [u.datasheetId, u.models.map((g) => [g.count, g.wargear])])).toEqual([
      ["knight", [[1, ["Freedom’s Hand"]]]],
      ["rider", [[1, []]]],
    ]);
  });
  it("keeps a list name that only loosely matches a datasheet as the name", () => {
    const { roster } = importRosterText(["Rex (415 points)", "", "Imperial Knights", "", "CHARACTERS", "", "Canis Rex (415 points)", "  • 1x Canis Rex", ""].join("\n"), snapshot);
    expect(roster.name).toBe("Rex");
    expect(roster.units.map((u) => u.datasheetId)).toEqual(["knight"]);
  });
});
