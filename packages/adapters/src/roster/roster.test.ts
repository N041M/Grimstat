import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Roster, RosterUnit } from "@grimstat/schema";
import { loadSyntheticSnapshot } from "@grimstat/snapshot";
import { SYNTHETIC_DIR } from "../test-utils";
import { exportRosterText, importRosterText, exportRosterPrintHtml } from "./index";
import { parseDetSpec, parseEnhancement, parseFactionSize, parseGroupSpec, parseUnitHeader, parseWargearItems, parseWargearList, splitList, stripPlusMarks } from "./import";
import { RosterImportContext, nameIndexOf } from "./import-common";

const snapshot = loadSyntheticSnapshot();
const readFixture = (rel: string) => readFileSync(join(SYNTHETIC_DIR, rel), "utf8");
const now = new Date().toISOString();
const roster: Roster = {
  id: "r1",
  ownerId: "local",
  createdAt: now,
  updatedAt: now,
  revision: 0,
  name: "Ember Strike",
  gameSystemId: snapshot.gameSystemId,
  snapshotId: snapshot.id,
  factionId: "faction:ashen-wardens",
  battleSize: "incursion",
  pointsLimit: 1000,
  detachments: [{ id: "d1", detachmentId: "det:ashen-wardens:ember-vanguard", forceDisposition: "TAKE AND HOLD" }],
  units: [
    { id: "u1", datasheetId: "ds:ashen-wardens:warden-squad", models: [{ modelProfileId: "mp:ashen-wardens:warden-squad:warden-sergeant", count: 1, wargear: ["Flux carbine", "Power fist"] }, { modelProfileId: "mp:ashen-wardens:warden-squad:warden", count: 4, wargear: ["Flux carbine", "Shock maul"] }], isWarlord: false },
    { id: "u2", datasheetId: "ds:ashen-wardens:warden-captain", models: [{ modelProfileId: "mp:ashen-wardens:warden-captain:warden-captain", count: 1, wargear: ["Flux pistol", "Relic blade"] }], attachedTo: { unitId: "u1", role: "leader" }, enhancementId: "enh:ashen-wardens:ember-blade", isWarlord: true },
    { id: "u3", datasheetId: "ds:ashen-wardens:ashen-crusher", models: [{ modelProfileId: "mp:ashen-wardens:ashen-crusher:ashen-crusher", count: 1, wargear: ["Fusion beamer", "Twin hail gun", "Crusher fists"] }], isWarlord: false },
  ],
};

describe("roster text export/import", () => {
  it("gw-app dialect round-trips units, counts, wargear, leader, enhancement and warlord", () => {
    const text = exportRosterText(roster, snapshot, "gw-app");
    expect(text).toContain("Ember Strike (");
    expect(text).toContain("CHARACTERS");
    expect(text).toContain("• Warlord");
    expect(text).toContain("• Leads: Warden Squad");
    expect(text).toContain("Enhancement: Ember Blade (+15 pts)");
    const { roster: back, warnings } = importRosterText(text, snapshot);
    expect(warnings).toEqual([]);
    expect(back.name).toBe("Ember Strike");
    expect(back.factionId).toBe("faction:ashen-wardens");
    expect(back.battleSize).toBe("incursion");
    expect(back.pointsLimit).toBe(1000);
    expect(back.detachments.map((d) => [d.detachmentId, d.forceDisposition])).toEqual([["det:ashen-wardens:ember-vanguard", "TAKE AND HOLD"]]);
    const squad = back.units.find((u) => u.datasheetId === "ds:ashen-wardens:warden-squad")!;
    expect(squad.models.map((g) => [g.count, g.wargear.join("+")])).toEqual([[1, "Flux carbine+Power fist"], [4, "Flux carbine+Shock maul"]]);
    const cap = back.units.find((u) => u.datasheetId === "ds:ashen-wardens:warden-captain")!;
    expect(cap.isWarlord).toBe(true);
    expect(cap.enhancementId).toBe("enh:ashen-wardens:ember-blade");
    expect(cap.attachedTo).toEqual({ unitId: squad.id, role: "leader" });
    const crusher = back.units.find((u) => u.datasheetId === "ds:ashen-wardens:ashen-crusher")!;
    expect(crusher.models[0]!.wargear).toContain("Fusion beamer");
    // costs identical after the round trip
    expect(exportRosterText(back, snapshot, "gw-app").split("\n")[0]).toBe(text.split("\n")[0]);
  });
  it("nr-tournament dialect round-trips", () => {
    const text = exportRosterText(roster, snapshot, "nr-tournament");
    expect(text).toContain("+++ Ember Strike [");
    expect(text).toContain("Detachment: Ember Vanguard [2 DP] (TAKE AND HOLD)");
    const { roster: back, warnings } = importRosterText(text, snapshot);
    expect(warnings).toEqual([]);
    expect(back.units.length).toBe(3);
    const cap = back.units.find((u) => u.datasheetId === "ds:ashen-wardens:warden-captain")!;
    expect(cap.isWarlord).toBe(true);
    expect(cap.enhancementId).toBe("enh:ashen-wardens:ember-blade");
    expect(cap.attachedTo?.role).toBe("leader");
    expect(back.battleSize).toBe("incursion");
  });
  it("tolerates a 10e-style list with a bare detachment line and unknown units", () => {
    const text = ["Test List (500 points)", "", "Ashen Wardens", "Strike Force (2000 points)", "Ember Vanguard", "", "CHARACTERS", "", "Warden Captain (80 points)", "  • Warlord", "  • 1x Flux pistol", "", "Mystery Unit (50 points)", "  • 1x Thing", ""].join("\n");
    const { roster: back, warnings } = importRosterText(text, snapshot);
    expect(back.detachments[0]?.detachmentId).toBe("det:ashen-wardens:ember-vanguard");
    expect(back.units.length).toBe(1);
    expect(back.units[0]!.models[0]!.wargear).toEqual(["Flux pistol"]);
    expect(warnings.some((w) => w.includes("Mystery Unit"))).toBe(true);
  });
  it("markdown and print pack contain the list and only its stratagems", () => {
    const md = exportRosterText(roster, snapshot, "markdown");
    expect(md).toContain("| Warden Squad |");
    const html = exportRosterPrintHtml(roster, snapshot);
    expect(html).toContain("Warden Squad");
    expect(html).toContain("COVERING VOLLEY");
    expect(html).not.toContain("SURGE OF THORNS");
    expect(html).toContain("&#39;s Aegis".replace("&#39;s Aegis", "Ember Blade"));
    expect(html).not.toContain("<script");
  });
});

