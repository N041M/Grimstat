import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { zipSync, strToU8 } from "fflate";
import { loadSyntheticSnapshot } from "@grimstat/snapshot";
import { SYNTHETIC_DIR } from "../test-utils";
import { importRosterXml, importRosz } from "./rosz";
import { splitByWargear } from "./import-common";

const snapshot = loadSyntheticSnapshot();
const fixture = (name: string) => readFileSync(join(SYNTHETIC_DIR, "rosters", name), "utf8");
const gear = (r: ReturnType<typeof importRosterXml>["roster"], datasheetId: string) => r.units.filter((u) => u.datasheetId === datasheetId);
const shape = (u: { models: { modelProfileId: string; count: number; wargear: string[] }[] }) => u.models.map((g) => [g.modelProfileId.split(":").pop(), g.count, g.wargear.join("+")]);

describe("splitByWargear", () => {
  it("keeps one group when every model carries the same items", () => {
    expect(splitByWargear(5, [{ name: "Flux carbine", n: 0 }, { name: "Shock maul", n: 5 }])).toEqual([{ count: 5, wargear: ["Flux carbine", "Shock maul"] }]);
  });
  it("peels the models carrying a partial item off into their own group", () => {
    expect(splitByWargear(4, [{ name: "Flux carbine", n: 0 }, { name: "Shock maul", n: 1 }])).toEqual([
      { count: 3, wargear: ["Flux carbine"] },
      { count: 1, wargear: ["Flux carbine", "Shock maul"] },
    ]);
  });
  it("gives each partial item its own models, never doubling them up", () => {
    const subs = splitByWargear(5, [{ name: "Power fist", n: 1 }, { name: "Shock maul", n: 4 }]);
    expect(subs.reduce((s, g) => s + g.count, 0)).toBe(5);
    expect(subs).toEqual([{ count: 4, wargear: ["Shock maul"] }, { count: 1, wargear: ["Power fist"] }]);
  });
  it("treats an item claimed by more models than the group holds as carried by all of them", () => {
    expect(splitByWargear(2, [{ name: "Flux carbine", n: 9 }])).toEqual([{ count: 2, wargear: ["Flux carbine"] }]);
  });
  it("ignores a repeated item instead of listing it twice on the same models", () => {
    expect(splitByWargear(3, [{ name: "Flux carbine", n: 0 }, { name: "Flux carbine", n: 0 }])).toEqual([{ count: 3, wargear: ["Flux carbine"] }]);
  });
});

describe("BattleScribe roster import", () => {
  const { roster, warnings } = importRosterXml(fixture("ember-strike.ros"), snapshot);

  it("reads the roster name, the Battle Size child selection and the detachment wrapper", () => {
    expect(warnings).toEqual([]);
    expect(roster.name).toBe("Ember Strike");
    expect(roster.factionId).toBe("faction:ashen-wardens");
    expect(roster.battleSize).toBe("incursion");
    expect(roster.pointsLimit).toBe(1000);
    expect(roster.detachments[0]?.detachmentId).toBe("det:ashen-wardens:ember-vanguard");
  });

  it("keeps a selection's customName as the unit's display name", () => {
    expect(gear(roster, "ds:ashen-wardens:warden-captain")[0]?.customName).toBe("Kestrel Vane");
  });

  it("splits a model group by the upgrade only some of its models took", () => {
    const squad = gear(roster, "ds:ashen-wardens:warden-squad")[0]!;
    expect(shape(squad)).toEqual([
      ["warden-sergeant", 1, "Flux carbine+Power fist"],
      ["warden", 3, "Flux carbine"],
      ["warden", 1, "Flux carbine+Shock maul"],
    ]);
  });

  it("matches a plural model selection and a count-prefixed unit name against the datasheet", () => {
    const second = gear(roster, "ds:ashen-wardens:warden-squad")[1]!;
    expect(shape(second)).toEqual([["warden-sergeant", 1, ""], ["warden", 3, ""]]);
  });

  it("links a leader through <associations> and marks the Warlord category", () => {
    const [first, second] = gear(roster, "ds:ashen-wardens:warden-captain");
    const squads = gear(roster, "ds:ashen-wardens:warden-squad");
    expect(first!.isWarlord).toBe(true);
    expect(first!.enhancementId).toBe("enh:ashen-wardens:ember-blade");
    expect(first!.attachedTo).toEqual({ unitId: squads[0]!.id, role: "leader" });
    // the second character names its host instead of pointing at it, and must take the squad still free
    expect(second!.attachedTo).toEqual({ unitId: squads[1]!.id, role: "leader" });
  });

  it("walks forces nested inside a force and takes the detachment from the force name", () => {
    const drake = gear(roster, "ds:verdant-swarm:spine-drake")[0]!;
    expect(drake.models[0]!.wargear).toEqual(["Spine volley", "Rending talons"]);
    expect(roster.detachments.map((d) => d.detachmentId)).toContain("det:verdant-swarm:thorn-tide");
  });
});

