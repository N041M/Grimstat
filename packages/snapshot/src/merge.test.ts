import { describe, expect, it } from "vitest";
import { SnapshotData, type PriceRule, type Stratagem } from "@grimstat/schema";
import { mergeSources, type MergePart, type PartialDatasheet } from "./merge";

const FETCHED_AT = "2026-01-01T00:00:00.000Z";

function part(adapter: string, body: Omit<MergePart, "sourceRef">): MergePart {
  return { ...body, sourceRef: { adapter, fetchedAt: FETCHED_AT } };
}

function stratagem(over: Partial<Stratagem>): Stratagem {
  return { id: "strat:boom", name: "Boom", cpCost: 1, phases: [], ...over };
}

function datasheet(over: Partial<PartialDatasheet>): PartialDatasheet {
  return { id: "ds:f:squad", gameSystemId: "wh40k-11e", factionId: "faction:f", name: "Squad", ...over };
}

const MODEL = { id: "mp:f:squad:trooper", name: "Trooper", T: 4, Sv: 3, W: 1 };

const RULE: PriceRule = { datasheetId: "ds:f:squad", copyRange: { min: 1 }, tiers: [{ models: 5, points: 90 }] };

describe("mergeSources: stratagems", () => {
  it("takes each field from the first source that has it", () => {
    const merged = mergeSources([
      part("wahapedia-csv", { stratagems: [stratagem({ factionId: "faction:f", effect: "Everything explodes." })] }),
      part("bsdata-json", { stratagems: [stratagem({ detachmentId: "det:f:d" })] }),
    ]);
    expect(merged.data.stratagems).toHaveLength(1);
    const s = merged.data.stratagems[0]!;
    expect(s.detachmentId).toBe("det:f:d");
    expect(s.factionId).toBe("faction:f");
    expect(s.effect).toBe("Everything explodes.");
  });

  it("keeps the rules text when the points authority carries only the attribution ids", () => {
    const merged = mergeSources([
      part("wahapedia-csv", { stratagems: [stratagem({ detachmentId: "det:f:d" })] }),
      part("bsdata-json", { stratagems: [stratagem({ factionId: "faction:f", when: "Your Shooting phase.", target: "One unit.", effect: "It shoots twice.", phases: ["shooting"], type: "Battle Tactic" })] }),
    ]);
    const s = merged.data.stratagems[0]!;
    expect(s).toMatchObject({
      detachmentId: "det:f:d",
      factionId: "faction:f",
      when: "Your Shooting phase.",
      target: "One unit.",
      effect: "It shoots twice.",
      phases: ["shooting"],
      type: "Battle Tactic",
    });
  });

  it("takes the CP cost from the points authority", () => {
    const merged = mergeSources([
      part("wahapedia-csv", { stratagems: [stratagem({ cpCost: 2 })] }),
      part("mfm-yaml", { stratagems: [stratagem({ cpCost: 1 })] }),
    ]);
    expect(merged.data.stratagems[0]!.cpCost).toBe(1);
  });
});

describe("mergeSources: datasheets without a model profile", () => {
  const stub = [part("mfm-yaml", { datasheets: [datasheet({})], priceRules: [RULE] })];

  it("drops the datasheet by default and reports it as unmatched", () => {
    const merged = mergeSources(stub);
    expect(merged.data.datasheets).toEqual([]);
    expect(merged.unmatched).toEqual([{ adapter: "mfm-yaml", entity: "datasheet", id: "ds:f:squad", name: "Squad", reason: "no model profile in any source" }]);
    expect(() => SnapshotData.parse(merged.data)).not.toThrow();
  });

  it("keeps it with a placeholder profile when dropStubs is false", () => {
    const merged = mergeSources(stub, { dropStubs: false });
    expect(merged.data.datasheets).toHaveLength(1);
    expect(merged.data.datasheets[0]!.models).toEqual([{ id: "mp:f:squad:unknown", name: "Squad", T: 1, Sv: 7, W: 1 }]);
    expect(merged.warnings).toContain('datasheet ds:f:squad ("Squad") has no model profile in any source; a placeholder profile was added');
    expect(() => SnapshotData.parse(merged.data)).not.toThrow();
  });

  it("uses the real profile when a source has one", () => {
    const merged = mergeSources([...stub, part("wahapedia-csv", { datasheets: [datasheet({ models: [MODEL] })] })], { dropStubs: false });
    expect(merged.data.datasheets[0]!.models).toEqual([MODEL]);
    expect(merged.warnings.some((w) => w.includes("placeholder profile"))).toBe(false);
  });
});
