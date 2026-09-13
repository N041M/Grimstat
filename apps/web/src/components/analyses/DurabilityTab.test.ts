import { describe, expect, it } from "vitest";
import { archetypes, type DurabilityEntry } from "@grimstat/game-40k-11e";
import { makeEntry } from "../../lib/unitSet";
import { fmtSampled } from "../../lib/format";
import { durabilityFingerprint, durabilityRan, per100HalfWidth, type DurabilityArgs } from "./DurabilityTab";

const archetype = archetypes[0]!;
const entry = () => makeEntry({ kind: "archetype", archetypeId: archetype.id }, archetype.unit, "archetype");

describe("durabilityRan", () => {
  /*
   * The tab used to hold these in its own state, which a tab switch threw away while the stored
   * result stayed. The header then called the result current and the body offered to run it.
   */
  it("reads the defender and the settings back from the arguments the run was made with", () => {
    const defender = entry();
    const ran: DurabilityArgs = [defender, ["bolter-squad", "melta-squad"], false, undefined];
    expect(durabilityRan(ran)).toEqual({ name: defender.unit.name, fp: durabilityFingerprint(defender, ["bolter-squad", "melta-squad"], false) });
  });

  it("has nothing to report before a run", () => {
    expect(durabilityRan(undefined)).toBeUndefined();
  });
});

describe("durabilityFingerprint", () => {
  it("matches the settings the run was made with and differs from any other", () => {
    const defender = entry();
    const fp = durabilityRan([defender, ["bolter-squad"], false, undefined])?.fp;
    expect(fp).toBe(durabilityFingerprint(defender, ["bolter-squad"], false));
    expect(fp).not.toBe(durabilityFingerprint(defender, ["bolter-squad"], true));
    expect(fp).not.toBe(durabilityFingerprint(defender, ["melta-squad"], false));
    expect(fp).not.toBe(durabilityFingerprint(defender, ["bolter-squad", "melta-squad"], false));
    expect(fp).not.toBe(durabilityFingerprint(entry(), ["bolter-squad"], false));
    expect(fp).not.toBe(durabilityFingerprint(undefined, ["bolter-squad"], false));
  });
});

describe("per100HalfWidth", () => {
  const entryFor = (over: Partial<DurabilityEntry> = {}): DurabilityEntry => ({ archetype: "Bolter squad", expectedDamage: 4, pKill: 0.2, backend: "mc", ...over });

  /*
   * The entry's interval belongs to `expectedDamage` and the per-100 column is five times that
   * figure on a 20-point defender. Printing the column against the unscaled interval claimed two
   * decimals on a figure the run places no better than the nearest half.
   */
  it("scales the interval by the same factor the column is scaled by", () => {
    const e = entryFor({ damageTakenPer100: 20, ciHalfWidth: 0.06 });
    expect(per100HalfWidth(e)).toBeCloseTo(0.3, 12);
    // The wounds column carries a decimal at this interval and the per-100 column does not, which is
    // the whole difference between the two scales.
    expect(fmtSampled(e.expectedDamage, e.ciHalfWidth)).toBe("4.0");
    expect(fmtSampled(e.damageTakenPer100, per100HalfWidth(e))).toBe("20");
    expect(fmtSampled(e.damageTakenPer100, e.ciHalfWidth)).toBe("20.0");
  });

  it("has no interval to give for an entry worked out exactly", () => {
    expect(per100HalfWidth(entryFor({ damageTakenPer100: 20 }))).toBeUndefined();
  });

  it("has no interval to give for a defender with no points value", () => {
    expect(per100HalfWidth(entryFor({ ciHalfWidth: 0.06 }))).toBeUndefined();
  });

  it("reads no factor off an entry that took no damage", () => {
    expect(per100HalfWidth(entryFor({ expectedDamage: 0, damageTakenPer100: 0, ciHalfWidth: 0.06 }))).toBeUndefined();
  });
});
