import { describe, expect, it } from "vitest";
import { loadSyntheticSnapshot } from "@grimstat/snapshot";
import { anchor } from "./anchors";
import { editDistance, matchName, scanIndexOf } from "./names";
import { fromWords, integerOf, tokenise } from "./tokens";

const snapshot = loadSyntheticSnapshot();
const index = scanIndexOf(snapshot);

/** The names a stream anchored to, as "kind:Name", in the order they were read. */
const namesIn = (text: string): string[] => anchor(tokenise(text), index).map((s) => `${s.entry.kind}:${s.entry.name}`);

describe("tokenise", () => {
  it("numbers the lines and keeps the words", () => {
    const out = tokenise("Warden Squad\n2 x 5 Thornlings");
    expect(out.map((t) => t.text)).toEqual(["Warden", "Squad", "2", "x", "5", "Thornlings"]);
    expect(out.map((t) => t.line)).toEqual([0, 0, 1, 1, 1, 1]);
  });

  it("splits a multiplier and a detachment cost off the word they are glued to", () => {
    expect(tokenise("10x Warden Squad").map((t) => t.text)).toEqual(["10", "x", "Warden", "Squad"]);
    expect(tokenise("1DP").map((t) => t.text)).toEqual(["1", "DP"]);
  });

  it("leaves a name that merely contains digits alone", () => {
    expect(tokenise("Mk10 Warden").map((t) => t.text)).toEqual(["Mk10", "Warden"]);
  });

  it("reads a whole number through trailing punctuation", () => {
    const [a, b, c] = tokenise("415, 5 x");
    expect(integerOf(a!)).toBe(415);
    expect(integerOf(b!)).toBe(5);
    expect(integerOf(c!)).toBeUndefined();
  });
});

describe("fromWords", () => {
  const word = (text: string, x: number, y: number) => ({ text, confidence: 0.9, box: { x, y, w: text.length * 10, h: 14 } });

  it("groups words into lines by where they sit, not by the order they arrived", () => {
    const out = fromWords([word("Squad", 70, 100), word("Warden", 10, 102), word("Thornlings", 10, 140)]);
    expect(out.map((t) => t.text)).toEqual(["Warden", "Squad", "Thornlings"]);
    expect(out.map((t) => t.line)).toEqual([0, 0, 1]);
  });
});

describe("editDistance", () => {
  it("counts a transposition as one step", () => {
    expect(editDistance("proseuctors", "prosecutors", 4)).toBe(1);
    expect(editDistance("wardne", "warden", 4)).toBe(1);
  });

  it("gives up once the bound is passed", () => {
    expect(editDistance("warden squad", "thornlings", 2)).toBeGreaterThan(2);
  });
});

describe("matchName", () => {
  it("finds a name that was read exactly", () => {
    const [best] = matchName(index, "Warden Squad");
    expect(best?.entry.name).toBe("Warden Squad");
    expect(best?.score).toBe(1);
  });

  it("finds a name a recogniser misread", () => {
    expect(matchName(index, "Warden Squacl")[0]?.entry.name).toBe("Warden Squad");
    expect(matchName(index, "Thornlinqs")[0]?.entry.name).toBe("Thornlings");
  });

  it("finds a name its writer misspelled", () => {
    expect(matchName(index, "Wardne Squad")[0]?.entry.name).toBe("Warden Squad");
  });

  it("refuses a name that is simply a different name", () => {
    expect(matchName(index, "Land Raider Crusader")).toEqual([]);
  });

  it("indexes weapons, models, detachments, enhancements and dispositions", () => {
    expect(matchName(index, "Flux carbine")[0]?.entry.kind).toBe("weapon");
    expect(matchName(index, "Warden Sergeant")[0]?.entry.kind).toBe("model");
    expect(matchName(index, "Ember Vanguard")[0]?.entry.kind).toBe("detachment");
    expect(matchName(index, "Ember Blade")[0]?.entry.kind).toBe("enhancement");
    expect(matchName(index, "HOLD THE RIDGE")[0]?.entry.kind).toBe("disposition");
  });

  it("holds one entry for a weapon several datasheets carry", () => {
    const spine = matchName(index, "Spine volley")[0]?.entry;
    expect(spine?.ids).toEqual(["ds:verdant-swarm:spine-drake"]);
    const carbine = matchName(index, "Flux carbine")[0]?.entry;
    expect(carbine?.ids).toEqual(["ds:ashen-wardens:warden-squad"]);
  });
});

describe("anchor", () => {
  it("takes the whole name rather than the word inside it", () => {
    expect(namesIn("Warden Squad")).toEqual(["datasheet:Warden Squad"]);
  });

  it("ignores the words that are part of no name", () => {
    expect(namesIn("by Travis Knights, 3-0 at OP RTT #2 11th Ed")).toEqual([]);
    expect(namesIn("Knocked out by Orks War Horde 85-75")).toEqual([]);
  });

  it("reads a list the writer laid out as bullets", () => {
    const list = ["Ember Vanguard - HOLD THE RIDGE", "Characters", "Warden Captain - Relic blade (Ember Blade) [Warden Squad]", "Squads", "2 x 5 Warden Squad", "Vehicles", "2 x Ashen Crusher"].join("\n");
    expect(namesIn(list)).toEqual([
      "detachment:Ember Vanguard",
      "disposition:HOLD THE RIDGE",
      "datasheet:Warden Captain",
      "weapon:Relic blade",
      "enhancement:Ember Blade",
      "datasheet:Warden Squad",
      "datasheet:Warden Squad",
      "datasheet:Ashen Crusher",
    ]);
  });

  /*
   * The claim the whole design rests on. A stream whose columns came back interleaved, which is what
   * recognising a two-column overlay across its full width produces, has to read as the same army as
   * the same words in the order they were written.
   */
  it("reads the same names out of a stream whose columns were interleaved", () => {
    const asWritten = ["Warden Captain 80", "Relic blade", "Ashen Crusher 150", "Fusion beamer", "Thornlings 60", "Barbed claws", "Spine Drake 210", "Acid lance"].join("\n");
    const asRead = ["Thornlings 60", "Warden Captain 80", "Barbed claws", "Relic blade", "Spine Drake 210", "Ashen Crusher 150", "Acid lance", "Fusion beamer"].join("\n");
    expect(namesIn(asRead).sort()).toEqual(namesIn(asWritten).sort());
    expect(namesIn(asRead).filter((n) => n.startsWith("datasheet:")).sort()).toEqual(["datasheet:Ashen Crusher", "datasheet:Spine Drake", "datasheet:Thornlings", "datasheet:Warden Captain"]);
  });

  it("reads a name split across two lines by the layout", () => {
    expect(namesIn("Warden\nSquad")).toEqual(["datasheet:Warden Squad"]);
  });

  it("prefers the faction it was told the units voted for", () => {
    const plain = anchor(tokenise("Warden Squad"), index);
    expect(plain[0]?.entry.ids).toEqual(["ds:ashen-wardens:warden-squad"]);
    const preferred = anchor(tokenise("Warden Squad"), index, { preferIds: new Set(["ds:ashen-wardens:warden-squad"]) });
    expect(preferred[0]?.entry.name).toBe("Warden Squad");
  });

  it("offers what else a misread name could have been", () => {
    const [span] = anchor(tokenise("Warden Squacl"), index);
    expect(span?.entry.name).toBe("Warden Squad");
    expect(span?.text).toBe("Warden Squacl");
  });
});
