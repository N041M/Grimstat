import { describe, expect, it } from "vitest";
import type { Datasheet, Roster, Snapshot, Stratagem } from "@grimstat/schema";
import { cpRange, filterStratagems, groupStratagems, stratagemParts, stratagemPhases, stratagemsForRoster } from "./stratagems";

const NOW = "2026-09-12T10:00:00.000Z";

function sheet(id: string, name: string, stratagemIds: string[] = []): Datasheet {
  return {
    id,
    name,
    gameSystemId: "wh40k-11e",
    factionId: "f1",
    isLegends: false,
    isCharacter: false,
    isEpicHero: false,
    isBattleline: false,
    isSupport: false,
    keywords: [],
    factionKeywords: [],
    models: [{ id: `${id}-m`, name, T: 4, Sv: 3, W: 2 }],
    weapons: [],
    abilityIds: [],
    stratagemIds,
    leaderTo: [],
    supportTo: [],
    composition: [],
    wargearOptions: [],
  };
}

function strat(over: Partial<Stratagem> & Pick<Stratagem, "id" | "name">): Stratagem {
  return { cpCost: 1, phases: [], ...over };
}

const squad = sheet("ds-squad", "Warden Squad", ["st-volley"]);
const captain = sheet("ds-captain", "Warden Captain", ["st-volley", "st-hold"]);
const crusher = sheet("ds-crusher", "Ashen Crusher");

const snapshot: Snapshot = {
  id: "snap-1",
  gameSystemId: "wh40k-11e",
  ownerId: "local",
  createdAt: NOW,
  updatedAt: NOW,
  revision: 0,
  sources: [],
  checksum: "x",
  conflicts: [],
  data: {
    gameSystem: { id: "wh40k-11e", name: "Test", edition: "11", costTypes: [] },
    factions: [{ id: "f1", gameSystemId: "wh40k-11e", name: "Ashen Wardens", keywords: [] }],
    publications: [],
    datasheets: [squad, captain, crusher],
    abilities: [],
    detachments: [
      { id: "det-ember", factionId: "f1", name: "Ember Vanguard", dp: 2, forceDispositions: [], ruleAbilityIds: [], enhancementIds: [], stratagemIds: [] },
      { id: "det-other", factionId: "f1", name: "Thorn Host", dp: 2, forceDispositions: [], ruleAbilityIds: [], enhancementIds: [], stratagemIds: [] },
    ],
    enhancements: [],
    stratagems: [
      strat({ id: "st-volley", name: "Covering Volley", detachmentId: "det-ember", factionId: "f1", cpCost: 1, phases: ["Shooting"], when: "Your Shooting phase.", target: "One unit.", effect: "Re-roll hit rolls of 1." }),
      strat({ id: "st-hold", name: "Hold Fast", detachmentId: "det-ember", factionId: "f1", cpCost: 2, phases: ["Opponent's Shooting"], text: "This unit has the Benefit of Cover." }),
      strat({ id: "st-thorn", name: "Surge of Thorns", detachmentId: "det-other", factionId: "f1", cpCost: 1, phases: ["Fight"] }),
      strat({ id: "st-faction", name: "Ashen Resolve", factionId: "f1", cpCost: 1, phases: ["Fight"] }),
      strat({ id: "st-alien", name: "Verdant Surge", factionId: "f2", cpCost: 1, phases: ["Fight"] }),
      strat({ id: "st-core", name: "Command Re-roll", cpCost: 1, phases: ["Any"], effect: "Re-roll one test." }),
    ],
    priceRules: [],
    wargearPrices: [],
  },
};

const roster: Roster = {
  id: "r1",
  name: "Review army",
  ownerId: "local",
  createdAt: NOW,
  updatedAt: NOW,
  revision: 1,
  gameSystemId: "wh40k-11e",
  snapshotId: "snap-1",
  factionId: "f1",
  battleSize: "strike-force",
  pointsLimit: 2000,
  detachments: [{ id: "d1", detachmentId: "det-ember" }],
  units: [
    { id: "u1", datasheetId: "ds-squad", isWarlord: false, models: [{ modelProfileId: "ds-squad-m", count: 5, wargear: [] }] },
    { id: "u2", datasheetId: "ds-squad", isWarlord: false, models: [{ modelProfileId: "ds-squad-m", count: 5, wargear: [] }] },
    { id: "u3", datasheetId: "ds-captain", isWarlord: true, models: [{ modelProfileId: "ds-captain-m", count: 1, wargear: [] }] },
  ],
};

