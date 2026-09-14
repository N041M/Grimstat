import { describe, expect, it } from "vitest";
import { loadSyntheticSnapshot } from "@grimstat/snapshot";
import { anchor } from "./anchors";
import { scanIndexOf } from "./names";
import { canBeCost, canBeCount, costAfter, multipliersBefore, roleOf, sizesOf } from "./numbers";
import { placeEvidence, type UnitAnchor } from "./own";
import { fromWords, tokenise } from "./tokens";

const snapshot = loadSyntheticSnapshot();
const index = scanIndexOf(snapshot);

const SQUAD = "ds:ashen-wardens:warden-squad";
const CRUSHER = "ds:ashen-wardens:ashen-crusher";
const CAPTAIN = "ds:ashen-wardens:warden-captain";
const THORNLINGS = "ds:verdant-swarm:thornlings";

describe("sizesOf", () => {
  it("reads the counts and the costs out of the price table", () => {
    // Two copy bands price the same two model counts, so one count has two costs.
    expect(sizesOf(snapshot, SQUAD)).toMatchObject({ models: [5, 10], points: [90, 100, 180, 200] });
  });

  it("sums the composition bounds across its lines", () => {
    // "1 Warden Sergeant" and "4-9 Wardens" is a unit of five to ten.
    expect(sizesOf(snapshot, SQUAD)).toMatchObject({ min: 5, max: 10 });
    expect(sizesOf(snapshot, CRUSHER)).toMatchObject({ min: 1, max: 1 });
  });
});

describe("roleOf", () => {
  const squad = sizesOf(snapshot, SQUAD);

  it("tells a count from a cost using the unit's own table", () => {
    expect(roleOf(squad, 5)).toBe("count");
    expect(roleOf(squad, 90)).toBe("cost");
    expect(roleOf(squad, 999)).toBe("neither");
  });

  it("accepts a count the table does not price but the composition allows", () => {
    expect(canBeCount(squad, 7)).toBe(true);
    expect(canBeCount(squad, 11)).toBe(false);
  });

  it("accepts a cost from any copy band, because a later copy costs more", () => {
    expect(canBeCost(squad, 90)).toBe(true);
    expect(canBeCost(squad, 100)).toBe(true);
  });

  it("knows a one-model unit's number cannot be a count", () => {
    expect(roleOf(sizesOf(snapshot, CRUSHER), 150)).toBe("cost");
    expect(canBeCount(sizesOf(snapshot, CRUSHER), 150)).toBe(false);
  });
});

describe("multipliersBefore", () => {
  /** The readings of the numbers in front of the first datasheet named in `text`. */
  const before = (text: string, datasheetId: string) => {
    const tokens = tokenise(text);
    const span = anchor(tokens, index).find((s) => s.entry.ids.includes(datasheetId))!;
    return multipliersBefore(tokens, span.from, sizesOf(snapshot, datasheetId)).map((m) => `${m.copies}x${m.models ?? "?"}`);
  };

  it("reads two units of five where five is a size and two is not", () => {
    expect(before("2 x 5 Warden Squad", SQUAD)).toEqual(["2x5"]);
  });

  it("reads ten models where ten is a size", () => {
    expect(before("10x Warden Squad", SQUAD)).toEqual(["1x10"]);
  });

  it("reads two units where the datasheet is one model", () => {
    expect(before("2 x Ashen Crusher", CRUSHER)).toEqual(["2x?"]);
  });

  it("offers both readings when the data permits both", () => {
    // Thornlings field at 10 to 20, so "10 x 20 Thornlings" is ten units of twenty or one of ten.
    expect(before("10 x 20 Thornlings", THORNLINGS)).toEqual(["10x20", "1x10"]);
  });

  it("reads one unit when no number was written", () => {
    expect(before("Warden Captain", CAPTAIN)).toEqual(["1x?"]);
  });
});

