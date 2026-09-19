import { describe, expect, it } from "vitest";
import type { Datasheet, Roster, RosterUnit, Snapshot } from "@grimstat/schema";
import { createContext, validateRoster } from "@grimstat/resolver";
import { constraints11e } from "./constraints";

const now = new Date().toISOString();
const model = { id: "m", name: "Model", T: 4, Sv: 3, W: 2 };

function sheet(id: string, factionId: string, factionKeywords: string[], keywords: string[], over: Partial<Datasheet> = {}): Datasheet {
  return { id, gameSystemId: "wh40k-11e", factionId, name: id, isLegends: false, isCharacter: keywords.includes("CHARACTER"), isEpicHero: false, isBattleline: keywords.includes("BATTLELINE"), isSupport: false, keywords, factionKeywords, models: [{ ...model, id: `${id}-m` }], weapons: [], abilityIds: [], stratagemIds: [], leaderTo: [], supportTo: [], composition: [{ description: "1 model", min: 1, max: 1 }], wargearOptions: [], ...over };
}

const faction = (id: string, name: string) => ({ id, gameSystemId: "wh40k-11e", name, keywords: [] });

const datasheets: Datasheet[] = [
  sheet("Intercessors", "sm", ["ADEPTUS ASTARTES"], ["IMPERIUM", "INFANTRY", "BATTLELINE"]),
  sheet("Captain", "sm", ["ADEPTUS ASTARTES"], ["IMPERIUM", "INFANTRY", "CHARACTER"]),
  sheet("Librarian", "sm", ["ADEPTUS ASTARTES"], ["IMPERIUM", "INFANTRY", "CHARACTER", "PSYKER"]),
  sheet("Impulsor", "sm", ["ADEPTUS ASTARTES"], ["IMPERIUM", "VEHICLE", "IMPULSOR", "DEDICATED TRANSPORT"]),
  sheet("Calgar", "sm", ["ADEPTUS ASTARTES", "ULTRAMARINES"], ["IMPERIUM", "INFANTRY", "CHARACTER"]),
  sheet("Sanguinary Guard", "ba", ["ADEPTUS ASTARTES", "BLOOD ANGELS"], ["IMPERIUM", "INFANTRY"]),
  sheet("Dante", "ba", ["ADEPTUS ASTARTES", "BLOOD ANGELS"], ["IMPERIUM", "INFANTRY", "CHARACTER"]),
  sheet("Deathwing Knights", "da", ["ADEPTUS ASTARTES", "DARK ANGELS"], ["IMPERIUM", "INFANTRY"]),
  sheet("Crusader Squad", "bt", ["ADEPTUS ASTARTES", "BLACK TEMPLARS"], ["IMPERIUM", "INFANTRY"]),
  sheet("Inquisitor", "agents", ["AGENTS OF THE IMPERIUM"], ["IMPERIUM", "INFANTRY", "CHARACTER"]),
  sheet("Assassin", "agents", ["AGENTS OF THE IMPERIUM"], ["IMPERIUM", "INFANTRY", "CHARACTER"]),
  sheet("Navigator", "agents", ["AGENTS OF THE IMPERIUM"], ["IMPERIUM", "INFANTRY", "CHARACTER"]),
  sheet("Breachers", "agents", ["AGENTS OF THE IMPERIUM"], ["IMPERIUM", "INFANTRY", "RETINUE"]),
  sheet("Sisters Squad", "agents", ["AGENTS OF THE IMPERIUM"], ["IMPERIUM", "INFANTRY", "REQUISITIONED"]),
  sheet("Agents Rhino", "agents", ["AGENTS OF THE IMPERIUM"], ["IMPERIUM", "VEHICLE", "DEDICATED TRANSPORT"]),
  sheet("Knight Paladin", "ik", ["IMPERIAL KNIGHTS"], ["IMPERIUM", "VEHICLE", "WALKER", "TITANIC", "CHARACTER"]),
  sheet("Armiger", "ik", ["IMPERIAL KNIGHTS"], ["IMPERIUM", "VEHICLE", "WALKER", "ARMIGER"]),
  sheet("Warriors", "necrons", ["NECRONS"], ["INFANTRY", "BATTLELINE"]),
  sheet("Legionaries", "csm", ["HERETIC ASTARTES"], ["CHAOS", "INFANTRY", "BATTLELINE"]),
  sheet("Chaos Lord", "csm", ["HERETIC ASTARTES"], ["CHAOS", "INFANTRY", "CHARACTER"]),
  sheet("Bloodletters", "daemons", ["LEGIONES DAEMONICA"], ["CHAOS", "DAEMON", "KHORNE", "INFANTRY", "BATTLELINE"]),
  sheet("Bloodcrushers", "daemons", ["LEGIONES DAEMONICA"], ["CHAOS", "DAEMON", "KHORNE", "MOUNTED"]),
  sheet("Bloodthirster", "daemons", ["LEGIONES DAEMONICA"], ["CHAOS", "DAEMON", "KHORNE", "MONSTER", "CHARACTER"]),
  sheet("Canis Rex", "ik", ["IMPERIAL KNIGHTS"], ["IMPERIUM", "VEHICLE", "TITANIC", "CHARACTER", "EPIC HERO"], { isEpicHero: true, abilityIds: [] }),
  sheet("Sir Hekhtur", "ik", ["IMPERIAL KNIGHTS"], ["IMPERIUM", "INFANTRY", "CHARACTER", "EPIC HERO"], { isEpicHero: true, abilityIds: ["using-hekhtur"] }),
];