describe("stratagemsForRoster", () => {
  const list = stratagemsForRoster(roster, snapshot);

  it("keeps the taken detachment, the faction and the core ones", () => {
    expect(list.map((s) => s.stratagem.id)).toEqual(["st-volley", "st-hold", "st-faction", "st-core"]);
  });

  it("drops a detachment the list did not take, even in the same faction", () => {
    expect(list.find((s) => s.stratagem.id === "st-thorn")).toBeUndefined();
  });

  it("drops another faction's stratagem", () => {
    expect(list.find((s) => s.stratagem.id === "st-alien")).toBeUndefined();
  });

  it("labels the source and names the detachment it came with", () => {
    expect(list.map((s) => s.source)).toEqual(["detachment", "detachment", "faction", "core"]);
    expect(list[0]?.detachmentName).toBe("Ember Vanguard");
    expect(list[2]?.detachmentName).toBeUndefined();
  });

  it("names the units whose datasheet carries it, without repeating a datasheet", () => {
    expect(list.find((s) => s.stratagem.id === "st-volley")?.units).toEqual(["Warden Squad", "Warden Captain"]);
    expect(list.find((s) => s.stratagem.id === "st-hold")?.units).toEqual(["Warden Captain"]);
    expect(list.find((s) => s.stratagem.id === "st-core")?.units).toEqual([]);
  });

  it("copes with a snapshot stored before datasheets carried stratagem links", () => {
    // Snapshots come back from the local database as they were written, so the field can be absent.
    const legacy = { ...snapshot, data: { ...snapshot.data, datasheets: snapshot.data.datasheets.map(({ stratagemIds: _drop, ...rest }) => rest as typeof squad) } };
    const got = stratagemsForRoster(roster, legacy);
    expect(got.map((s) => s.stratagem.id)).toEqual(["st-volley", "st-hold", "st-faction", "st-core"]);
    expect(got.every((s) => s.units.length === 0)).toBe(true);
  });

  it("returns nothing when the snapshot carries no stratagems", () => {
    const bare: Snapshot = { ...snapshot, data: { ...snapshot.data, stratagems: [] } };
    expect(stratagemsForRoster(roster, bare)).toEqual([]);
  });
});

describe("stratagemPhases", () => {
  it("lists each phase once, lower-cased, in first-seen order", () => {
    expect(stratagemPhases(stratagemsForRoster(roster, snapshot))).toEqual(["shooting", "opponent's shooting", "fight", "any"]);
  });
});

describe("filterStratagems", () => {
  const list = stratagemsForRoster(roster, snapshot);

  it("matches the name and the rule text, case-insensitively", () => {
    expect(filterStratagems(list, { query: "cover" }).map((s) => s.stratagem.id)).toEqual(["st-volley", "st-hold"]);
    expect(filterStratagems(list, { query: "RE-ROLL" }).map((s) => s.stratagem.id)).toEqual(["st-volley", "st-core"]);
  });

  it("filters by phase", () => {
    expect(filterStratagems(list, { phase: "fight" }).map((s) => s.stratagem.id)).toEqual(["st-faction"]);
  });

  it("keeps only the ones a unit in the list names", () => {
    expect(filterStratagems(list, { unitsOnly: true }).map((s) => s.stratagem.id)).toEqual(["st-volley", "st-hold"]);
  });

  it("returns everything for an empty filter", () => {
    expect(filterStratagems(list, {}).length).toBe(list.length);
    expect(filterStratagems(list, { query: "   " }).length).toBe(list.length);
  });
});

describe("groupStratagems", () => {
  it("puts each detachment first, then faction, then core", () => {
    const groups = groupStratagems(stratagemsForRoster(roster, snapshot));
    expect(groups.map((g) => g.source)).toEqual(["detachment", "faction", "core"]);
    expect(groups[0]?.name).toBe("Ember Vanguard");
    expect(groups[0]?.items.map((s) => s.stratagem.id)).toEqual(["st-volley", "st-hold"]);
  });

  it("drops groups with nothing in them", () => {
    expect(groupStratagems([])).toEqual([]);
  });
});

describe("cpRange", () => {
  it("reports the cheapest and the dearest", () => {
    expect(cpRange(stratagemsForRoster(roster, snapshot))).toEqual({ min: 1, max: 2 });
  });

  it("is undefined for an empty list", () => {
    expect(cpRange([])).toBeUndefined();
  });
});

describe("stratagemParts", () => {
  it("returns the sections the source decomposed", () => {
    const volley = stratagemsForRoster(roster, snapshot).find((s) => s.stratagem.id === "st-volley");
    expect(stratagemParts(volley!.stratagem).map((p) => p.key)).toEqual(["when", "target", "effect"]);
  });

  it("returns nothing when the source only gave one blob of text", () => {
    const hold = stratagemsForRoster(roster, snapshot).find((s) => s.stratagem.id === "st-hold");
    expect(stratagemParts(hold!.stratagem)).toEqual([]);
  });
});