describe("New Recruit tournament export", () => {
  const nr = [
    "+++++++++++++++++++++++++++++++++++++++++++++++",
    "+ FACTION KEYWORD: Imperium - Ashen Wardens",
    "+ DETACHMENT: Ember Vanguard (Some Variant)",
    "+ FORCE DISPOSITION: Priority Assets",
    "+ TOTAL ARMY POINTS: 505pts",
    "+",
    "+ WARLORD: Char1: Warden Captain",
    "+ ENHANCEMENT: Ember Blade (on Char1: Warden Captain)",
    "& Warden's Aegis (on Char2: Warden Captain)",
    "+ NUMBER OF UNITS: 3",
    "+ SECONDARY: - Bring It Down: (1x2)",
    "+++++++++++++++++++++++++++++++++++++++++++++++",
    "",
    "Char1: 1x Warden Captain (80 pts): Flux pistol, Relic blade",
    "Enhancement: Ember Blade (+15 pts)",
    "1x Ashen Crusher (150 pts): Vortex cannon, 2x Twin hail gun, Crusher fists",
    "10x Warden Squad (180 pts)",
    "• 1x Warden Sergeant: Flux carbine, Power fist",
    "• 9x Warden: 9 with Flux carbine, Shock maul",
    "",
    "Created with newrecruit.eu v35.80",
  ].join("\n");
  it("parses the header block, CharN prefixes, bullet model lines and multiplicities", () => {
    const { roster: r, warnings } = importRosterText(nr, snapshot);
    expect(warnings).toEqual([]);
    expect(r.factionId).toBe("faction:ashen-wardens");
    expect(r.battleSize).toBe("incursion");
    expect(r.detachments).toEqual([{ id: "d1", detachmentId: "det:ashen-wardens:ember-vanguard", forceDisposition: "Priority Assets" }]);
    const cap = r.units.find((u) => u.datasheetId === "ds:ashen-wardens:warden-captain")!;
    expect(cap.isWarlord).toBe(true);
    expect(cap.enhancementId).toBe("enh:ashen-wardens:ember-blade");
    expect(cap.models[0]!.wargear).toEqual(["Flux pistol", "Relic blade"]);
    const crusher = r.units.find((u) => u.datasheetId === "ds:ashen-wardens:ashen-crusher")!;
    expect(crusher.models[0]!.wargear).toEqual(["Vortex cannon", "Twin hail gun", "Twin hail gun", "Crusher fists"]);
    const squad = r.units.find((u) => u.datasheetId === "ds:ashen-wardens:warden-squad")!;
    expect(squad.models.map((g) => [g.modelProfileId.split(":").pop(), g.count, g.wargear.join("+")])).toEqual([
      ["warden-sergeant", 1, "Flux carbine+Power fist"],
      ["warden", 9, "Flux carbine+Shock maul"],
    ]);
    expect(splitList("a, b,c")).toEqual(["a", "b", "c"]);
    expect(parseWargearList(" 9 with Bolt pistol, Boltgun")).toEqual(["Bolt pistol", "Boltgun"]);
  });
  it("fuzzy-matches unit names by token set and containment", () => {
    const { roster: r, warnings } = importRosterText("1x Squad Warden (90 pts)\n1x Wardens of Ashen Crusher (150 pts)\n", snapshot);
    expect(warnings).toEqual([]);
    expect(r.units.map((u) => u.datasheetId)).toEqual(["ds:ashen-wardens:warden-squad", "ds:ashen-wardens:ashen-crusher"]);
  });
});

/**
 * One file per dialect in `fixtures/synthetic/rosters/`, each one written the way that exporter writes it.
 * They are the regression net for the parsing rules the dialects disagree on: how points are punctuated, how a
 * detachment line is decorated, and whether a count in front of a weapon means models or copies.
 */