describe("costAfter", () => {
  const cost = (text: string, datasheetId: string) => {
    const tokens = tokenise(text);
    const span = anchor(tokens, index).find((s) => s.entry.ids.includes(datasheetId))!;
    return costAfter(tokens, span.to, sizesOf(snapshot, datasheetId));
  };

  it("takes a number after the name that the unit could cost", () => {
    expect(cost("Ashen Crusher 150", CRUSHER)).toBe(150);
    expect(cost("10x Warden Squad 180", SQUAD)).toBe(180);
  });

  it("takes nothing from a list that printed no costs", () => {
    expect(cost("2 x 5 Warden Squad", SQUAD)).toBeUndefined();
  });

  it("does not reach on to the next line for one", () => {
    expect(cost("Ashen Crusher\n150", CRUSHER)).toBeUndefined();
  });
});

describe("placeEvidence", () => {
  const unitsAndEvidence = (text: string) => {
    const tokens = tokenise(text);
    const spans = anchor(tokens, index);
    const units: UnitAnchor[] = spans.flatMap((s) => (s.entry.kind === "datasheet" ? [{ span: s, datasheetId: s.entry.ids[0]! }] : []));
    return { tokens, units, spans };
  };

  it("places a weapon on the only unit that can carry it, whatever the order", () => {
    // The weapons are written against the wrong units, the way interleaved columns deliver them.
    const { tokens, units, spans } = unitsAndEvidence("Warden Captain\nAshen Crusher\nRelic blade\nFusion beamer");
    const relic = spans.find((s) => s.entry.name === "Relic blade")!;
    const beamer = spans.find((s) => s.entry.name === "Fusion beamer")!;
    expect(placeEvidence(snapshot, units, relic, tokens)).toMatchObject({ unit: 0, reason: "only-owner" });
    expect(placeEvidence(snapshot, units, beamer, tokens)).toMatchObject({ unit: 1, reason: "only-owner" });
  });

  it("places an enhancement on a character rather than on a squad", () => {
    const { tokens, units, spans } = unitsAndEvidence("Warden Squad\nWarden Captain\nEmber Blade");
    const blade = spans.find((s) => s.entry.kind === "enhancement")!;
    expect(placeEvidence(snapshot, units, blade, tokens)).toMatchObject({ unit: 1, reason: "only-owner" });
  });

  it("falls back to where it sits when two units could own it", () => {
    const word = (text: string, x: number, y: number) => ({ text, confidence: 0.9, box: { x, y, w: text.length * 9, h: 14 } });
    // Two Warden Squads, and a Flux carbine drawn under the second one.
    const tokens = fromWords([word("Warden", 10, 10), word("Squad", 70, 10), word("Warden", 400, 10), word("Squad", 460, 10), word("Flux", 400, 40), word("carbine", 440, 40)]);
    const spans = anchor(tokens, index);
    const units: UnitAnchor[] = spans.flatMap((s) => (s.entry.kind === "datasheet" ? [{ span: s, datasheetId: s.entry.ids[0]! }] : []));
    const carbine = spans.find((s) => s.entry.kind === "weapon")!;
    expect(units).toHaveLength(2);
    expect(placeEvidence(snapshot, units, carbine, tokens)).toMatchObject({ unit: 1, reason: "position", candidates: [0, 1] });
  });

  it("falls back to the nearest name in the stream when there are no boxes", () => {
    const { tokens, units, spans } = unitsAndEvidence("Warden Squad\nWarden Squad\nFlux carbine");
    const carbine = spans.find((s) => s.entry.kind === "weapon")!;
    expect(placeEvidence(snapshot, units, carbine, tokens)).toMatchObject({ unit: 1, reason: "stream" });
  });

  it("places nothing when no unit in the list can own it", () => {
    const { tokens, units, spans } = unitsAndEvidence("Warden Squad\nAcid lance");
    const lance = spans.find((s) => s.entry.name === "Acid lance")!;
    expect(placeEvidence(snapshot, units, lance, tokens)).toMatchObject({ unit: undefined, reason: "none" });
  });
});
