import { describe, expect, it } from "vitest";
import { loadSyntheticSnapshot } from "@grimstat/snapshot";
import type { Ability, Snapshot } from "@grimstat/schema";
import { abilityText, ruleFor, ruleForKeyword, ruleForPrinted, withoutTitleLine } from "./glossary";

const snapshot = loadSyntheticSnapshot();
const ability = (over: Partial<Ability> = {}): Ability => ({ id: "ab:x", name: "Thing", scope: "datasheet", text: "", isLegends: false, ...over });

describe("the rule behind a keyword", () => {
  it("finds a weapon keyword by the name its profile carries", () => {
    const crusher = snapshot.data.datasheets.find((d) => d.id === "ds:ashen-wardens:ashen-crusher")!;
    const twin = crusher.weapons.find((w) => w.name === "Twin hail gun")!;
    expect(twin.keywords.map((k) => k.name)).toEqual(["TWIN-LINKED", "SUSTAINED HITS"]);
    expect(ruleForKeyword(snapshot, twin.keywords[0]!)!.name).toBe("Twin-linked");
    expect(ruleForKeyword(snapshot, twin.keywords[1]!)!.text).toContain("A critical hit scores X more hits.");
  });

  it("matches however the keyword is cased, and has nothing for a keyword no source explains", () => {
    expect(ruleFor(snapshot, "sustained hits")!.key).toBe("SUSTAINED HITS");
    expect(ruleFor(snapshot, "CONVERSION")).toBeUndefined();
    expect(ruleFor(snapshot, undefined)).toBeUndefined();
  });

  it("finds a keyword spelled the way a screen prints it, value and all", () => {
    for (const printed of ["Sustained Hits 1", "SUSTAINED HITS", "Rapid Fire 2", "ANTI-VEHICLE", "Feel No Pain 5+", "Twin-linked"]) {
      expect(ruleForPrinted(snapshot, printed), printed).toBeDefined();
    }
    expect(ruleForPrinted(snapshot, "INFANTRY")).toBeUndefined();
    expect(ruleForPrinted(snapshot, undefined)).toBeUndefined();
  });

  it("has nothing at all for a snapshot that carries no glossary", () => {
    const bare: Snapshot = { ...snapshot, data: { ...snapshot.data, glossary: undefined } };
    expect(ruleFor(bare, "SUSTAINED HITS")).toBeUndefined();
  });
});

describe("what an ability says", () => {
  it("prefers the ability's own text", () => {
    expect(abilityText(snapshot, ability({ text: "Its own words.", coreKeyword: "DEEP STRIKE" }))).toBe("Its own words.");
  });

  it("falls back to the game system's rule for the core keyword it names", () => {
    expect(abilityText(snapshot, ability({ scope: "core", coreKeyword: "DEEP STRIKE" }))).toContain("more than 9");
    expect(abilityText(snapshot, ability({}))).toBe("");
  });
});

describe("withoutTitleLine", () => {
  it("drops a first line that repeats the name", () => {
    expect(withoutTitleLine("DEEP STRIKE\n\nSome units arrive later.", "Deep Strike")).toBe("Some units arrive later.");
    expect(withoutTitleLine("FEEL NO PAIN\n\nIgnore a wound.", "Feel No Pain 5+")).toBe("Ignore a wound.");
  });

  it("keeps a first line that is the rule itself", () => {
    expect(withoutTitleLine("Add 1 to the hit roll.\n\nSee 4.02.", "Heavy")).toBe("Add 1 to the hit roll.\n\nSee 4.02.");
    expect(withoutTitleLine("Torrent\nThis weapon hits automatically.", "Torrent")).toBe("Torrent\nThis weapon hits automatically.");
  });
});