describe("army-list dialects", () => {
  const dialect = (file: string) => importRosterText(readFixture(join("rosters", file)), snapshot);
  const shape = (u: RosterUnit | undefined) => (u?.models ?? []).map((g) => [g.modelProfileId.split(":").pop(), g.count, g.wargear.join("+")]);
  const unitsOf = (r: Roster, id: string) => r.units.filter((u) => u.datasheetId === `ds:ashen-wardens:${id}`);

  it("reads the GW app dialect: capital Points, a thousands separator and a bare detachment name", () => {
    const { roster: r, warnings } = dialect("gw-app.txt");
    expect(warnings).toEqual([]);
    expect(r.name).toBe("Ember Strike");
    expect(r.battleSize).toBe("incursion");
    expect(r.pointsLimit).toBe(1000);
    expect(r.detachments.map((d) => d.detachmentId)).toEqual(["det:ashen-wardens:ember-vanguard"]);
    const cap = unitsOf(r, "warden-captain")[0]!;
    expect(cap.isWarlord).toBe(true);
    expect(cap.enhancementId).toBe("enh:ashen-wardens:ember-blade");
    expect(cap.attachedTo).toEqual({ unitId: unitsOf(r, "warden-squad")[0]!.id, role: "leader" });
  });

  it("keeps the copies of a weapon a single model carries twice, and splits the models that carry one only some took", () => {
    const { roster: r } = dialect("gw-app.txt");
    expect(shape(unitsOf(r, "ashen-crusher")[0])).toEqual([["ashen-crusher", 1, "Vortex cannon+Twin hail gun+Twin hail gun+Crusher fists"]]);
    expect(shape(unitsOf(r, "warden-squad")[0])).toEqual([
      ["warden-sergeant", 1, "Flux carbine+Power fist"],
      ["warden", 2, "Flux carbine+Shock maul"],
      ["warden", 7, "Flux carbine"],
    ]);
  });

  it("reads the WTC-compact dialect: `N with` loadouts become model groups on their own profiles", () => {
    const { roster: r, warnings } = dialect("wtc-compact.txt");
    expect(warnings).toEqual([]);
    expect(r.detachments.map((d) => d.detachmentId)).toEqual(["det:ashen-wardens:ember-vanguard"]);
    expect(shape(unitsOf(r, "warden-squad")[0])).toEqual([
      ["warden-sergeant", 1, "Flux carbine+Power fist"],
      ["warden", 9, "Flux carbine+Shock maul"],
    ]);
    expect(shape(unitsOf(r, "warden-squad")[1])).toEqual([
      ["warden-sergeant", 1, "Flux carbine"],
      ["warden", 4, "Shock maul"],
    ]);
  });

  it("takes an enhancement out of a WTC-compact unit's inline wargear list", () => {
    const { roster: r } = dialect("wtc-compact.txt");
    const cap = unitsOf(r, "warden-captain")[0]!;
    expect(cap.enhancementId).toBe("enh:ashen-wardens:ember-blade");
    expect(cap.isWarlord).toBe(true);
    expect(cap.models[0]!.wargear).toEqual(["Flux pistol", "Relic blade"]);
  });

  it("reads the New Recruit header block and gives two characters one squad each", () => {
    const { roster: r, warnings } = dialect("new-recruit.txt");
    expect(warnings).toEqual([]);
    expect(r.battleSize).toBe("incursion");
    expect(r.detachments).toEqual([{ id: "d1", detachmentId: "det:ashen-wardens:ember-vanguard", forceDisposition: "Priority Assets" }]);
    const [c1, c2] = unitsOf(r, "warden-captain");
    const [s1, s2] = unitsOf(r, "warden-squad");
    expect(c1!.isWarlord).toBe(true);
    expect(c2!.isWarlord).toBe(false);
    expect(c1!.enhancementId).toBe("enh:ashen-wardens:ember-blade");
    expect(c2!.enhancementId).toBe("enh:ashen-wardens:wardens-aegis");
    expect([c1!.attachedTo?.unitId, c2!.attachedTo?.unitId]).toEqual([s1!.id, s2!.id]);
  });

  it("reads a ListBot-style list: dash-separated points and a detachment line after the units", () => {
    const { roster: r, warnings } = dialect("listbot.txt");
    expect(warnings).toEqual([]);
    expect(r.name).toBe("Ember Strike");
    expect(r.units.length).toBe(3);
    expect(r.detachments.map((d) => d.detachmentId)).toEqual(["det:ashen-wardens:ember-vanguard"]);
    expect(shape(unitsOf(r, "warden-squad")[0])).toEqual([
      ["warden-sergeant", 1, "Flux carbine+Power fist"],
      ["warden", 9, "Flux carbine+Shock maul"],
    ]);
    expect(unitsOf(r, "warden-captain")[0]!.attachedTo?.unitId).toBe(unitsOf(r, "warden-squad")[0]!.id);
  });
});

