import { describe, expect, it } from "vitest";
import { parseSplitRule, ruleNamesSheet } from "./split";
import type { Datasheet } from "@grimstat/schema";

const IMMOLATOR = "This model has a transport capacity of 6 ORDO HERETICUS INFANTRy models.\n\nAt the start of the Declare Battle Formations step, you can select one SISTERS OF BATTlE SQUAD from your army. If you do, that unit is split into two units, each containing as equal a number of models as possible (when splitting a unit in this way, make a note of which models form each of the two new units). One of these units must start the battle embarked within this TRANSPORT; the other can start the battle embarked within another TRANSPORT, or it can be deployed as a separate unit.";
const RAIDER = "This model has a transport capacity of 11 DRUKHARI INFANTRY models. At the start of the Declare Battle Formations step, you can select one Kabalite Warriors, Hand of the Archon or Wyches unit from your army that has not already been split. If you do, that unit is split into two units, each containing as equal a number of models as possible. One of these units must start the battle embarked within this TRANSPORT.";
const GREY_HUNTERS = "In the Declare Battle Formations step, you can split a friendly GREY HUNTERS unit into two units, each containing as equal a number of models as possible.";
const HORRORS = "Every Blue Horror added to this unit using the Split ability is equipped with: coruscating blue flames; blue claws.";

describe("parseSplitRule", () => {
  it("reads the unit a transport's capacity text splits, and that one half must ride in it", () => {
    expect(parseSplitRule(IMMOLATOR)).toEqual({ units: ["SISTERS OF BATTLE SQUAD"], embark: true });
  });
  it("reads a list of units", () => {
    expect(parseSplitRule(RAIDER)).toEqual({ units: ["KABALITE WARRIORS", "HAND OF THE ARCHON", "WYCHES"], embark: true });
  });
  it("reads a character's ability, which asks for no transport", () => {
    expect(parseSplitRule(GREY_HUNTERS)).toEqual({ units: ["GREY HUNTERS"], embark: false });
  });
  it("leaves an ability that only mentions splitting alone", () => {
    expect(parseSplitRule(HORRORS)).toBeUndefined();
    expect(parseSplitRule("This model has a transport capacity of 12 INFANTRY models.")).toBeUndefined();
    expect(parseSplitRule(undefined)).toBeUndefined();
  });
});

describe("ruleNamesSheet", () => {
  const sheet = (name: string, keywords: string[]): Datasheet => ({ id: "x", gameSystemId: "wh40k-11e", factionId: "f", name, isLegends: false, isCharacter: false, isEpicHero: false, isBattleline: false, isSupport: false, keywords, factionKeywords: ["DRUKHARI"], models: [], weapons: [], abilityIds: [], stratagemIds: [], leaderTo: [], supportTo: [], composition: [], wargearOptions: [] });
  it("matches by name regardless of case", () => {
    expect(ruleNamesSheet("SISTERS OF BATTLE SQUAD", sheet("Sisters of Battle Squad", []))).toBe(true);
    expect(ruleNamesSheet("SISTERS OF BATTLE SQUAD", sheet("Sisters of Battle Immolator", []))).toBe(false);
  });
  it("matches a keyword phrase word by word", () => {
    expect(ruleNamesSheet("YNNARI KABALITE WARRIORS", sheet("Kabalite Warriors", ["INFANTRY", "KABALITE WARRIORS", "YNNARI"]))).toBe(true);
    expect(ruleNamesSheet("YNNARI KABALITE WARRIORS", sheet("Kabalite Warriors", ["INFANTRY", "KABALITE WARRIORS"]))).toBe(false);
  });
});
