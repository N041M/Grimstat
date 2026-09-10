import { describe, expect, it } from "vitest";
import type { Datasheet, Roster, RosterUnit } from "@grimstat/schema";
import type { UnitCost } from "@grimstat/resolver";
import { armyComposition, casualtyAt, casualtyCurve, CASUALTY_LEVELS, compareStatRows, pointsForLoss, sortStatRows, summariseSaturation, type ArmyStatRow, type CasualtyUnit, type SaturationCandidate, type StatSort } from "./armyStats";

// ---------- fixtures ----------

function sheet(id: string, over: Partial<Datasheet> = {}): Datasheet {
  return {
    id,
    gameSystemId: "wh40k-11e",
    factionId: "fx",
    name: id,
    isLegends: false,
    isCharacter: false,
    isEpicHero: false,
    isBattleline: false,
    isSupport: false,
    keywords: [],
    factionKeywords: [],
    models: [{ id: `${id}-m`, name: "Model", T: 4, Sv: 3, W: 2, OC: 1 }],
    weapons: [],
    abilityIds: [],
    leaderTo: [],
    supportTo: [],
    composition: [],
    wargearOptions: [],
    ...over,
  } as Datasheet;
}

function unit(id: string, datasheetId: string, count: number, over: Partial<RosterUnit> = {}): RosterUnit {
  return { id, datasheetId, models: [{ modelProfileId: `${datasheetId}-m`, count, wargear: [] }], isWarlord: false, ...over };
}

function roster(units: RosterUnit[], pointsLimit = 1000): Roster {
  return {
    id: "r1",
    ownerId: "local",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    revision: 1,
    name: "Test army",
    gameSystemId: "wh40k-11e",
    snapshotId: "s1",
    factionId: "fx",
    battleSize: "custom",
    pointsLimit,
    detachments: [],
    units,
  } as Roster;
}

const cost = (n: number): UnitCost => ({ base: n, wargear: 0, enhancement: 0, total: n, copyIndex: 0, modelCount: 1, notes: [] }) as UnitCost;

/** Battleline ×10 (W2 OC2) led by a character, a dedicated transport and an allied unit. */
function army() {
  const datasheets = new Map<string, Datasheet>([
    ["troops", sheet("troops", { isBattleline: true, keywords: ["INFANTRY", "BATTLELINE"], factionKeywords: ["FX"], models: [{ id: "troops-m", name: "Trooper", T: 4, Sv: 3, W: 2, OC: 2 }] })],
    ["boss", sheet("boss", { isCharacter: true, keywords: ["INFANTRY", "CHARACTER"], factionKeywords: ["FX"], models: [{ id: "boss-m", name: "Boss", T: 4, Sv: 3, W: 5, OC: 1 }] })],
    ["ride", sheet("ride", { role: "Dedicated Transport", keywords: ["VEHICLE", "TRANSPORT"], factionKeywords: ["FX"], models: [{ id: "ride-m", name: "Ride", T: 9, Sv: 3, W: 11, OC: 0 }] })],
    ["merc", sheet("merc", { factionId: "other", keywords: ["INFANTRY"], factionKeywords: ["OTHER"], models: [{ id: "merc-m", name: "Merc", T: 3, Sv: 5, W: 1 }] })],
  ]);
  const units = [unit("u-troops", "troops", 10), unit("u-boss", "boss", 1, { attachedTo: { unitId: "u-troops", role: "leader" } }), unit("u-ride", "ride", 1), unit("u-merc", "merc", 5)];
  const costs = new Map<string, UnitCost>([
    ["u-troops", cost(200)],
    ["u-boss", cost(80)],
    ["u-ride", cost(90)],
    ["u-merc", cost(60)],
  ]);
  return { datasheets, roster: roster(units), costs };
}

// ---------- composition ----------

