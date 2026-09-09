import { describe, expect, it } from "vitest";
import type { Roster, Snapshot } from "@grimstat/schema";
import { createContext, validateRoster } from "@grimstat/resolver";
import { constraints11e, compositionBounds } from "./constraints";

const now = new Date().toISOString();
const model = { id: "m", name: "Trooper", T: 4, Sv: 3, W: 2 };
const snapshot: Snapshot = {
  id: "snap_test",
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
    factions: [{ id: "f1", gameSystemId: "wh40k-11e", name: "Test Faction", keywords: [] }],
    publications: [],
    datasheets: [
      { id: "squad", gameSystemId: "wh40k-11e", factionId: "f1", name: "Test Squad", isLegends: false, isCharacter: false, isEpicHero: false, isBattleline: true, isSupport: false, keywords: ["INFANTRY", "BATTLELINE"], factionKeywords: [], models: [model], weapons: [], abilityIds: [], leaderTo: [], supportTo: [], composition: [{ description: "5-10 models", min: 5, max: 10 }], wargearOptions: [] },
      { id: "elite", gameSystemId: "wh40k-11e", factionId: "f1", name: "Test Elites", isLegends: false, isCharacter: false, isEpicHero: false, isBattleline: false, isSupport: false, keywords: ["INFANTRY"], factionKeywords: [], models: [model], weapons: [], abilityIds: [], leaderTo: [], supportTo: [], composition: [{ description: "3-6 models", min: 3, max: 6 }], wargearOptions: [] },
      { id: "cap", gameSystemId: "wh40k-11e", factionId: "f1", name: "Test Captain", isLegends: false, isCharacter: true, isEpicHero: false, isBattleline: false, isSupport: false, keywords: ["CHARACTER", "INFANTRY"], factionKeywords: [], models: [{ ...model, id: "c", name: "Captain", W: 5 }], weapons: [], abilityIds: [], leaderTo: ["squad"], supportTo: [], composition: [{ description: "1 model", min: 1, max: 1 }], wargearOptions: [] },
      { id: "medic", gameSystemId: "wh40k-11e", factionId: "f1", name: "Test Medic", isLegends: false, isCharacter: true, isEpicHero: false, isBattleline: false, isSupport: true, keywords: ["CHARACTER", "INFANTRY"], factionKeywords: [], models: [{ ...model, id: "d", name: "Medic", W: 4 }], weapons: [], abilityIds: [], leaderTo: [], supportTo: ["squad"], composition: [{ description: "1 model", min: 1, max: 1 }], wargearOptions: [] },
      { id: "hero", gameSystemId: "wh40k-11e", factionId: "f1", name: "Test Epic Hero", isLegends: false, isCharacter: true, isEpicHero: true, isBattleline: false, isSupport: false, keywords: ["CHARACTER", "EPIC HERO"], factionKeywords: [], models: [{ ...model, id: "h", name: "Hero", W: 6 }], weapons: [], abilityIds: [], leaderTo: ["squad"], supportTo: [], composition: [{ description: "1 model", min: 1, max: 1 }], wargearOptions: [] },
    ],
    abilities: [],
    detachments: [
      { id: "detA", factionId: "f1", name: "Detachment A", dp: 2, forceDispositions: ["TAKE AND HOLD"], uniqueTag: "Doctrine", ruleAbilityIds: [], enhancementIds: ["e1", "e2"], stratagemIds: [] },
      { id: "detB", factionId: "f1", name: "Detachment B", dp: 1, forceDispositions: [], uniqueTag: "Doctrine", ruleAbilityIds: [], enhancementIds: [], stratagemIds: [] },
      { id: "detC", factionId: "f1", name: "Detachment C", dp: 1, forceDispositions: [], ruleAbilityIds: [], enhancementIds: [], stratagemIds: [] },
    ],
    enhancements: [
      { id: "e1", detachmentId: "detA", name: "Relic One", cost: 20, text: "", supportOnly: false, isLegends: false },
      { id: "e2", detachmentId: "detA", name: "Support Relic", cost: 15, text: "", supportOnly: true, isLegends: false },
    ],
    stratagems: [],
    priceRules: [
      { datasheetId: "squad", copyRange: { min: 1, max: 2 }, tiers: [{ models: 5, points: 80 }, { models: 10, points: 160 }] },
      { datasheetId: "squad", copyRange: { min: 3 }, tiers: [{ models: 5, points: 90 }, { models: 10, points: 180 }] },
      { datasheetId: "elite", copyRange: { min: 1 }, tiers: [{ models: 3, points: 100 }, { models: 6, points: 200 }] },
      { datasheetId: "cap", copyRange: { min: 1 }, tiers: [{ models: 1, points: 70 }] },
      { datasheetId: "medic", copyRange: { min: 1 }, tiers: [{ models: 1, points: 50 }] },
      { datasheetId: "hero", copyRange: { min: 1 }, tiers: [{ models: 1, points: 120 }] },
    ],
    wargearPrices: [{ datasheetId: "squad", item: "Big gun", points: 10 }],
  },
};