describe("text import edge cases", () => {
  const importLines = (...lines: string[]) => importRosterText(lines.join("\n"), snapshot);

  it("reports wargear that matches no weapon on the datasheet instead of simulating a default loadout", () => {
    const { roster: r, warnings } = importLines("Ashen Wardens", "Ember Vanguard", "1x Warden Captain (80 pts): Fluxx pistol");
    expect(r.units[0]!.models[0]!.wargear).toEqual(["Fluxx pistol"]);
    expect(warnings).toEqual([`Warden Captain: unknown wargear "Fluxx pistol".`]);
  });

  it("splits a wargear entry that joins two weapons with `and`", () => {
    const rest = importLines("Ashen Wardens", "Ember Vanguard", "1x Ashen Crusher (180 points): Fusion beamer and Twin hail gun");
    const bullet = importLines("Ashen Wardens", "Ember Vanguard", "Ashen Crusher (180 points)", "• 1x Fusion beamer and Twin hail gun");
    for (const { roster: r, warnings } of [rest, bullet]) {
      expect(warnings).toEqual([]);
      expect(r.units[0]!.models[0]!.wargear).toEqual(["Fusion beamer", "Twin hail gun"]);
    }
  });

  // 73 weapon and weapon-group names in the real game data have an "and" of their own ("Cult claws and knife"),
  // and some sit on a datasheet that carries each half as a weapon too, so the whole entry is tried before it is cut.
  it("keeps a wargear entry whose own name has an `and` in it", () => {
    const data = structuredClone(snapshot.data);
    const thornlings = data.datasheets.find((d) => d.name === "Thornlings")!;
    thornlings.weapons.push({ ...structuredClone(thornlings.weapons[1]!), id: "wp:verdant-swarm:thornlings:spine-flick-and-barbed-claws", name: "Spine flick and barbed claws" });
    const { roster: r, warnings } = importRosterText("Verdant Swarm\n1x Thornlings (60 points): Spine flick and barbed claws", { ...snapshot, data });
    expect(warnings).toEqual([]);
    expect(r.units[0]!.models[0]!.wargear).toEqual(["Spine flick and barbed claws"]);
  });

  it("leaves an entry as written when only part of it is a weapon of the datasheet", () => {
    const { roster: r, warnings } = importLines("Ashen Wardens", "Ember Vanguard", "1x Ashen Crusher (180 points): Fusion beamer and Fluxx cannon");
    expect(r.units[0]!.models[0]!.wargear).toEqual(["Fusion beamer and Fluxx cannon"]);
    expect(warnings).toEqual([`Ashen Crusher: unknown wargear "Fusion beamer and Fluxx cannon".`]);
  });

  it("reads a count written in front of a weapon without an `x`, in the plural or the singular", () => {
    const plural = importLines("Ashen Wardens", "Ember Vanguard", "1x Ashen Crusher (180 points): Vortex cannon, 2 Twin hail guns");
    const singular = importLines("Ashen Wardens", "Ember Vanguard", "1x Ashen Crusher (180 points): Vortex cannon, 2 Twin hail gun");
    for (const { roster: r, warnings } of [plural, singular]) {
      expect(warnings).toEqual([]);
      expect(r.units[0]!.models[0]!.wargear).toEqual(["Vortex cannon", "Twin hail gun", "Twin hail gun"]);
    }
  });

  it("falls back to the smallest way of building a unit the list gives no size for", () => {
    // Sporeling Drove is 11 models or 22, never 33: the two composition lines have an OR between them.
    const { roster: r, warnings } = importLines("Verdant Swarm", "Thorn Tide", "Sporeling Drove (55 pts)");
    expect(warnings).toEqual([]);
    expect(r.units[0]!.models.reduce((n, g) => n + g.count, 0)).toBe(11);
  });

  it("accepts a detachment named after the first unit, with or without its DP count", () => {
    const { roster: r, warnings } = importLines("Ashen Wardens", "1x Warden Captain (80 pts): Flux pistol", "Detachment: Ember Vanguard");
    expect(warnings).toEqual([]);
    expect(r.detachments.map((d) => d.detachmentId)).toEqual(["det:ashen-wardens:ember-vanguard"]);
  });

  it("mentions a detachment only once when the header and the body both name it", () => {
    const { roster: r } = importLines("+ FACTION KEYWORD: Ashen Wardens", "+ DETACHMENT: Ember Vanguard", "", "Detachment: Ember Vanguard [2 DP] (TAKE AND HOLD)", "1x Warden Captain (80 pts): Flux pistol");
    expect(r.detachments).toEqual([{ id: "d1", detachmentId: "det:ashen-wardens:ember-vanguard", forceDisposition: "TAKE AND HOLD" }]);
  });

  it("infers Combat Patrol from a 500 point total instead of rounding it up to Incursion", () => {
    const { roster: r } = importLines("+ FACTION KEYWORD: Ashen Wardens", "+ DETACHMENT: Ember Vanguard", "+ TOTAL ARMY POINTS: 500pts", "", "1x Warden Captain (80 pts): Flux pistol");
    expect(r.battleSize).toBe("combat-patrol");
    expect(r.pointsLimit).toBe(500);
  });

  it("keeps the `N with` counts when the unit size is not declared", () => {
    const { roster: r } = importLines("Ashen Wardens", "Ember Vanguard", "Warden Squad (90 pts): 1 with Power fist, 4 with Shock maul");
    expect(r.units[0]!.models.map((g) => [g.count, g.wargear.join("+")])).toEqual([[1, "Power fist"], [4, "Shock maul"]]);
  });

  it("sizes an undeclared unit by its `N with` groups rather than by the items they carry", () => {
    const line = "Warden Squad (180 pts): 1 with Flux carbine, Power fist, 9 with Flux carbine, Shock maul";
    const { roster: r } = importLines("Ashen Wardens", "Ember Vanguard", line);
    const { roster: sized } = importLines("Ashen Wardens", "Ember Vanguard", `10x ${line}`);
    expect(r.units[0]!.models.map((g) => [g.count, g.wargear.join("+")])).toEqual([[1, "Flux carbine+Power fist"], [9, "Flux carbine+Shock maul"]]);
    expect(r.units[0]!.models).toEqual(sized.units[0]!.models);
  });

  it("does not shrink a squad to one model because it listed its wargear", () => {
    const size = (lines: string[]) => importLines("Ashen Wardens", "Ember Vanguard", ...lines).roster.units[0]!.models.reduce((s, g) => s + g.count, 0);
    expect(size(["Warden Squad (180 points)"])).toBe(5);
    expect(size(["Warden Squad (180 points)", "• 10x Flux carbine", "• 2x Shock maul"])).toBe(5);
  });

  it("keeps a workable number of copies when a list line claims an absurd one", () => {
    const { roster: r, warnings } = importLines("Ashen Wardens", "Ember Vanguard", "Ashen Crusher (180 points)", "• 999999999x Twin hail gun");
    expect(warnings).toEqual([`Ashen Crusher: kept 20 copies of "Twin hail gun" out of the 999999999 the list asks for.`]);
    expect(r.units[0]!.models[0]!.wargear).toEqual(Array.from({ length: 20 }, () => "Twin hail gun"));
  });

  it("parses wargear with per-model counts and per-model copies", () => {
    expect(parseWargearItems("1 with Flux carbine, Power fist, 9 with Flux carbine")).toEqual([
      { name: "Flux carbine", n: 1, copies: 1 },
      { name: "Power fist", n: 1, copies: 1 },
      { name: "Flux carbine", n: 9, copies: 1 },
    ]);
    expect(parseWargearList("Vortex cannon, 2x Twin hail gun")).toEqual(["Vortex cannon", "Twin hail gun", "Twin hail gun"]);
  });
});