const snapshot: Snapshot = {
  id: "snap_allies",
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
    factions: [faction("sm", "Space Marines"), faction("ba", "Blood Angels"), faction("da", "Dark Angels"), faction("bt", "Black Templars"), faction("agents", "Imperial Agents"), faction("ik", "Imperial Knights"), faction("necrons", "Necrons"), faction("csm", "Chaos Space Marines"), faction("daemons", "Chaos Daemons")],
    publications: [],
    datasheets,
    abilities: [{ id: "using-hekhtur", name: "Using Sir Hekhtur", scope: "other", text: "If your Canis Rex model is destroyed, this model is treated as a model disembarking.", isLegends: false }],
    detachments: [{ id: "det-sm", factionId: "sm", name: "Gladius", dp: 1, forceDispositions: [], ruleAbilityIds: [], enhancementIds: [], stratagemIds: [] }],
    enhancements: [],
    stratagems: [],
    priceRules: datasheets.filter((d) => d.id !== "Sir Hekhtur").map((d) => ({ datasheetId: d.id, copyRange: { min: 1 }, tiers: [{ models: 1, points: d.id === "Bloodthirster" ? 300 : 100 }] })),
    wargearPrices: [],
  },
};

let n = 0;
const unit = (datasheetId: string, over: Partial<RosterUnit> = {}): RosterUnit => ({ id: `u${++n}`, datasheetId, models: [{ modelProfileId: `${datasheetId}-m`, count: 1, wargear: [] }], isWarlord: false, ...over });

function roster(factionId: string, units: RosterUnit[], over: Partial<Roster> = {}): Roster {
  return { id: "r", ownerId: "local", createdAt: now, updatedAt: now, revision: 0, name: "test", gameSystemId: "wh40k-11e", snapshotId: snapshot.id, factionId, battleSize: "strike-force", pointsLimit: 2000, detachments: [], units, ...over };
}

const codes = (r: Roster, prefix: string) => validateRoster(r, snapshot, [constraints11e]).filter((d) => d.code.startsWith(prefix)).map((d) => `${d.severity}:${d.code}`);

describe("chapters", () => {
  it("files plain Space Marines units as a Blood Angels army's own", () => {
    const r = roster("ba", [unit("Dante", { isWarlord: true }), unit("Sanguinary Guard"), unit("Intercessors"), unit("Captain")]);
    expect(codes(r, "allies")).toEqual([]);
    expect(codes(r, "chapter")).toEqual([]);
  });
  it("refuses a second Chapter's units", () => {
    expect(codes(roster("ba", [unit("Dante"), unit("Deathwing Knights")]), "chapter")).toEqual(["error:chapter.mixed"]);
    expect(codes(roster("sm", [unit("Calgar"), unit("Dante")]), "chapter")).toEqual(["error:chapter.mixed"]);
    expect(codes(roster("sm", [unit("Calgar"), unit("Intercessors")]), "chapter")).toEqual([]);
  });
  it("keeps psykers and un-keyworded vehicles out of a Black Templars army", () => {
    expect(codes(roster("bt", [unit("Crusader Squad"), unit("Librarian"), unit("Impulsor")]), "chapter")).toEqual(["error:chapter.templars", "error:chapter.templars"]);
  });
});

