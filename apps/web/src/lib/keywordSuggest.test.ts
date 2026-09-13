import { describe, expect, it } from "vitest";
import { keywordRegistry } from "@grimstat/game-40k-11e";
import { loadSyntheticSnapshot } from "@grimstat/snapshot";
import { keywordProblems, keywordsByName, matchKeywords, nearest, replaceToken, tokenAt, unitKeywordVocabulary } from "./keywordSuggest";

const known = keywordRegistry.suggestions();

describe("the token under the caret", () => {
  it("is the piece of the list the caret sits in", () => {
    const text = "Lethal Hits, Rapid Fire 1, Blast";
    expect(tokenAt(text, 3).text).toBe("Lethal Hits");
    expect(tokenAt(text, 20).text).toBe("Rapid Fire 1");
    expect(tokenAt(text, text.length).text).toBe("Blast");
    expect(tokenAt("", 0).text).toBe("");
  });

  it("is replaced without disturbing the rest of the list", () => {
    const text = "Lethal Hits, Rapd, Blast";
    const next = replaceToken(text, tokenAt(text, 15), "Rapid Fire 1");
    expect(next.text).toBe("Lethal Hits, Rapid Fire 1, Blast");
    expect(next.text.slice(0, next.caret)).toBe("Lethal Hits, Rapid Fire 1");
    // A list that is still empty takes the keyword on its own, with no leading space.
    expect(replaceToken("", tokenAt("", 0), "Blast").text).toBe("Blast");
  });
});

describe("what the field offers", () => {
  it("puts the keywords a token starts before the ones it only appears in", () => {
    expect(matchKeywords("lethal", known)).toEqual(["Lethal Hits"]);
    expect(matchKeywords("fire", known)).toEqual(["Indirect Fire", "Linked Fire", "Rapid Fire 1"]);
    expect(matchKeywords("", known)).toEqual([]);
  });

  it("offers nothing for a keyword already typed in full", () => {
    expect(matchKeywords("Blast", known)).toEqual([]);
    expect(matchKeywords("blast", known)).toEqual([]);
  });
});

describe("keywords the game system does not know", () => {
  it("names a misspelling and the spelling it meant", () => {
    expect(keywordProblems("Sustaned Hits 1", known)).toEqual([{ raw: "Sustaned Hits 1", suggestion: "Sustained Hits 1" }]);
    expect(keywordProblems("Rapid-Fire 1", known)).toEqual([{ raw: "Rapid-Fire 1", suggestion: "Rapid Fire 1" }]);
  });

  it("keeps the value the player typed when it corrects the spelling", () => {
    expect(keywordProblems("Sustaned Hits D3", known)[0]?.suggestion).toBe("Sustained Hits D3");
    expect(keywordProblems("Rapid-Fire 2", known)[0]?.suggestion).toBe("Rapid Fire 2");
    // Typed without one, the example's own value shows what the keyword takes.
    expect(keywordProblems("Sustaned Hits", known)[0]?.suggestion).toBe("Sustained Hits 1");
  });

  it("names a keyword nothing is close to, with nothing to offer", () => {
    expect(keywordProblems("Wobbly 3", known)).toEqual([{ raw: "Wobbly 3" }]);
  });

  it("says nothing about keywords that are known, whatever their capitals", () => {
    expect(keywordProblems("lethal hits, TWIN LINKED, Melta 2, Anti-vehicle 4+, Sustained Hits D3", known)).toEqual([]);
  });

  it("reads the printed spelling of each keyword back to its canonical name", () => {
    const index = keywordsByName(known);
    expect(index.get("RAPID FIRE")).toBe("Rapid Fire 1");
    expect(index.get("ANTI")).toBe("Anti-infantry 4+");
    expect(index.get("LETHAL HITS")).toBe("Lethal Hits");
  });
});

describe("how near a spelling has to be", () => {
  it("keeps short names apart and allows more slack in long ones", () => {
    expect(nearest("LANCE", ["HEAVY", "BLAST", "LANCE"])).toBe("LANCE");
    // One letter out of five could be any of several five-letter keywords, so nothing is offered.
    expect(nearest("LANCK", ["HEAVY", "BLAST", "TORRENT"])).toBeUndefined();
    expect(nearest("DEVASTATNG WONDS", ["DEVASTATING WOUNDS"])).toBe("DEVASTATING WOUNDS");
    expect(nearest("", ["BLAST"])).toBeUndefined();
  });
});

describe("the unit keyword list", () => {
  it("is empty without data", () => {
    expect(unitKeywordVocabulary(undefined)).toEqual([]);
  });

  it("is every keyword the loaded datasheets carry, upper-case and once each", () => {
    const vocab = unitKeywordVocabulary(loadSyntheticSnapshot());
    expect(vocab.length).toBeGreaterThan(0);
    expect(new Set(vocab).size).toBe(vocab.length);
    expect(vocab.every((k) => k === k.toUpperCase() && k.length > 0)).toBe(true);
    expect([...vocab].sort((a, b) => a.localeCompare(b))).toEqual(vocab);
    expect(vocab).toContain("INFANTRY");
  });
});