describe("rosz archive handling", () => {
  it("imports the .ros document out of a zip archive", () => {
    const bytes = zipSync({ "Ember Strike.ros": strToU8(fixture("ember-strike.ros")) });
    const { roster } = importRosz(bytes, snapshot);
    expect(roster.units.length).toBe(5);
  });
  it("accepts raw .ros bytes that are not zipped", () => {
    const { roster } = importRosz(strToU8(fixture("ember-strike.ros")), snapshot, { name: "Renamed" });
    expect(roster.name).toBe("Renamed");
  });
  it("refuses a file that is neither a zip nor roster XML", () => {
    expect(() => importRosz(strToU8("just some text"), snapshot)).toThrow(/not a \.ros XML document/i);
  });
  it("refuses XML without a roster root", () => {
    expect(() => importRosterXml("<catalogue name='x'/>", snapshot)).toThrow(/no <roster> root/i);
  });
  it("reports unknown units and detachments instead of throwing", () => {
    const xml = `<roster name="Odd"><forces><force name="Mystery Detachment" catalogueName="Ashen Wardens"><selections>` +
      `<selection name="Detachment" type="upgrade"><selections><selection name="Nonesuch Host" type="upgrade"/></selections></selection>` +
      `<selection name="Mystery Unit" type="unit"/></selections></force></forces></roster>`;
    const { roster, warnings } = importRosterXml(xml, snapshot);
    expect(roster.units).toEqual([]);
    expect(warnings).toEqual([`Unknown detachment "Nonesuch Host".`, `Unknown unit "Mystery Unit" — skipped.`, "No units found in the roster."]);
  });
});

describe("weapon multiplicities in a .ros", () => {
  const xml = (inner: string) => `<roster name="Multi"><forces><force name="Ember Vanguard" catalogueName="Ashen Wardens"><selections>${inner}</selections></force></forces></roster>`;

  it("writes out a weapon taken more than once by a single model", () => {
    const { roster, warnings } = importRosterXml(
      xml(`<selection name="Ashen Crusher" type="model" number="1"><selections><selection name="Twin hail gun" number="2" type="upgrade"/><selection name="Crusher fists" number="1" type="upgrade"/></selections></selection>`),
      snapshot,
    );
    expect(warnings).toEqual([]);
    expect(roster.units[0]!.models[0]!.wargear).toEqual(["Twin hail gun", "Twin hail gun", "Crusher fists"]);
  });

  it("turns a unit-level total back into copies per model", () => {
    const { roster } = importRosterXml(
      xml(`<selection name="Warden Squad" type="unit"><selections><selection name="Warden Sergeant" type="model" number="1"/><selection name="Warden" type="model" number="4"/><selection name="Flux carbine" number="10" type="upgrade"/></selections></selection>`),
      snapshot,
    );
    expect(shape(roster.units[0]!)).toEqual([
      ["warden-sergeant", 1, "Flux carbine+Flux carbine"],
      ["warden", 4, "Flux carbine+Flux carbine"],
    ]);
  });
});