describe("Assigned Agents", () => {
  it("admits agents within the battle-size limits", () => {
    const r = roster("sm", [unit("Captain", { isWarlord: true }), unit("Intercessors"), unit("Inquisitor"), unit("Assassin"), unit("Breachers"), unit("Sisters Squad")]);
    expect(codes(r, "allies")).toEqual([]);
  });
  it("counts characters, retinues and requisitioned units separately", () => {
    const three = roster("sm", [unit("Captain"), unit("Inquisitor"), unit("Assassin"), unit("Navigator")]);
    expect(codes(three, "allies")).toEqual(["error:allies.agents.count"]);
    const twoReq = roster("sm", [unit("Captain"), unit("Sisters Squad"), unit("Sisters Squad")]);
    expect(codes(twoReq, "allies")).toEqual(["error:allies.agents.count"]);
    const onslaught = roster("sm", [unit("Captain"), unit("Inquisitor"), unit("Assassin"), unit("Navigator")], { battleSize: "onslaught", pointsLimit: 3000 });
    expect(codes(onslaught, "allies")).toEqual([]);
  });
  it("needs every model to have IMPERIUM, and a transport to carry something", () => {
    expect(codes(roster("sm", [unit("Captain"), unit("Inquisitor"), unit("Warriors")]), "allies")).toEqual(["error:allies.agents.imperium", "warn:allies.unknown"]);
    const rhino = unit("Agents Rhino");
    expect(codes(roster("sm", [unit("Captain"), rhino]), "allies")).toEqual(["warn:allies.agents.transport"]);
    expect(codes(roster("sm", [unit("Captain"), rhino, unit("Intercessors", { embarkedIn: rhino.id })]), "allies")).toEqual([]);
  });
});

describe("Freeblades", () => {
  it("admits one Titanic knight or three Armigers, never as Warlord", () => {
    expect(codes(roster("sm", [unit("Captain"), unit("Knight Paladin")]), "allies")).toEqual([]);
    expect(codes(roster("sm", [unit("Captain"), unit("Armiger"), unit("Armiger"), unit("Armiger")]), "allies")).toEqual([]);
    expect(codes(roster("sm", [unit("Captain"), unit("Armiger"), unit("Armiger"), unit("Armiger"), unit("Armiger")]), "allies")).toEqual(["error:allies.knights.small"]);
    expect(codes(roster("sm", [unit("Captain"), unit("Knight Paladin"), unit("Armiger")]), "allies")).toEqual(["error:allies.knights.mix"]);
    expect(codes(roster("sm", [unit("Captain"), unit("Knight Paladin", { isWarlord: true })]), "allies")).toEqual(["error:allies.warlord"]);
  });
});

describe("Daemonic Pact", () => {
  it("caps the points and keeps the gods' Battleline ahead", () => {
    expect(codes(roster("csm", [unit("Chaos Lord"), unit("Legionaries"), unit("Bloodletters"), unit("Bloodcrushers")]), "allies")).toEqual([]);
    expect(codes(roster("csm", [unit("Chaos Lord"), unit("Bloodcrushers")]), "allies")).toEqual(["error:allies.daemons.battleline"]);
    expect(codes(roster("csm", [unit("Chaos Lord"), unit("Bloodletters"), unit("Bloodletters"), unit("Bloodthirster"), unit("Bloodcrushers")]), "allies")).toEqual(["error:allies.daemons.points", "error:allies.daemons.points", "error:allies.daemons.points", "error:allies.daemons.points"]);
    expect(codes(roster("csm", [unit("Chaos Lord"), unit("Bloodletters"), unit("Bloodcrushers")], { battleSize: "onslaught", pointsLimit: 3000 }), "allies")).toEqual([]);
  });
  it("needs a Chaos Knights or Heretic Astartes army", () => {
    expect(codes(roster("necrons", [unit("Warriors"), unit("Bloodletters")]), "allies")).toEqual(["error:allies.daemons.family"]);
  });
});

describe("tied units", () => {
  it("prices Sir Hekhtur at nothing and wants Canis Rex beside him", () => {
    const withHost = roster("ik", [unit("Canis Rex"), unit("Sir Hekhtur")]);
    const ctx = createContext(withHost, snapshot);
    expect(ctx.unitCost(withHost.units[1]!)).toMatchObject({ total: 0, notes: [] });
    expect(codes(withHost, "units.companion")).toEqual([]);
    expect(codes(withHost, "points.unknown")).toEqual([]);
    expect(codes(roster("ik", [unit("Sir Hekhtur")]), "units.companion")).toEqual(["error:units.companion"]);
    expect(codes(roster("ik", [unit("Canis Rex"), unit("Sir Hekhtur"), unit("Sir Hekhtur")]), "units.companion")).toEqual(["error:units.companion"]);
  });
});
