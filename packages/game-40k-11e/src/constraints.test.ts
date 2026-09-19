import { describe, expect, it } from "vitest";
import type { Roster, Snapshot } from "@grimstat/schema";
import { createContext, validateRoster } from "@grimstat/resolver";
import { constraints11e } from "./constraints";
import { compositionBounds } from "./composition";

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
      { id: "squad", gameSystemId: "wh40k-11e", factionId: "f1", name: "Test Squad", isLegends: false, isCharacter: false, isEpicHero: false, isBattleline: true, isSupport: false, keywords: ["INFANTRY", "BATTLELINE"], factionKeywords: [], models: [model], weapons: [], abilityIds: [], stratagemIds: [], leaderTo: [], supportTo: [], composition: [{ description: "5-10 models", min: 5, max: 10 }], wargearOptions: [] },
      { id: "elite", gameSystemId: "wh40k-11e", factionId: "f1", name: "Test Elites", isLegends: false, isCharacter: false, isEpicHero: false, isBattleline: false, isSupport: false, keywords: ["INFANTRY"], factionKeywords: [], models: [model], weapons: [], abilityIds: [], stratagemIds: [], leaderTo: [], supportTo: [], composition: [{ description: "3-6 models", min: 3, max: 6 }], wargearOptions: [] },
      { id: "cap", gameSystemId: "wh40k-11e", factionId: "f1", name: "Test Captain", isLegends: false, isCharacter: true, isEpicHero: false, isBattleline: false, isSupport: false, keywords: ["CHARACTER", "INFANTRY"], factionKeywords: [], models: [{ ...model, id: "c", name: "Captain", W: 5 }], weapons: [], abilityIds: [], stratagemIds: [], leaderTo: ["squad"], supportTo: [], composition: [{ description: "1 model", min: 1, max: 1 }], wargearOptions: [] },
      { id: "medic", gameSystemId: "wh40k-11e", factionId: "f1", name: "Test Medic", isLegends: false, isCharacter: true, isEpicHero: false, isBattleline: false, isSupport: true, keywords: ["CHARACTER", "INFANTRY"], factionKeywords: [], models: [{ ...model, id: "d", name: "Medic", W: 4 }], weapons: [], abilityIds: [], stratagemIds: [], leaderTo: [], supportTo: ["squad"], composition: [{ description: "1 model", min: 1, max: 1 }], wargearOptions: [] },
      { id: "hero", gameSystemId: "wh40k-11e", factionId: "f1", name: "Test Epic Hero", isLegends: false, isCharacter: true, isEpicHero: true, isBattleline: false, isSupport: false, keywords: ["CHARACTER", "EPIC HERO"], factionKeywords: [], models: [{ ...model, id: "h", name: "Hero", W: 6 }], weapons: [], abilityIds: [], stratagemIds: [], leaderTo: ["squad"], supportTo: [], composition: [{ description: "1 model", min: 1, max: 1 }], wargearOptions: [] },
      { id: "rhino", gameSystemId: "wh40k-11e", factionId: "f1", name: "Test Rhino", isLegends: false, isCharacter: false, isEpicHero: false, isBattleline: false, isSupport: false, transportCapacity: "This model has a transport capacity of 12 INFANTRY models. Each TERMINATOR model takes up the space of 2 models. It cannot transport JUMP PACK models.", keywords: ["VEHICLE", "TRANSPORT", "DEDICATED TRANSPORT"], factionKeywords: [], models: [{ ...model, id: "rh", name: "Rhino", T: 9, W: 10 }], weapons: [], abilityIds: [], stratagemIds: [], leaderTo: [], supportTo: [], composition: [{ description: "1 model", min: 1, max: 1 }], wargearOptions: [] },
      { id: "termies", gameSystemId: "wh40k-11e", factionId: "f1", name: "Test Terminators", isLegends: false, isCharacter: false, isEpicHero: false, isBattleline: false, isSupport: false, keywords: ["INFANTRY", "TERMINATOR"], factionKeywords: [], models: [{ ...model, id: "t", name: "Terminator", W: 3 }], weapons: [], abilityIds: [], stratagemIds: [], leaderTo: [], supportTo: [], composition: [{ description: "5-10 models", min: 5, max: 10 }], wargearOptions: [] },
      { id: "jumpers", gameSystemId: "wh40k-11e", factionId: "f1", name: "Test Assault Squad", isLegends: false, isCharacter: false, isEpicHero: false, isBattleline: false, isSupport: false, keywords: ["INFANTRY", "JUMP PACK", "FLY"], factionKeywords: [], models: [{ ...model, id: "j", name: "Jumper" }], weapons: [], abilityIds: [], stratagemIds: [], leaderTo: [], supportTo: [], composition: [{ description: "5-10 models", min: 5, max: 10 }], wargearOptions: [] },
      { id: "tank", gameSystemId: "wh40k-11e", factionId: "f1", name: "Test Tank", isLegends: false, isCharacter: false, isEpicHero: false, isBattleline: false, isSupport: false, keywords: ["VEHICLE"], factionKeywords: [], models: [{ ...model, id: "tk", name: "Tank", T: 11, W: 14 }], weapons: [], abilityIds: [], stratagemIds: [], leaderTo: [], supportTo: [], composition: [{ description: "1 model", min: 1, max: 1 }], wargearOptions: [] },
      { id: "immolator", gameSystemId: "wh40k-11e", factionId: "f1", name: "Test Immolator", isLegends: false, isCharacter: false, isEpicHero: false, isBattleline: false, isSupport: false, transportCapacity: "This model has a transport capacity of 6 INFANTRY models. At the start of the Declare Battle Formations step, you can select one TEST SQUAD from your army. If you do, that unit is split into two units, each containing as equal a number of models as possible. One of these units must start the battle embarked within this TRANSPORT; the other can start the battle embarked within another TRANSPORT, or it can be deployed as a separate unit.", keywords: ["VEHICLE", "TRANSPORT", "DEDICATED TRANSPORT"], factionKeywords: [], models: [{ ...model, id: "im", name: "Immolator", T: 10, W: 11 }], weapons: [], abilityIds: [], stratagemIds: [], leaderTo: [], supportTo: [], composition: [{ description: "1 model", min: 1, max: 1 }], wargearOptions: [] },
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
      { datasheetId: "rhino", copyRange: { min: 1 }, tiers: [{ models: 1, points: 75 }] },
      { datasheetId: "termies", copyRange: { min: 1 }, tiers: [{ models: 5, points: 170 }, { models: 10, points: 340 }] },
      { datasheetId: "jumpers", copyRange: { min: 1 }, tiers: [{ models: 5, points: 90 }, { models: 10, points: 180 }] },
      { datasheetId: "tank", copyRange: { min: 1 }, tiers: [{ models: 1, points: 150 }] },
      { datasheetId: "immolator", copyRange: { min: 1 }, tiers: [{ models: 1, points: 90 }] },
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
  /**
   * The weapons check lives in `loadout.ts` and was only ever shown beside the calculator, so an
   * army could carry a loadout its datasheet does not offer and the army checks said nothing.
   */
  it("reports a unit carrying weapons its datasheet does not offer", () => {
    const sheet = {
      ...snapshot.data.datasheets.find((d) => d.id === "tank")!,
      id: "walker",
      name: "Test Walker",
      loadout: "This model is equipped with: heavy gun; claws.",
      wargearOptions: ["This model's heavy gun can be replaced with 1 flamer."],
      weapons: [
        { id: "w1", name: "Heavy gun", kind: "ranged" as const, range: 24, A: "2", skill: 3, S: 6, AP: 1, D: "2", keywords: [] },
        { id: "w2", name: "Flamer", kind: "ranged" as const, range: 12, A: "D6", skill: null, S: 4, AP: 0, D: "1", keywords: [] },
        { id: "w3", name: "Claws", kind: "melee" as const, range: null, A: "4", skill: 3, S: 7, AP: 2, D: "2", keywords: [] },
      ],
    };
    const snap = { ...snapshot, data: { ...snapshot.data, datasheets: [...snapshot.data.datasheets, sheet] } };
    const withWargear = (wargear: string[]): Roster => ({ ...roster(), units: [{ id: "w", datasheetId: "walker", models: [{ modelProfileId: "tk", count: 1, wargear }], isWarlord: false }] });
    const swapped = validateRoster(withWargear(["Flamer", "Claws"]), snap, [constraints11e]).map((d) => d.code);
    expect(swapped).not.toContain("units.wargear");
    const both = validateRoster(withWargear(["Heavy gun", "Flamer", "Claws"]), snap, [constraints11e]).filter((d) => d.code === "units.wargear");
    expect(both).toHaveLength(1);
    expect(both[0]!.message).toContain("Flamer");
  });

  /**
   * A model count on its own cannot say a squad may hold one sergeant: five sergeants and no
   * troopers is five models, which is what a squad of five is.
   */
  it("reports a unit built from the wrong models, once its size is right", () => {
    const sheet = {
      ...snapshot.data.datasheets.find((d) => d.id === "squad")!,
      id: "mixed",
      name: "Test Mixed Squad",
      models: [
        { id: "sgt", name: "Sergeant", T: 4, Sv: 3, W: 2 },
        { id: "trooper", name: "Trooper", T: 4, Sv: 4, W: 1 },
      ],
      composition: [
        { description: "1 Sergeant", min: 1, max: 1 },
        { description: "4-9 Troopers", min: 4, max: 9 },
      ],
    };
    const snap = { ...snapshot, data: { ...snapshot.data, datasheets: [...snapshot.data.datasheets, sheet] } };
    const built = (models: Array<{ modelProfileId: string; count: number }>): Roster => ({ ...roster(), units: [{ id: "m", datasheetId: "mixed", models: models.map((m) => ({ ...m, wargear: [] })), isWarlord: false }] });
    expect(validateRoster(built([{ modelProfileId: "sgt", count: 1 }, { modelProfileId: "trooper", count: 4 }]), snap, [constraints11e]).map((d) => d.code)).not.toContain("units.models");
    const wrong = validateRoster(built([{ modelProfileId: "sgt", count: 5 }]), snap, [constraints11e]).filter((d) => d.code === "units.models");
    expect(wrong.map((d) => d.message)).toEqual(["Test Mixed Squad has 5 Sergeant; the unit takes 1.", "Test Mixed Squad has 0 Trooper; the unit takes 4 to 9."]);
    // A unit of the wrong size is reported as one, and not again model by model.
    expect(validateRoster(built([{ modelProfileId: "sgt", count: 2 }]), snap, [constraints11e]).map((d) => d.code)).toEqual(expect.arrayContaining(["units.size"]));
    expect(validateRoster(built([{ modelProfileId: "sgt", count: 2 }]), snap, [constraints11e]).map((d) => d.code)).not.toContain("units.models");
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
    // "OR" between two lines makes them alternatives: the unit is one of them, never both.
    expect(compositionBounds({ composition: [{ description: "1 Runtherd and 10 Gretchin", min: 11, max: 11 }, { description: "OR" }, { description: "2 Runtherds and 20 Gretchin", min: 22, max: 22 }] })).toEqual({ min: 11, max: 22 });
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

describe("transports and reserves", () => {
  type Unit = Roster["units"][number];
  const all = (r: Roster) => validateRoster(r, snapshot, [constraints11e]);
  const unit = (id: string, datasheetId: string, count: number, extra: Partial<Unit> = {}): Unit => ({ id, datasheetId, models: [{ modelProfileId: "m", count, wargear: [] }], isWarlord: false, ...extra });
  const rhino = (extra: Partial<Unit> = {}) => unit("rh1", "rhino", 1, extra);
  const captain = (extra: Partial<Unit> = {}) => unit("cap1", "cap", 1, { isWarlord: true, ...extra });

  it("a unit that fits reports the load as info", () => {
    const r = roster({ units: [rhino(), unit("s1", "squad", 10, { embarkedIn: "rh1" }), captain()] });
    const d = all(r);
    expect(d.filter((x) => x.severity === "error")).toEqual([]);
    expect(d.find((x) => x.code === "transport.capacity")).toMatchObject({ severity: "info", message: "Test Rhino carries 10 / 12.", path: "/units/0" });
  });
  it("over capacity is an error naming the transport, occupancy and capacity", () => {
    const r = roster({ units: [rhino(), unit("s1", "squad", 10, { embarkedIn: "rh1" }), unit("e1", "elite", 3, { embarkedIn: "rh1" }), captain()] });
    const err = all(r).find((x) => x.code === "transport.capacity");
    expect(err).toMatchObject({ severity: "error", message: "Test Rhino carries 13 models; its transport capacity is 12.", fix: "Disembark a unit.", path: "/units/0" });
  });
  it("size multiplier: each TERMINATOR takes two slots", () => {
    expect(codes(roster({ units: [rhino(), unit("t1", "termies", 6, { embarkedIn: "rh1" }), captain()] }))).toEqual([]);
    expect(all(roster({ units: [rhino(), unit("t1", "termies", 6, { embarkedIn: "rh1" }), captain()] })).find((x) => x.code === "transport.capacity")?.message).toBe("Test Rhino carries 12 / 12.");
    expect(codes(roster({ units: [rhino(), unit("t1", "termies", 7, { embarkedIn: "rh1" }), captain()] }))).toContain("transport.capacity");
    expect(codes(roster({ units: [rhino(), unit("t1", "termies", 5, { embarkedIn: "rh1" }), unit("s1", "squad", 5, { embarkedIn: "rh1" }), captain()] }))).toContain("transport.capacity");
  });
  it("excluded keyword", () => {
    const d = all(roster({ units: [rhino(), unit("j1", "jumpers", 5, { embarkedIn: "rh1" }), captain()] }));
    expect(d.find((x) => x.code === "transport.excluded")).toMatchObject({ severity: "error", message: "Test Rhino cannot transport Test Assault Squad (JUMP PACK models).", path: "/units/1" });
    expect(d.some((x) => x.code === "transport.keywords")).toBe(false);
  });
  it("keyword mismatch and embarking in something that is not a transport", () => {
    const d = all(roster({ units: [rhino(), unit("tk1", "tank", 1, { embarkedIn: "rh1" }), captain()] }));
    expect(d.find((x) => x.code === "transport.keywords")).toMatchObject({ severity: "error", message: "Test Rhino cannot transport Test Tank (only INFANTRY models).", path: "/units/1" });
    const notTransport = all(roster({ units: [unit("tk1", "tank", 1), unit("s1", "squad", 5, { embarkedIn: "tk1" }), captain()] }));
    expect(notTransport.find((x) => x.code === "transport.none")).toMatchObject({ severity: "error", message: "Test Squad is embarked in Test Tank, which is not a transport.", path: "/units/1" });
    expect(notTransport.some((x) => x.code === "transport.capacity")).toBe(false);
  });
  it("transport not in the army", () => {
    const d = all(roster({ units: [unit("s1", "squad", 5, { embarkedIn: "ghost" }), captain()] }));
    expect(d.find((x) => x.code === "transport.missing")).toMatchObject({ severity: "error", message: "Test Squad is embarked in a unit that is not in the army.", path: "/units/0" });
  });
  it("a transport embarked in a transport is ignored with a warning", () => {
    const d = all(roster({ units: [rhino(), unit("rh2", "rhino", 1, { embarkedIn: "rh1" }), captain()] }));
    expect(d.find((x) => x.code === "transport.nested")?.severity).toBe("warn");
    expect(d.some((x) => x.code === "transport.capacity")).toBe(false);
  });
  it("attached characters ride with their host and count towards capacity", () => {
    const base = [rhino(), unit("s1", "squad", 5, { embarkedIn: "rh1" }), unit("e1", "elite", 6, { embarkedIn: "rh1" })];
    const withLeader = all(roster({ units: [...base, captain({ attachedTo: { unitId: "s1", role: "leader" } })] }));
    expect(withLeader.filter((x) => x.severity === "error")).toEqual([]);
    expect(withLeader.find((x) => x.code === "transport.capacity")?.message).toBe("Test Rhino carries 12 / 12.");
    const withBoth = all(roster({ units: [...base, captain({ attachedTo: { unitId: "s1", role: "leader" } }), unit("md1", "medic", 1, { attachedTo: { unitId: "s1", role: "support" } })] }));
    expect(withBoth.find((x) => x.code === "transport.capacity")).toMatchObject({ severity: "error", message: "Test Rhino carries 13 models; its transport capacity is 12." });
    // A character that also lists its own embarkation is warned about and not counted twice.
    const doubled = all(roster({ units: [rhino(), unit("s1", "squad", 10, { embarkedIn: "rh1" }), captain({ attachedTo: { unitId: "s1", role: "leader" }, embarkedIn: "rh1" })] }));
    expect(doubled.find((x) => x.code === "transport.attached")?.severity).toBe("warn");
    expect(doubled.find((x) => x.code === "transport.capacity")?.message).toBe("Test Rhino carries 11 / 12.");
    // An attached character that does not fit the transport is reported by name.
    const badRider = all(roster({ units: [rhino(), unit("s1", "squad", 5, { embarkedIn: "rh1" }), captain({ attachedTo: { unitId: "s1", role: "leader" }, datasheetId: "jumpers", models: [{ modelProfileId: "j", count: 1, wargear: [] }] })] }));
    expect(badRider.find((x) => x.code === "transport.excluded")?.message).toBe("Test Rhino cannot transport Test Assault Squad (JUMP PACK models).");
  });
  it("reserves: silent when nothing is reserved, info under the limit, error over it", () => {
    expect(all(roster()).some((x) => x.code === "reserves.limit")).toBe(false);
    // Strike Force: 25% of 2000 = 500 (assumed). Squad of 10 = 160.
    const under = all(roster({ units: [unit("s1", "squad", 10, { inReserves: true }), captain()] }));
    expect(under.find((x) => x.code === "reserves.limit")).toMatchObject({ severity: "info", message: "160 / 500 points in Reserves (assumed)." });
    // 160 + 200 + 170 = 530 > 500
    const over = all(roster({ units: [unit("s1", "squad", 10, { inReserves: true }), unit("e1", "elite", 6, { inReserves: true }), unit("t1", "termies", 5, { inReserves: true }), captain()] }));
    expect(over.find((x) => x.code === "reserves.limit")).toMatchObject({ severity: "error", message: "530 points start in Reserves; the limit is 500 (assumed).", fix: "Deploy a unit on the battlefield instead." });
    // An attached character (70 + enhancement 20) counts with its reserved host: 160 + 90 = 250 fits exactly at 1000 points, 251 would not.
    const attached = all(roster({ pointsLimit: 1000, battleSize: "incursion", units: [unit("s1", "squad", 10, { inReserves: true }), captain({ attachedTo: { unitId: "s1", role: "leader" }, enhancementId: "e1" })] }));
    expect(attached.find((x) => x.code === "reserves.limit")).toMatchObject({ severity: "info", message: "250 / 250 points in Reserves (assumed)." });
  });
  it("units embarked in a reserved transport are in Reserves too", () => {
    // Rhino 75 + squad 160 = 235 of 250 (Incursion, 1000 points).
    const base = [rhino({ inReserves: true }), unit("s1", "squad", 10, { embarkedIn: "rh1" })];
    const fits = all(roster({ pointsLimit: 1000, battleSize: "incursion", units: [...base, captain()] }));
    expect(fits.find((x) => x.code === "reserves.limit")).toMatchObject({ severity: "info", message: "235 / 250 points in Reserves (assumed)." });
    // Attaching the captain (70) to the embarked squad pulls him into Reserves as well: 305 > 250.
    const over = all(roster({ pointsLimit: 1000, battleSize: "incursion", units: [...base, captain({ attachedTo: { unitId: "s1", role: "leader" } })] }));
    expect(over.find((x) => x.code === "reserves.limit")).toMatchObject({ severity: "error", message: "305 points start in Reserves; the limit is 250 (assumed)." });
    // A transport embarked in a reserved transport does not recurse forever.
    expect(() => all(roster({ units: [rhino({ embarkedIn: "rh2" }), unit("rh2", "rhino", 1, { embarkedIn: "rh1" }), captain()] }))).not.toThrow();
  });
});

describe("a unit split in two for deployment", () => {
  const squad = (id: string, count: number, over: Partial<Roster["units"][number]> = {}): Roster["units"][number] => ({ id, datasheetId: "squad", models: [{ modelProfileId: "m", count, wargear: [] }], isWarlord: false, ...over });
  const immolator = (id: string): Roster["units"][number] => ({ id, datasheetId: "immolator", models: [{ modelProfileId: "im", count: 1, wargear: [] }], isWarlord: false });
  const all = (r: Roster) => validateRoster(r, snapshot, [constraints11e]);
  const withCode = (r: Roster, code: string) => all(r).filter((d) => d.code === code);

  it("is priced and sized as one unit, with the second half free", () => {
    const r = roster({ units: [immolator("t"), squad("a", 5, { embarkedIn: "t" }), squad("b", 5, { halfOf: "a" })] });
    const ctx = createContext(r, snapshot);
    expect(ctx.unitCost(r.units[1]!)).toMatchObject({ base: 160, total: 160, modelCount: 10, copyIndex: 1, notes: [] });
    expect(ctx.unitCost(r.units[2]!)).toMatchObject({ base: 0, total: 0, modelCount: 5, copyIndex: 1 });
    expect(ctx.copies("squad").map((u) => u.id)).toEqual(["a"]);
    expect(codes(r)).not.toContain("units.size");
    expect(codes(r)).not.toContain("units.split.rule");
    expect(withCode(r, "transport.capacity").map((d) => d.severity)).toEqual(["info"]);
  });
  it("counts the whole unit once against the duplicate limit", () => {
    const r = roster({ battleSize: "incursion", pointsLimit: 1000, units: [immolator("t"), squad("a", 5), squad("b", 5, { halfOf: "a" }), squad("c", 5), squad("d", 5, { halfOf: "c" })] });
    expect(codes(r)).not.toContain("units.duplicates");
  });
  it("wants a rule in the army that can split it", () => {
    const r = roster({ units: [squad("a", 5), squad("b", 5, { halfOf: "a" })] });
    expect(withCode(r, "units.split.rule").map((d) => d.message)).toEqual(["Test Squad is split in two, but nothing in the army can split it."]);
  });
  it("lets each rule split one unit", () => {
    const r = roster({ units: [immolator("t"), squad("a", 5, { embarkedIn: "t" }), squad("b", 5, { halfOf: "a" }), squad("c", 5), squad("d", 5, { halfOf: "c" })] });
    expect(withCode(r, "units.split.rule").map((d) => d.path)).toEqual(["/units/3"]);
    const two = roster({ units: [immolator("t"), immolator("t2"), squad("a", 5, { embarkedIn: "t" }), squad("b", 5, { halfOf: "a" }), squad("c", 5, { embarkedIn: "t2" }), squad("d", 5, { halfOf: "c" })] });
    expect(withCode(two, "units.split.rule")).toEqual([]);
  });
  it("wants one half aboard the transport whose rule split it", () => {
    const r = roster({ units: [immolator("t"), squad("a", 5), squad("b", 5, { halfOf: "a" })] });
    expect(withCode(r, "units.split.embark").map((d) => [d.severity, d.message])).toEqual([["warn", "One half of Test Squad must start the battle embarked in Test Immolator, which splits it."]]);
    const aboard = roster({ units: [immolator("t"), squad("a", 5), squad("b", 5, { halfOf: "a", embarkedIn: "t" })] });
    expect(withCode(aboard, "units.split.embark")).toEqual([]);
  });
  it("wants the halves as equal as possible", () => {
    const r = roster({ units: [immolator("t"), squad("a", 7, { embarkedIn: "t" }), squad("b", 3, { halfOf: "a" })] });
    expect(withCode(r, "units.split.equal").map((d) => d.message)).toEqual(["Test Squad is split 7 and 3; the halves must be as equal as possible."]);
    expect(withCode(r, "transport.capacity").map((d) => d.severity)).toEqual(["error"]);
  });
  it("reports a second half whose unit is gone", () => {
    const r = roster({ units: [squad("b", 5, { halfOf: "zz" })] });
    expect(codes(r)).toContain("units.split.orphan");
  });
});