describe("detachment lines", () => {
  it("reads the name, the DP count and the force disposition out of every dialect", () => {
    expect(parseDetSpec("Ember Vanguard")).toEqual({ name: "Ember Vanguard" });
    expect(parseDetSpec("Ember Vanguard [2 DP] (TAKE AND HOLD)")).toEqual({ name: "Ember Vanguard", dp: "2", note: "TAKE AND HOLD" });
    expect(parseDetSpec("Ember Vanguard (2 DP, TAKE AND HOLD)")).toEqual({ name: "Ember Vanguard", dp: "2", dpNote: "TAKE AND HOLD" });
    expect(parseDetSpec("Ember Vanguard (3 Detachment Points)")).toEqual({ name: "Ember Vanguard", dp: "3" });
    expect(parseDetSpec("Ember Vanguard (VARIANT)")).toEqual({ name: "Ember Vanguard", note: "VARIANT" });
    expect(parseDetSpec("Ashen Crusher (180 points)")).toEqual({ name: "Ashen Crusher", note: "180 points" });
  });

  // A line padded with spaces used to take the pattern this reads with seconds, and the meta worker runs
  // it over every stored list, so one line of a fetched list could hold a core indefinitely.
  it("reads a line padded with spaces in bounded time", () => {
    for (const pad of [2000, 20000]) {
      const started = performance.now();
      parseDetSpec(`Ember Vanguard${" ".repeat(pad)}(`);
      expect(performance.now() - started).toBeLessThan(50);
    }
  });
});

describe("unit header lines", () => {
  it("reads the reference, the count, the name, the cost and the rest out of every dialect", () => {
    expect(parseUnitHeader("Char1: 2x Canis Rex (415 pts): Warlord")).toEqual({ ref: "Char1", count: "2", label: "Canis Rex", points: "415", rest: "Warlord" });
    expect(parseUnitHeader("5x Warden Squad (90 pts): 1 with Flux carbine")).toEqual({ count: "5", label: "Warden Squad", points: "90", rest: "1 with Flux carbine" });
    expect(parseUnitHeader("Warden Squad [180pts]")).toEqual({ label: "Warden Squad", points: "180" });
    expect(parseUnitHeader("Warden Squad - 80 pts")).toEqual({ label: "Warden Squad", points: "80" });
    expect(parseUnitHeader("My list (2,000 points)")).toEqual({ label: "My list", points: "2,000" });
    expect(parseUnitHeader("Ember Vanguard")).toBeUndefined();
  });

  // The count is only read when a name follows it. "10x (2000 points)" names no unit, so the whole "10x"
  // is the name instead, and a line whose cost opens where the name would start reads the same way.
  it("gives the count back when nothing is left for the name", () => {
    expect(parseUnitHeader("10x (2000 points)")).toEqual({ label: "10x", points: "2000" });
    expect(parseUnitHeader("Char1: (2000 points)")).toEqual({ ref: "Char1", label: " ", points: "2000" });
    expect(parseUnitHeader("ab1:(80 pts)")).toEqual({ label: "ab1:", points: "80" });
  });

  it("reads a line padded with spaces in bounded time", () => {
    for (const pad of [2000, 20000]) {
      const started = performance.now();
      parseUnitHeader(`Ember Vanguard${" ".repeat(pad)}(`);
      expect(performance.now() - started).toBeLessThan(50);
    }
  });
});

