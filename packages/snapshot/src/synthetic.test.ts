import { describe, expect, it } from "vitest";
import { Snapshot } from "@grimstat/schema";
import { loadSyntheticSnapshot } from "./synthetic/index";
import { verifySnapshot } from "./build";

describe("synthetic snapshot fixture", () => {
  const snap = loadSyntheticSnapshot();

  it("validates against the schema and its checksum", async () => {
    expect(() => Snapshot.parse(snap)).not.toThrow();
    expect((await verifySnapshot(snap)).ok).toBe(true);
    expect(snap.sources.map((s) => s.adapter)).toEqual(["mfm-yaml", "bsdata-json", "wahapedia-csv"]);
  });

  it("covers the shapes the engine and builder need", () => {
    const d = snap.data;
    expect(d.factions).toHaveLength(2);
    expect(d.datasheets).toHaveLength(6);
    const byName = new Map(d.datasheets.map((x) => [x.name, x]));
    expect(byName.get("Warden Captain")!.leaderTo).toEqual(["ds:ashen-wardens:warden-squad"]);
    expect(byName.get("Warden Squad")!.models.map((m) => m.name)).toEqual(["Warden Sergeant", "Warden"]);
    expect(byName.get("Warden Squad")!.composition).toEqual([
      { description: "1 Warden Sergeant", min: 1, max: 1 },
      { description: "4-9 Wardens", min: 4, max: 9 },
    ]);
    expect(byName.get("Ashen Crusher")!.keywords).toContain("VEHICLE");
    expect(byName.get("Thornlings")!.composition[0]).toMatchObject({ min: 10, max: 20 });

    const kw = new Set(d.datasheets.flatMap((x) => x.weapons.flatMap((w) => w.keywords.map((k) => k.name))));
    for (const k of ["SUSTAINED HITS", "LETHAL HITS", "DEVASTATING WOUNDS", "ANTI", "BLAST", "TORRENT", "MELTA", "RAPID FIRE", "TWIN-LINKED", "HAZARDOUS", "PRECISION", "HEAVY"]) expect(kw).toContain(k);

    const fnp = d.abilities.find((a) => a.coreKeyword === "FEEL NO PAIN")!;
    expect(fnp.coreValue).toBe(5);
    expect(byName.get("Thornlings")!.abilityIds).toContain(fnp.id);
    expect(d.abilities.some((a) => a.text === "Each time this unit makes a ranged attack, re-roll a hit roll of 1.")).toBe(true);
    expect(d.abilities.some((a) => a.name === "Siege Protocols" && !a.coreKeyword && !a.effects)).toBe(true);

    const det = d.detachments.find((x) => x.name === "Ember Vanguard")!;
    expect(det).toMatchObject({ dp: 2, uniqueTag: "Ember", forceDispositions: ["HOLD THE RIDGE"] });
    expect(det.enhancementIds).toHaveLength(2);
    expect(det.stratagemIds).toHaveLength(2);
    expect(det.ruleAbilityIds).toHaveLength(1);

    expect(d.priceRules.filter((r) => r.datasheetId === "ds:ashen-wardens:warden-squad").map((r) => r.copyRange)).toEqual([{ min: 1, max: 2 }, { min: 3 }]);
    expect(d.wargearPrices).toEqual([{ datasheetId: "ds:ashen-wardens:ashen-crusher", item: "Fusion beamer", points: 10 }]);
    expect(d.stratagems.map((s) => s.cpCost)).toContain(2);
  });

  it("records the intentional source disagreements as conflicts", () => {
    const fields = snap.conflicts.map((c) => `${c.id}:${c.field}`);
    expect(fields).toContain("ds:ashen-wardens:warden-captain:points");
    expect(fields).toContain("ds:verdant-swarm:spine-drake:models[Spine Drake].T");
    const t = snap.conflicts.find((c) => c.field === "models[Spine Drake].T")!;
    expect(t.chosen).toBe("11");
    expect(t.candidates).toEqual([
      { adapter: "wahapedia-csv", value: "11" },
      { adapter: "bsdata-json", value: "10" },
    ]);
  });
});
