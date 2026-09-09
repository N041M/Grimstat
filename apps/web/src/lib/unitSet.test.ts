import { describe, expect, it } from "vitest";
import { archetypes } from "@grimstat/game-40k-11e";
import { attackerArchetypes, isStoredEntry, makeEntry, shortArchetypeName, sourceKey, toStored, totalPoints } from "./unitSet";

describe("unit set model", () => {
  it("keys sources stably and keeps duplicates distinct by entry id", () => {
    expect(sourceKey({ kind: "archetype", archetypeId: "x" })).toBe("archetype:x");
    expect(sourceKey({ kind: "roster", rosterId: "r", unitId: "u" })).toBe("roster:r:u");
    expect(sourceKey({ kind: "datasheet", snapshotId: "s", datasheetId: "d" })).toBe("datasheet:s:d");
    expect(sourceKey({ kind: "calculator", side: "defender" })).toBe("calculator:defender");
    const a = archetypes[0]!;
    const e1 = makeEntry({ kind: "archetype", archetypeId: a.id }, a.unit, "archetype");
    const e2 = makeEntry({ kind: "archetype", archetypeId: a.id }, a.unit, "archetype");
    expect(e1.id).not.toBe(e2.id);
    expect(e1.unit).not.toBe(a.unit); // cloned
    expect(e1.unit).toEqual(a.unit);
  });

  it("persists only sources and optimiser extras", () => {
    const a = archetypes[0]!;
    const e = makeEntry({ kind: "archetype", archetypeId: a.id }, a.unit, "archetype", { weight: 2, optionId: "auto" });
    const stored = toStored([e]);
    expect(stored).toEqual([{ source: { kind: "archetype", archetypeId: a.id }, optionId: "auto", weight: 2 }]);
    expect(isStoredEntry(stored[0])).toBe(true);
    expect(isStoredEntry({ source: { kind: "nope" } })).toBe(false);
    expect(isStoredEntry(null)).toBe(false);
  });

  it("sums points when any unit has them", () => {
    const priced = archetypes.filter((a) => a.unit.points !== undefined).slice(0, 2);
    const entries = priced.map((a) => makeEntry({ kind: "archetype", archetypeId: a.id }, a.unit, "archetype"));
    expect(totalPoints(entries)).toBe(priced.reduce((s, a) => s + (a.unit.points ?? 0), 0));
    expect(totalPoints([])).toBeUndefined();
  });

  it("classifies attacker archetypes as those with usable weapons", () => {
    const ids = attackerArchetypes().map((a) => a.id);
    expect(ids).toContain("bolter-squad");
    expect(ids).not.toContain("marine-like");
  });
});

describe("shortArchetypeName", () => {
  it("drops the attacker prefix and the trailing stat block", () => {
    expect(shortArchetypeName("Attacker: 10 × rapid-fire bolt rifles (A1 BS3+ S4 AP0 D1, Rapid Fire 1)")).toBe("10 × rapid-fire bolt rifles");
    expect(shortArchetypeName("Heavy tank (T11 2+ W14)")).toBe("Heavy tank");
    expect(shortArchetypeName("Plain")).toBe("Plain");
  });
});