/**
 * The shape the official app exports, and therefore the shape most pasted lists arrive in — it is
 * also what Goonhammer's tournament write-ups paste verbatim, so it is the format any importer of
 * published winning lists has to eat.
 */
describe("the GW app's attached-unit blocks", () => {
  const text = readFixture("rosters/gw-app-attached.txt");

  it("finds the detachment behind the Detachment Points the app prints after it", () => {
    // "Ember Vanguard (3 Detachment Points)" — the app spells it out where New Recruit writes
    // "[3 DP]". The count itself is not kept: a detachment's DP is a property of the game data, so
    // the snapshot already knows it. What matters is that the line is recognised at all.
    const { roster: r, warnings } = importRosterText(text, snapshot);
    expect(r.detachments[0]?.detachmentId).toBe("det:ashen-wardens:ember-vanguard");
    expect(warnings.join(" ")).not.toMatch(/Ember Vanguard/);
  });

  it("takes the force disposition from the bare line the app puts it on", () => {
    // The app writes the disposition on its own line under the detachment, with nothing marking it
    // as one. It is recognised by asking the detachment which dispositions it allows — so the five
    // real ones never appear in the parser, and the synthetic fixture has its own.
    const { roster: r, warnings } = importRosterText(text, snapshot);
    expect(r.detachments[0]?.forceDisposition).toBe("HOLD THE RIDGE");
    expect(warnings.join(" ")).not.toMatch(/HOLD THE RIDGE/);
  });

  it("attaches the leader to the bodyguard standing beside it", () => {
    // The app names no host: attachment is structural, by which units share an "Attached Unit N"
    // heading. The leader is listed first, so the host is only known once the block ends.
    const { roster: r } = importRosterText(text, snapshot);
    const captain = r.units.find((u) => u.datasheetId.includes("captain"));
    const squad = r.units.find((u) => u.datasheetId.includes("squad"));
    expect(captain?.attachedTo).toEqual({ unitId: squad!.id, role: "leader" });
  });

  it("does not leave the attachment line in the unit's wargear", () => {
    const { roster: r, warnings } = importRosterText(text, snapshot);
    const captain = r.units.find((u) => u.datasheetId.includes("captain"))!;
    const gear = captain.models.flatMap((g) => g.wargear ?? []);
    expect(gear.join(" ")).not.toMatch(/Attached as/i);
    expect(warnings.join(" ")).not.toMatch(/Attached as/i);
  });

  it("leaves a unit outside any block unattached", () => {
    const { roster: r } = importRosterText(text, snapshot);
    const crusher = r.units.find((u) => u.datasheetId.includes("crusher"));
    expect(crusher?.attachedTo).toBeUndefined();
  });

  it("does not treat the block headings as units", () => {
    const { roster: r, warnings } = importRosterText(text, snapshot);
    expect(r.units).toHaveLength(3);
    expect(warnings.join(" ")).not.toMatch(/Attached Unit/i);
  });
});

/**
 * A list writes a unit's models out one line at a time, and the name on the line is often not the name of
 * a profile: an 11th-edition datasheet carries one profile for the whole unit and names its models only in
 * the unit composition, and a model that has a datasheet of its own can be written inside another unit's
 * entry. Both used to be read as wargear, which left the unit at its minimum size.
 */
