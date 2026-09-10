import { describe, expect, it } from "vitest";
import type { Roster } from "@grimstat/schema";
import { loadSyntheticSnapshot } from "@grimstat/snapshot";
import { exportRosterText, importRosterText, exportRosterPrintHtml } from "./index";
import { parseWargearList, splitList } from "./import";

const snapshot = loadSyntheticSnapshot();
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