function roster(over: Partial<Roster> = {}): Roster {
  return {
    id: "r",
    ownerId: "local",
    createdAt: now,
    updatedAt: now,
    revision: 0,
    name: "test",
    gameSystemId: "wh40k-11e",
    snapshotId: snapshot.id,
    factionId: "f1",
    battleSize: "strike-force",
    pointsLimit: 2000,
    detachments: [{ id: "d1", detachmentId: "detA" }],
    units: [
      { id: "u1", datasheetId: "squad", models: [{ modelProfileId: "m", count: 9, wargear: [] }, { modelProfileId: "m", count: 1, wargear: ["Big gun"] }], isWarlord: false },
      { id: "u2", datasheetId: "cap", models: [{ modelProfileId: "c", count: 1, wargear: [] }], attachedTo: { unitId: "u1", role: "leader" }, enhancementId: "e1", isWarlord: true },
    ],
    ...over,
  };
}

const codes = (r: Roster) => validateRoster(r, snapshot, [constraints11e]).filter((d) => d.severity === "error").map((d) => d.code);

describe("costing", () => {
  it("tiered points by copy index, wargear and enhancements", () => {
    const r = roster({
      units: [
        { id: "a", datasheetId: "squad", models: [{ modelProfileId: "m", count: 9, wargear: [] }, { modelProfileId: "m", count: 1, wargear: ["Big gun"] }], isWarlord: false },
        { id: "b", datasheetId: "squad", models: [{ modelProfileId: "m", count: 5, wargear: [] }], isWarlord: false },
        { id: "c", datasheetId: "squad", models: [{ modelProfileId: "m", count: 5, wargear: [] }], isWarlord: false },
        { id: "d", datasheetId: "cap", models: [{ modelProfileId: "c", count: 1, wargear: [] }], enhancementId: "e1", isWarlord: true },
      ],
    });
    const ctx = createContext(r, snapshot);
    expect(ctx.unitCost(r.units[0]!).total).toBe(160 + 10);
    expect(ctx.unitCost(r.units[1]!).total).toBe(80);
    expect(ctx.unitCost(r.units[2]!).total).toBe(90); // third copy is dearer
    expect(ctx.unitCost(r.units[3]!).total).toBe(70 + 20);
    expect(ctx.totalPoints()).toBe(170 + 80 + 90 + 90);
  });
});