describe("the models a list names", () => {
  const importLines = (...lines: string[]) => importRosterText(["Ashen Wardens", "Ember Vanguard", "", ...lines].join("\n"), snapshot);
  const shape = (u: RosterUnit) => u.models.map((g) => [g.modelProfileId.split(":").pop(), g.count, g.wargear.join("+")]);
  const size = (u: RosterUnit) => u.models.reduce((n, g) => n + g.count, 0);

  it("counts the models the unit composition names, on the one profile the datasheet has", () => {
    const { roster: r, warnings } = importLines("Ember Skirmishers (140 points)", "• 1x Skirmisher Prime", "◦ 1x Skirmisher blade", "• 9x Ember Skirmisher", "◦ 9x Ember carbine");
    expect(warnings).toEqual([]);
    expect(shape(r.units[0]!)).toEqual([
      ["ember-skirmishers", 1, "Skirmisher blade"],
      ["ember-skirmishers", 9, "Ember carbine"],
    ]);
  });

  it("reads a model written with its loadout on one line, with or without brackets", () => {
    const withGear = importLines("Ember Skirmishers (140 points)", "• 1 Skirmisher Prime with Skirmisher blade", "• 9 Ember Skirmishers with Ember carbine");
    expect(withGear.warnings).toEqual([]);
    expect(shape(withGear.roster.units[0]!)).toEqual([
      ["ember-skirmishers", 1, "Skirmisher blade"],
      ["ember-skirmishers", 9, "Ember carbine"],
    ]);
    // the brackets hold the loadout the lines underneath list again, so only the name is read
    const bracketed = importLines("Ember Skirmishers (140 points)", "• 10x Ember Skirmisher (Ember carbine)", "• 10x Ember carbine");
    expect(bracketed.warnings).toEqual([]);
    expect(shape(bracketed.roster.units[0]!)).toEqual([["ember-skirmishers", 10, "Ember carbine"]]);
  });

  it("does not count the models a wargear line stood the unit up with", () => {
    // The banner is on no weapon list, so it is read as wargear before any model line has been seen.
    const { roster: r, warnings } = importLines("Ember Skirmishers (140 points)", "• 1x Ember banner", "• 1x Skirmisher Prime", "• 9x Ember Skirmisher");
    expect(size(r.units[0]!)).toBe(10);
    expect(warnings).toEqual([`Ember Skirmishers: unknown wargear "Ember banner".`]);
  });

  it("gives a model with a datasheet of its own a unit of its own", () => {
    const { roster: r, warnings } = importLines("1x Ashen Crusher (150 pts)", "• 1x Ashen Crusher: Vortex cannon, Crusher fists", "• 1x Crusher Pilot: Pilot’s sidearm, Cutting bar");
    expect(warnings).toEqual([]);
    expect(r.units.map((u) => u.datasheetId)).toEqual(["ds:ashen-wardens:ashen-crusher", "ds:ashen-wardens:crusher-pilot"]);
    expect(shape(r.units[0]!)).toEqual([["ashen-crusher", 1, "Vortex cannon+Crusher fists"]]);
    expect(shape(r.units[1]!)).toEqual([["crusher-pilot", 1, "Pilot’s sidearm+Cutting bar"]]);
  });

  it("keeps the wargear written under that model with it, and the warlord mark on the unit", () => {
    const { roster: r, warnings } = importLines("Ashen Crusher (150 points)", "• Warlord", "• 1x Ashen Crusher", "◦ 1x Vortex cannon", "• 1x Crusher Pilot", "◦ 1x Pilot’s sidearm", "◦ 1x Cutting bar");
    expect(warnings).toEqual([]);
    expect(r.units[0]!.isWarlord).toBe(true);
    expect(r.units[1]!.isWarlord).toBe(false);
    expect(shape(r.units[0]!)).toEqual([["ashen-crusher", 1, "Vortex cannon"]]);
    expect(shape(r.units[1]!)).toEqual([["crusher-pilot", 1, "Pilot’s sidearm+Cutting bar"]]);
  });

  it("keeps a model name the snapshot does not know with the unit it was written under", () => {
    const { roster: r, warnings } = importLines("Ashen Crusher (150 points)", "• 1x Ashen Crusher", "• 1x Crusher Gunner");
    expect(r.units.map((u) => u.datasheetId)).toEqual(["ds:ashen-wardens:ashen-crusher"]);
    expect(warnings).toEqual([`Ashen Crusher: unknown wargear "Crusher Gunner".`]);
  });
});

describe("a bare count line that names a weapon", () => {
  it("is wargear even when the weapon's name begins with a model profile's", () => {
    // "10x Hormagaunt" then "10x Hormagaunt talons": the second line is the squad's weapon, not ten
    // more of the squad. Modelled here by lending the Warden a weapon that starts with its name.
    const lent = structuredClone(snapshot);
    const squad = lent.data.datasheets.find((d) => d.id === "ds:ashen-wardens:warden-squad")!;
    const carbine = squad.weapons.find((w) => w.name === "Flux carbine")!;
    squad.weapons.push({ ...carbine, id: `${carbine.id}-talons`, name: "Warden talons" });
    const text = ["Ashen Wardens", "Ember Vanguard", "", "5x Warden Squad (90 pts)", "• 1x Warden Sergeant", "• 4x Warden", "• 4x Warden talons", ""].join("\n");
    const { roster: r, warnings } = importRosterText(text, lent);
    expect(warnings).toEqual([]);
    const unit = r.units[0]!;
    expect(unit.models.reduce((n, g) => n + g.count, 0)).toBe(5);
    expect(unit.models.find((g) => g.modelProfileId.endsWith(":warden"))!.wargear).toContain("Warden talons");
  });
});

describe("a model line padded with spaces", () => {
  // The pattern the `1 Custodian Guard with guardian spear` line is read with grows a lazy name group
  // against `\s+with\s+`, and the meta worker runs the importer over every stored list.
  it("is read in bounded time", () => {
    const text = ["Ashen Wardens", "Ember Vanguard", "Warden Squad (180 points)", `• 1${" ".repeat(2000)}Warden`].join("\n");
    const started = performance.now();
    importRosterText(text, snapshot);
    expect(performance.now() - started).toBeLessThan(50);
  });
});

describe("the snapshot's name index", () => {
  const text = ["Ashen Wardens - Mine (1000 points)", "Ashen Wardens", "Ember Vanguard", "Incursion (1000 points)", "", "Warden Captain (95 points)", "", "Warden Squad (180 points)", "• 1x Warden Sergeant", "• 4x Warden"].join("\n");

  it("is built once per snapshot and shared by every import against it", () => {
    const index = nameIndexOf(snapshot);
    expect(nameIndexOf(snapshot)).toBe(index);
    expect(index.names).toHaveLength(snapshot.data.datasheets.length);
    const a = importRosterText(text, snapshot).roster;
    const b = importRosterText(text, snapshot).roster;
    expect(a.units.map((u) => u.datasheetId)).toEqual(b.units.map((u) => u.datasheetId));
    expect(nameIndexOf(snapshot)).toBe(index);
  });

  it("still matches names loosely through the index: by token set, then by containment", () => {
    const ctx = new RosterImportContext(snapshot);
    expect(ctx.matchDatasheet("Squad Warden")?.id).toBe("ds:ashen-wardens:warden-squad");
    expect(ctx.matchDatasheet("The Ashen Crusher of Doom")?.id).toBe("ds:ashen-wardens:ashen-crusher");
    expect(ctx.matchDatasheet("Nothing of the sort")).toBeUndefined();
  });
});