describe("armyComposition", () => {
  it("totals points, models, wounds and objective control across the whole list", () => {
    const { roster: r, datasheets, costs } = army();
    const c = armyComposition(r, datasheets, costs);

    expect(c.points).toBe(430);
    expect(c.limit).toBe(1000);
    expect(c.spare).toBe(570);
    expect(c.over).toBe(0);
    // 10 troopers + 1 boss + 1 transport + 5 mercenaries
    expect(c.models).toBe(17);
    // 10×2 + 1×5 + 1×11 + 5×1
    expect(c.wounds).toBe(41);
    // 10×2 + 1×1 + 1×0 + 5×(profile with no OC → 0)
    expect(c.oc).toBe(21);
    expect(c.pointsPerModel).toBeCloseTo(430 / 17);
  });

  it("folds an attached character into its host, so the army has three units on the table", () => {
    const { roster: r, datasheets, costs } = army();
    const c = armyComposition(r, datasheets, costs);

    expect(c.units).toBe(3);
    expect(c.rows.map((x) => x.id)).toEqual(["u-troops", "u-ride", "u-merc"]);
    const host = c.rows[0]!;
    expect(host.memberIds).toEqual(["u-troops", "u-boss"]);
    expect(host.models).toBe(11);
    expect(host.wounds).toBe(25);
    expect(host.oc).toBe(21);
    expect(host.points).toBe(280);
    // Every model and every point of the army appears in exactly one row.
    expect(c.rows.reduce((s, x) => s + x.models, 0)).toBe(c.models);
    expect(c.rows.reduce((s, x) => s + x.points, 0)).toBe(c.points);
  });

  it("splits points by role with each entry under its own role, matching the header bar", () => {
    const { roster: r, datasheets, costs } = army();
    const c = armyComposition(r, datasheets, costs);

    expect(c.roles.map((x) => x.section)).toEqual(["battleline", "transport", "character", "allied"]);
    expect(c.roles.map((x) => x.points)).toEqual([200, 90, 80, 60]);
    expect(c.roles.map((x) => x.units)).toEqual([1, 1, 1, 1]);
    expect(c.roles.map((x) => x.models)).toEqual([10, 1, 1, 5]);
    expect(c.roles.map((x) => x.tone)).toEqual(["ink", "mid", "dim", "dim"]);
    expect(c.roles[0]!.share).toBeCloseTo(200 / 430);
    expect(c.roles.reduce((s, x) => s + x.share, 0)).toBeCloseTo(1);
    expect(c.roles.reduce((s, x) => s + x.points, 0)).toBe(c.points);
  });

  it("counts faction and unit keywords per roster entry, busiest first", () => {
    const { roster: r, datasheets, costs } = army();
    const c = armyComposition(r, datasheets, costs);

    expect(c.factionKeywords).toEqual([
      { name: "FX", count: 3 },
      { name: "OTHER", count: 1 },
    ]);
    expect(c.unitKeywords).toEqual([
      { name: "INFANTRY", count: 3 },
      { name: "BATTLELINE", count: 1 },
      { name: "CHARACTER", count: 1 },
      { name: "TRANSPORT", count: 1 },
      { name: "VEHICLE", count: 1 },
    ]);
  });

  it("de-duplicates a keyword repeated on one datasheet and ignores case and padding", () => {
    const datasheets = new Map<string, Datasheet>([["troops", sheet("troops", { keywords: ["Infantry", "INFANTRY", " infantry "], factionKeywords: [] })]]);
    const c = armyComposition(roster([unit("a", "troops", 1), unit("b", "troops", 1)]), datasheets, new Map());
    expect(c.unitKeywords).toEqual([{ name: "INFANTRY", count: 2 }]);
  });

  it("describes an empty army without dividing by zero", () => {
    const c = armyComposition(roster([]), new Map(), new Map());
    expect(c).toMatchObject({ units: 0, models: 0, wounds: 0, oc: 0, points: 0, pointsPerModel: 0 });
    expect(c.rows).toEqual([]);
    expect(c.roles).toEqual([]);
    expect(c.factionKeywords).toEqual([]);
  });

  it("counts a unit with no costing as zero points and reports the overrun", () => {
    const datasheets = new Map<string, Datasheet>([["troops", sheet("troops")]]);
    const c = armyComposition(roster([unit("a", "troops", 1), unit("b", "troops", 1)], 100), datasheets, new Map([["a", cost(160)]]));
    expect(c.points).toBe(160);
    expect(c.over).toBe(60);
    expect(c.spare).toBe(0);
    expect(c.rows.map((x) => x.points)).toEqual([160, 0]);
  });
});

// ---------- sorting ----------

function row(name: string, over: Partial<ArmyStatRow> = {}): ArmyStatRow {
  return { id: name, name, section: "other", role: "", models: 1, wounds: 1, oc: 0, points: 100, memberIds: [name], damagePer100: undefined, durability: undefined, effectiveWounds: undefined, trade: undefined, ...over };
}

