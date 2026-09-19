import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { zipSync, strFromU8, strToU8 } from "fflate";
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

/**
 * Rewrites the size one entry of a zip says it unpacks to. A zip lists that size for every entry, which is
 * what a hand-made archive inflates by a thousandfold, and what the importer reads before unpacking anything.
 */
function claimUnpackedSize(zip: Uint8Array, entry: string, size: number): Uint8Array {
  const out = new Uint8Array(zip);
  const view = new DataView(out.buffer);
  for (let i = 0; i + 46 <= out.length; i++) {
    if (view.getUint32(i, true) !== 0x02014b50) continue;
    const nameLen = view.getUint16(i + 28, true);
    if (strFromU8(out.subarray(i + 46, i + 46 + nameLen)) === entry) view.setUint32(i + 24, size, true);
  }
  return out;
}

describe("oversized rosz archives", () => {
  const MB = 1024 * 1024;

  it("refuses a roster that unpacks to far more than an army list", () => {
    const zip = zipSync({ "Bomb.ros": strToU8(fixture("ember-strike.ros")) });
    expect(() => importRosz(claimUnpackedSize(zip, "Bomb.ros", 400 * MB), snapshot)).toThrow(/unpacks to 400 MB/);
  });

  it("imports the roster and leaves an oversized entry beside it alone", () => {
    const zip = zipSync({ "Ember Strike.ros": strToU8(fixture("ember-strike.ros")), "thumbnail.bin": strToU8("x") });
    const { roster } = importRosz(claimUnpackedSize(zip, "thumbnail.bin", 400 * MB), snapshot);
    expect(roster.units.length).toBe(5);
  });

  it("refuses an archive holding more files than an army list ever does", () => {
    // A two-megabyte archive of twenty thousand one-byte entries used to take the best part of a
    // minute before the import gave up on it. It is refused on the count now, before any of it is
    // unpacked, and the unpacking itself reads the archive once rather than once per entry.
    const files: Record<string, Uint8Array> = {};
    for (let i = 0; i < 20000; i++) files[`j${i}.bin`] = strToU8("a");
    const started = Date.now();
    expect(() => importRosz(zipSync(files), snapshot)).toThrow(/holds 20000 files/);
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it("refuses an archive whose entries add up to more than an army list", () => {
    let zip: Uint8Array = zipSync({ "a.bin": strToU8("a"), "b.bin": strToU8("b"), "c.bin": strToU8("c") });
    for (const name of ["a.bin", "b.bin", "c.bin"]) zip = claimUnpackedSize(zip, name, 25 * MB);
    expect(() => importRosz(zip, snapshot)).toThrow(/unpacks to more than 64 MB/);
  });
});

describe("the models a .ros names", () => {
  const xml = (inner: string) => `<roster name="Named"><forces><force name="Ember Vanguard" catalogueName="Ashen Wardens"><selections>${inner}</selections></force></forces></roster>`;

  it("puts the models a unit composition names on the one profile the datasheet has", () => {
    const { roster, warnings } = importRosterXml(
      xml(`<selection name="Ember Skirmishers" type="unit"><selections>` +
        `<selection name="Skirmisher Prime" type="model" number="1"><selections><selection name="Skirmisher blade" number="1" type="upgrade"/></selections></selection>` +
        `<selection name="Ember Skirmishers" type="model" number="9"><selections><selection name="Ember carbine" number="9" type="upgrade"/></selections></selection>` +
        `</selections></selection>`),
      snapshot,
    );
    expect(warnings).toEqual([]);
    expect(shape(roster.units[0]!)).toEqual([
      ["ember-skirmishers", 1, "Skirmisher blade"],
      ["ember-skirmishers", 9, "Ember carbine"],
    ]);
  });

  it("imports a model with a datasheet of its own as a unit of its own", () => {
    const { roster, warnings } = importRosterXml(
      xml(`<selection name="Ashen Crusher" type="unit"><selections>` +
        `<selection name="Ashen Crusher" type="model" number="1"><selections><selection name="Vortex cannon" number="1" type="upgrade"/></selections></selection>` +
        `<selection name="Crusher Pilot" type="model" number="1"><selections><selection name="Cutting bar" number="1" type="upgrade"/></selections></selection>` +
        `</selections></selection>`),
      snapshot,
    );
    expect(warnings).toEqual([]);
    expect(roster.units.map((u) => u.datasheetId)).toEqual(["ds:ashen-wardens:ashen-crusher", "ds:ashen-wardens:crusher-pilot"]);
    expect(shape(roster.units[0]!)).toEqual([["ashen-crusher", 1, "Vortex cannon"]]);
    expect(shape(roster.units[1]!)).toEqual([["crusher-pilot", 1, "Cutting bar"]]);
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

  it("keeps a workable number of copies when a selection claims an absurd one", () => {
    const { roster, warnings } = importRosterXml(
      xml(`<selection name="Ashen Crusher" type="model" number="1"><selections><selection name="Twin hail gun" number="999999999" type="upgrade"/></selections></selection>`),
      snapshot,
    );
    expect(warnings).toEqual([`Ashen Crusher: kept 20 copies of "Twin hail gun" out of the 999999999 the file asks for.`]);
    expect(roster.units[0]!.models[0]!.wargear).toEqual(Array.from({ length: 20 }, () => "Twin hail gun"));
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