describe("11e constraints", () => {
  it("a legal roster has no errors", () => {
    expect(codes(roster())).toEqual([]);
  });
  it("points limit", () => {
    expect(codes(roster({ pointsLimit: 100 }))).toContain("points.limit");
  });
  it("detachment points, unique tags and duplicates", () => {
    expect(codes(roster({ detachments: [{ id: "d1", detachmentId: "detA" }, { id: "d2", detachmentId: "detC" }, { id: "d3", detachmentId: "detC" }] }))).toEqual(expect.arrayContaining(["detachments.dp", "detachments.duplicate"]));
    expect(codes(roster({ detachments: [{ id: "d1", detachmentId: "detA" }, { id: "d2", detachmentId: "detB" }] }))).toContain("detachments.unique");
    expect(codes(roster({ detachments: [] }))).toContain("detachments.none");
  });
  it("duplicate caps: battleline doubled, epic hero once", () => {
    const six = Array.from({ length: 6 }, (_, i) => ({ id: `s${i}`, datasheetId: "squad", models: [{ modelProfileId: "m", count: 5, wargear: [] }], isWarlord: false }));
    const seven = [...six, { id: "s7", datasheetId: "squad", models: [{ modelProfileId: "m", count: 5, wargear: [] }], isWarlord: false }];
    expect(codes(roster({ units: [...six, { id: "w", datasheetId: "cap", models: [{ modelProfileId: "c", count: 1, wargear: [] }], isWarlord: true }] }))).toEqual([]);
    expect(codes(roster({ units: seven }))).toContain("units.duplicates");
    const heroes = [1, 2].map((i) => ({ id: `h${i}`, datasheetId: "hero", models: [{ modelProfileId: "h", count: 1, wargear: [] }], isWarlord: i === 1 }));
    expect(codes(roster({ units: heroes }))).toContain("units.duplicates");
    const elites = [1, 2, 3, 4].map((i) => ({ id: `e${i}`, datasheetId: "elite", models: [{ modelProfileId: "m", count: 3, wargear: [] }], isWarlord: false }));
    expect(codes(roster({ units: elites }))).toContain("units.duplicates");
  });
  it("unit size", () => {
    expect(codes(roster({ units: [{ id: "u", datasheetId: "squad", models: [{ modelProfileId: "m", count: 11, wargear: [] }], isWarlord: false }] }))).toContain("units.size");
    expect(compositionBounds({ composition: [{ min: 1, max: 1 }, { min: 4, max: 9 }] })).toEqual({ min: 5, max: 10 });
    expect(compositionBounds({ composition: [{ min: 1 }, { min: 4, max: 9 }] })).toEqual({ min: 5, max: 10 });
    expect(compositionBounds({ composition: [{ min: 10, max: 20 }] })).toEqual({ min: 10, max: 20 });
    expect(compositionBounds({ composition: [{ min: 1 }] })).toEqual({ min: 1 });
  });
  it("leader / support legality", () => {
    const base = roster().units;
    const badHost = roster({ units: [{ id: "x", datasheetId: "elite", models: [{ modelProfileId: "m", count: 3, wargear: [] }], isWarlord: false }, { ...base[1]!, attachedTo: { unitId: "x", role: "leader" } }] });
    expect(codes(badHost)).toContain("characters.legality");
    const twoLeaders = roster({ units: [...base, { id: "u3", datasheetId: "cap", models: [{ modelProfileId: "c", count: 1, wargear: [] }], attachedTo: { unitId: "u1", role: "leader" }, isWarlord: false }] });
    expect(codes(twoLeaders)).toContain("characters.leaders");
    const supportAlone = roster({ units: [base[0]!, { id: "m1", datasheetId: "medic", models: [{ modelProfileId: "d", count: 1, wargear: [] }], attachedTo: { unitId: "u1", role: "support" }, isWarlord: true }] });
    expect(codes(supportAlone)).toContain("characters.support-needs-leader");
    const withLeader = roster({ units: [...base, { id: "m1", datasheetId: "medic", models: [{ modelProfileId: "d", count: 1, wargear: [] }], attachedTo: { unitId: "u1", role: "support" }, isWarlord: false }] });
    expect(codes(withLeader)).toEqual([]);
  });
  it("enhancements: unique, character-only, support-only, count, detachment", () => {
    const base = roster().units;
    expect(codes(roster({ units: [{ ...base[0]!, enhancementId: "e1" }, base[1]!] }))).toEqual(expect.arrayContaining(["enhancements.character", "enhancements.unique"]));
    expect(codes(roster({ units: [base[0]!, { ...base[1]!, enhancementId: "e2" }] }))).toContain("enhancements.support");
    expect(codes(roster({ detachments: [{ id: "d", detachmentId: "detC" }] }))).toContain("enhancements.detachment");
    const many = Array.from({ length: 5 }, (_, i) => ({ id: `c${i}`, datasheetId: "cap", models: [{ modelProfileId: "c", count: 1, wargear: [] }], enhancementId: "e1", isWarlord: i === 0 }));
    expect(codes(roster({ units: many }))).toContain("enhancements.count");
  });
  it("warlord", () => {
    expect(validateRoster(roster({ units: [roster().units[0]!] }), snapshot, [constraints11e]).some((d) => d.code === "warlord.none")).toBe(true);
  });
});