describe("faction and battle size lines", () => {
  it("reads the faction, the size and the points limit out of every dialect", () => {
    expect(parseFactionSize("Ashen Wardens — Strike Force [2000pts]")).toEqual({ faction: "Ashen Wardens", size: "Strike Force", points: "2000" });
    expect(parseFactionSize("Ashen Wardens – Combat Patrol (1,000 points)")).toEqual({ faction: "Ashen Wardens", size: "Combat Patrol", points: "1,000" });
    expect(parseFactionSize("Ashen Wardens - Incursion")).toEqual({ faction: "Ashen Wardens", size: "Incursion" });
    expect(parseFactionSize("Ashen Wardens — Nope")).toBeUndefined();
    expect(parseFactionSize("Ashen Wardens—Incursion")).toBeUndefined();
    expect(parseFactionSize("Strike Force (2,000 points)")).toBeUndefined();
  });

  // the spaces in front of the dash belong to the pattern, and the faction name takes one of them back
  it("gives a space back when nothing else is left for the faction name", () => {
    expect(parseFactionSize("  — Incursion")).toEqual({ faction: " ", size: "Incursion" });
    expect(parseFactionSize(" — Incursion")).toBeUndefined();
  });

  it("reads a line padded with spaces in bounded time", () => {
    for (const pad of [2000, 20000]) {
      const started = performance.now();
      parseFactionSize(`"Ember Vanguard"${" ".repeat(pad)}(`);
      expect(performance.now() - started).toBeLessThan(50);
    }
  });
});

describe("the plus marks around a header line", () => {
  it("takes the marks and the spaces behind them off both ends", () => {
    expect(stripPlusMarks("++ FACTION KEYWORD: Ashen Wardens ++")).toBe("FACTION KEYWORD: Ashen Wardens");
    expect(stripPlusMarks("+ Detachment: Ember Vanguard")).toBe("Detachment: Ember Vanguard");
    expect(stripPlusMarks("no marks")).toBe("no marks");
  });

  // the pattern this reads with reaches the end of the line, so it can only give up three of a longer run
  it("leaves the spaces alone when more than three marks close the line", () => {
    expect(stripPlusMarks("a +++++")).toBe("a ++");
    expect(stripPlusMarks("a +++")).toBe("a");
  });

  it("reads a line padded with spaces in bounded time", () => {
    for (const pad of [2000, 20000]) {
      const started = performance.now();
      stripPlusMarks(`"Ember Vanguard"${" ".repeat(pad)}(`);
      expect(performance.now() - started).toBeLessThan(50);
    }
  });
});

describe("the model groups of a unit header line", () => {
  it("reads the count, the model name and the wargear in the brackets", () => {
    expect(parseGroupSpec("2x Warden (Flux carbine, Shock maul)")).toEqual({ count: "2", name: "Warden", body: "Flux carbine, Shock maul" });
    expect(parseGroupSpec("10x Battle Sister")).toEqual({ count: "10", name: "Battle Sister" });
    expect(parseGroupSpec("2x Warden (")).toBeUndefined();
    expect(parseGroupSpec("Warden")).toBeUndefined();
  });

  // the spaces after the count belong to the pattern, and the model name takes one of them back
  it("gives a space back when nothing else is left for the model name", () => {
    expect(parseGroupSpec("2x  (Flux carbine)")).toEqual({ count: "2", name: " ", body: "Flux carbine" });
  });

  it("reads a line padded with spaces in bounded time", () => {
    for (const pad of [2000, 20000]) {
      const started = performance.now();
      parseGroupSpec(`2x "Ember Vanguard"${" ".repeat(pad)}(`);
      expect(performance.now() - started).toBeLessThan(50);
    }
  });
});

describe("enhancement flags", () => {
  it("reads the name and takes the cost off, however the dialect writes it", () => {
    expect(parseEnhancement("Enhancement: Ember Blade (+15 pts)")).toBe("Ember Blade");
    expect(parseEnhancement("Enhancements: Ember Blade (+15 Points)")).toBe("Ember Blade");
    expect(parseEnhancement("Enhancement: Ember Blade (15 pts)")).toBe("Ember Blade");
    expect(parseEnhancement("Enhancement: Ember Blade")).toBe("Ember Blade");
    expect(parseEnhancement("Warlord")).toBeUndefined();
  });

  // the spaces after the colon belong to the pattern, and the name takes one of them back
  it("gives a space back when nothing else is left for the name", () => {
    expect(parseEnhancement("Enhancement: ")).toBe(" ");
    expect(parseEnhancement("Enhancement:")).toBeUndefined();
  });

  it("reads a line padded with spaces in bounded time", () => {
    for (const pad of [2000, 20000]) {
      const started = performance.now();
      parseEnhancement(`Enhancement: "Ember Blade"${" ".repeat(pad)}(`);
      expect(performance.now() - started).toBeLessThan(50);
    }
  });
});