describe("compareStatRows", () => {
  const by = (col: StatSort["col"], dir: StatSort["dir"], rows: ArmyStatRow[]) => sortStatRows(rows, { col, dir }).map((r) => r.name);

  it("sorts numeric columns in both directions", () => {
    const rows = [row("a", { points: 100 }), row("b", { points: 300 }), row("c", { points: 200 })];
    expect(by("points", "desc", rows)).toEqual(["b", "c", "a"]);
    expect(by("points", "asc", rows)).toEqual(["a", "c", "b"]);
  });

  it("sorts the unit column by name, case-insensitively", () => {
    const rows = [row("Zeta"), row("alpha"), row("Mid")];
    expect(by("unit", "asc", rows)).toEqual(["alpha", "Mid", "Zeta"]);
    expect(by("unit", "desc", rows)).toEqual(["Zeta", "Mid", "alpha"]);
  });

  it("keeps rows the worker has not answered for at the bottom in both directions", () => {
    const rows = [row("pending"), row("low", { damagePer100: 1 }), row("high", { damagePer100: 9 })];
    expect(by("damage", "desc", rows)).toEqual(["high", "low", "pending"]);
    expect(by("damage", "asc", rows)).toEqual(["low", "high", "pending"]);
  });

  it("breaks ties on the name so the order stays stable while results stream in", () => {
    const rows = [row("c", { points: 100 }), row("a", { points: 100 }), row("b", { points: 100 })];
    expect(by("points", "desc", rows)).toEqual(["a", "b", "c"]);
    expect(by("points", "asc", rows)).toEqual(["a", "b", "c"]);
  });

  it("treats an unremovable unit as the toughest rather than as unsolved", () => {
    const rows = [row("solid", { durability: Number.POSITIVE_INFINITY }), row("soft", { durability: 120 }), row("waiting")];
    expect(by("durability", "desc", rows)).toEqual(["solid", "soft", "waiting"]);
  });

  it("does not mutate the input array", () => {
    const rows = [row("b", { points: 1 }), row("a", { points: 2 })];
    sortStatRows(rows, { col: "points", dir: "desc" });
    expect(rows.map((r) => r.name)).toEqual(["b", "a"]);
  });

  it("returns 0 for two rows equal on the column and the name", () => {
    expect(compareStatRows(row("a", { wounds: 3 }), row("a", { wounds: 3 }), { col: "wounds", dir: "asc" })).toBe(0);
  });
});

// ---------- casualty curve ----------

/** 10 wounds, 10 models, 100 points, losing 1 wound and 1 model per 100 attacker points. */
const flat = (over: Partial<CasualtyUnit> = {}): CasualtyUnit => ({ points: 100, models: 10, wounds: 10, woundsPer100: 1, slainPer100: 1, ...over });

