import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Roster, RosterUnit } from "@grimstat/schema";
import { loadSyntheticSnapshot } from "@grimstat/snapshot";
import { SYNTHETIC_DIR } from "../test-utils";
import { exportRosterText, importRosterText, exportRosterPrintHtml } from "./index";
import { parseWargearItems, parseWargearList, splitList } from "./import";

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

  it("parses wargear with per-model counts and per-model copies", () => {
    expect(parseWargearItems("1 with Flux carbine, Power fist, 9 with Flux carbine")).toEqual([
      { name: "Flux carbine", n: 1, copies: 1 },
      { name: "Power fist", n: 1, copies: 1 },
      { name: "Flux carbine", n: 9, copies: 1 },
    ]);
    expect(parseWargearList("Vortex cannon, 2x Twin hail gun")).toEqual(["Vortex cannon", "Twin hail gun", "Twin hail gun"]);
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