describe("casualty curve", () => {
  it("is linear in attacker points until the unit runs out of wounds", () => {
    const units = [flat()];
    expect(casualtyAt(units, 0).woundsLost).toBe(0);
    expect(casualtyAt(units, 500).woundsLost).toBeCloseTo(5, 9);
    expect(casualtyAt(units, 500).woundsFraction).toBeCloseTo(0.5, 9);
    // capped: 2000 points would strip 20 wounds off a 10-wound unit
    expect(casualtyAt(units, 2000).woundsLost).toBe(10);
    expect(casualtyAt(units, 2000).woundsFraction).toBe(1);
  });

  it("splits the incoming fire in proportion to each unit's points", () => {
    // The 300-point unit soaks three quarters of the fire, so both empty at the same moment.
    const units = [flat({ points: 100, wounds: 10, models: 10 }), flat({ points: 300, wounds: 30, models: 30 })];
    const at = casualtyAt(units, 400);
    expect(at.woundsLost).toBeCloseTo(1 + 3, 9); // 100 pts on the small unit, 300 on the large
    expect(at.woundsFraction).toBeCloseTo(4 / 40, 9);
  });

  it("shares the fire evenly when nothing has a points value", () => {
    const units = [flat({ points: 0 }), flat({ points: 0 })];
    expect(casualtyAt(units, 400).woundsLost).toBeCloseTo(4, 9); // 200 points each
  });

  it("tracks models on their own rate, not as a share of wounds", () => {
    const units = [flat({ models: 5, wounds: 10, slainPer100: 0.25 })];
    const at = casualtyAt(units, 800);
    expect(at.woundsLost).toBe(8);
    expect(at.modelsLost).toBeCloseTo(2, 9);
    expect(at.modelsFraction).toBeCloseTo(0.4, 9);
  });

  it("samples the documented levels and never goes backwards", () => {
    const curve = casualtyCurve([flat(), flat({ points: 200, wounds: 6, models: 3, woundsPer100: 3, slainPer100: 1.5 })]);
    expect(curve.map((p) => p.attackerPoints)).toEqual([...CASUALTY_LEVELS]);
    for (let i = 1; i < curve.length; i++) expect(curve[i]!.woundsFraction).toBeGreaterThanOrEqual(curve[i - 1]!.woundsFraction);
  });

  it("interpolates the points needed to halve the army", () => {
    expect(pointsForLoss([flat()], 0.5)).toBeCloseTo(500, 3);
    // Two units of different toughness: the soft one empties first, so the knee is past the average.
    const units = [flat({ points: 100, wounds: 10, woundsPer100: 4 }), flat({ points: 100, wounds: 10, woundsPer100: 0.5 })];
    const half = pointsForLoss(units, 0.5);
    expect(casualtyAt(units, half).woundsFraction).toBeCloseTo(0.5, 6);
    expect(pointsForLoss(units, 0)).toBe(0);
  });

  it("reports Infinity when nothing can be hurt, and for an empty army", () => {
    expect(pointsForLoss([flat({ woundsPer100: 0, slainPer100: 0 })], 0.5)).toBe(Number.POSITIVE_INFINITY);
    expect(pointsForLoss([], 0.5)).toBe(Number.POSITIVE_INFINITY);
  });
});

// ---------- threat saturation ----------

const cand = (names: string[], points: number, pKill: number): SaturationCandidate => ({ candidateIds: names, names, points, pKill });

describe("threat saturation", () => {
  it("counts the units that clear the solo threshold and picks the cheapest group that clears the joint one", () => {
    const rows = [cand(["a"], 200, 0.62), cand(["b"], 150, 0.5), cand(["c"], 90, 0.2), cand(["a", "b"], 350, 0.95), cand(["b", "c"], 240, 0.91), cand(["a", "c"], 290, 0.88)];
    const s = summariseSaturation(rows);
    expect(s.soloNames).toEqual(["b", "a"]); // exactly at 0.5 counts; cheapest listed first
    expect(s.needed).toBe(2);
    expect(s.cheapestNames).toEqual(["b", "c"]);
    expect(s.cheapestPoints).toBe(240);
    expect(s.cheapestPKill).toBeCloseTo(0.91, 9);
  });

  it("prefers a cheaper pair over a pricier single", () => {
    const s = summariseSaturation([cand(["big"], 400, 0.97), cand(["x"], 100, 0.4), cand(["y"], 120, 0.55), cand(["x", "y"], 220, 0.93)]);
    expect(s.needed).toBe(2);
    expect(s.cheapestNames).toEqual(["x", "y"]);
  });

  it("leaves the combination undefined when nothing reaches the joint threshold", () => {
    const s = summariseSaturation([cand(["a"], 100, 0.3), cand(["b"], 100, 0.2), cand(["a", "b"], 200, 0.55)]);
    expect(s.soloNames).toEqual([]);
    expect(s.needed).toBeUndefined();
    expect(s.cheapestNames).toEqual([]);
    expect(s.cheapestPoints).toBeUndefined();
  });
});

describe("new sort columns", () => {
  it("sorts on effective wounds and trade ratio, keeping unanswered rows last", () => {
    const rows = [row("waiting"), row("tough", { effectiveWounds: 90 }), row("soft", { effectiveWounds: 20 })];
    expect(sortStatRows(rows, { col: "effective", dir: "desc" }).map((r) => r.name)).toEqual(["tough", "soft", "waiting"]);
    const trades = [row("bad", { trade: 0.2 }), row("good", { trade: 1.4 }), row("waiting")];
    expect(sortStatRows(trades, { col: "trade", dir: "desc" }).map((r) => r.name)).toEqual(["good", "bad", "waiting"]);
    expect(compareStatRows(row("a", { trade: 1 }), row("b", { trade: 1 }), { col: "trade", dir: "desc" })).toBeLessThan(0);
  });
});
