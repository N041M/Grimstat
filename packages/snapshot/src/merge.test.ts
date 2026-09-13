import { describe, expect, it } from "vitest";
import { SnapshotData, type Ability, type Detachment, type GameSystem, type PriceRule, type Publication, type Stratagem, type WargearPrice, type WeaponProfile } from "@grimstat/schema";
import { mergeOntoBase, mergeSources, type MergePart, type PartialDatasheet } from "./merge";

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

function wargear(points: number): WargearPrice {
  return { datasheetId: "ds:f:squad", item: "plasma gun", points };
}

function detachment(over: Partial<Detachment> = {}): Detachment {
  return { id: "det:f:vanguard", factionId: "faction:f", name: "Vanguard", dp: 1, forceDispositions: [], ruleAbilityIds: [], enhancementIds: [], stratagemIds: [], ...over };
}

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

describe("mergeOntoBase: refreshing one source over a stored snapshot", () => {
  const base = (over: Partial<MergePart>) =>
    mergeSources([part("bsdata-json", { datasheets: [datasheet({ models: [MODEL] })], ...over })]).data;

  it("keeps what a source the refresh did not touch had ranked higher", () => {
    // Wahapedia outranks BSData for rules text, so a BSData refresh must not overwrite its effect.
    // BSData outranks Wahapedia for points, so the CP cost has to follow the fresh copy.
    const stored = mergeSources([
      part("wahapedia-csv", { stratagems: [stratagem({ effect: "Everything explodes." })] }),
      part("bsdata-json", { datasheets: [datasheet({ models: [MODEL] })], stratagems: [stratagem({ cpCost: 2 })] }),
    ]).data;
    expect(stored.stratagems[0]).toMatchObject({ cpCost: 2, effect: "Everything explodes." });
    const merged = mergeOntoBase(
      { data: stored, adapters: ["wahapedia-csv", "bsdata-json"], fetchedAt: FETCHED_AT },
      [part("bsdata-json", { stratagems: [stratagem({ cpCost: 5, effect: "It fizzles." })], datasheets: [datasheet({ models: [MODEL] })] })],
    );
    expect(merged.data.stratagems[0]!.effect).toBe("Everything explodes.");
    expect(merged.data.stratagems[0]!.cpCost).toBe(5);
  });

  it("takes the refreshed source's own value where it is the authority", () => {
    // MFM owns points, so refreshing MFM over a stored snapshot must move the price.
    const stored = mergeSources([
      part("mfm-yaml", { datasheets: [datasheet({})], priceRules: [RULE] }),
      part("bsdata-json", { datasheets: [datasheet({ models: [MODEL] })] }),
    ]).data;
    const merged = mergeOntoBase(
      { data: stored, adapters: ["mfm-yaml", "bsdata-json"], fetchedAt: FETCHED_AT },
      [part("mfm-yaml", { datasheets: [datasheet({})], priceRules: [{ ...RULE, tiers: [{ models: 5, points: 75 }] }] })],
    );
    expect(merged.data.priceRules[0]!.tiers).toEqual([{ models: 5, points: 75 }]);
    expect(merged.data.datasheets[0]!.models).toEqual([MODEL]);
  });

  it("keeps the entities no fresh part mentions", () => {
    const stored = base({ stratagems: [stratagem({ effect: "Everything explodes." })] });
    const merged = mergeOntoBase({ data: stored, adapters: ["bsdata-json"], fetchedAt: FETCHED_AT }, [
      part("wahapedia-csv", { datasheets: [datasheet({ models: [MODEL] })] }),
    ]);
    expect(merged.data.stratagems).toHaveLength(1);
    expect(() => SnapshotData.parse(merged.data)).not.toThrow();
  });

  it("does not report what only the base carries as unmatched", () => {
    const stored = mergeSources([
      part("mfm-yaml", { datasheets: [datasheet({})], priceRules: [RULE] }),
      part("bsdata-json", { datasheets: [datasheet({ models: [MODEL] })], detachments: [detachment()] }),
    ]).data;
    const merged = mergeOntoBase({ data: stored, adapters: ["mfm-yaml", "bsdata-json"], fetchedAt: FETCHED_AT }, [
      part("mfm-yaml", { datasheets: [datasheet({})], priceRules: [RULE] }),
    ]);
    expect(merged.data.detachments).toHaveLength(1);
    expect(merged.unmatched).toEqual([]);
    expect(merged.warnings.some((w) => w.includes("unmatched"))).toBe(false);
  });
});

describe("mergeOntoBase: a base built from all three sources", () => {
  const ADAPTERS = ["mfm-yaml", "bsdata-json", "wahapedia-csv"];
  const stored = mergeSources([
    part("mfm-yaml", { datasheets: [datasheet({})], priceRules: [RULE], stratagems: [stratagem({ cpCost: 1 })] }),
    part("bsdata-json", { datasheets: [datasheet({ models: [MODEL] })], stratagems: [stratagem({ cpCost: 2, effect: "BSData's wording." })], wargearPrices: [wargear(5)] }),
    part("wahapedia-csv", { datasheets: [datasheet({ models: [MODEL] })], stratagems: [stratagem({ effect: "Everything explodes." })] }),
  ]).data;
  const refresh = (adapter: string, body: Omit<MergePart, "sourceRef">) => mergeOntoBase({ data: stored, adapters: ADAPTERS, fetchedAt: FETCHED_AT }, [part(adapter, body)]);

  it("took each field from its authority", () => {
    expect(stored.stratagems[0]).toMatchObject({ cpCost: 1, effect: "Everything explodes." });
    expect(stored.priceRules[0]!.tiers).toEqual([{ models: 5, points: 90 }]);
    expect(stored.wargearPrices[0]!.points).toBe(5);
  });

  it("moves the points when MFM is refreshed and keeps Wahapedia's text", () => {
    const merged = refresh("mfm-yaml", { datasheets: [datasheet({})], priceRules: [{ ...RULE, tiers: [{ models: 5, points: 75 }] }], stratagems: [stratagem({ cpCost: 4, effect: "MFM's terse wording." })] });
    expect(merged.data.priceRules[0]!.tiers).toEqual([{ models: 5, points: 75 }]);
    expect(merged.data.stratagems[0]!.cpCost).toBe(4);
    expect(merged.data.stratagems[0]!.effect).toBe("Everything explodes.");
    expect(merged.data.datasheets[0]!.models).toEqual([MODEL]);
  });

  it("moves the text when Wahapedia is refreshed and keeps MFM's points", () => {
    const merged = refresh("wahapedia-csv", { datasheets: [datasheet({ models: [MODEL] })], stratagems: [stratagem({ cpCost: 9, effect: "It fizzles." })] });
    expect(merged.data.stratagems[0]!.effect).toBe("It fizzles.");
    expect(merged.data.stratagems[0]!.cpCost).toBe(1);
    expect(merged.data.priceRules[0]!.tiers).toEqual([{ models: 5, points: 90 }]);
    expect(merged.data.wargearPrices[0]!.points).toBe(5);
  });

  it("keeps MFM's points and Wahapedia's text when BSData is refreshed", () => {
    // Both outrank BSData for the fields they own, and the base stands for both, so a BSData refresh
    // must not move either. Getting this wrong is worse than a refresh that changes nothing: it
    // replaces the points and the rules text with BSData's copies of them.
    const merged = refresh("bsdata-json", { datasheets: [datasheet({ models: [MODEL] })], stratagems: [stratagem({ cpCost: 3, effect: "BSData's new wording." })], wargearPrices: [wargear(15)] });
    expect(merged.data.stratagems[0]!.effect).toBe("Everything explodes.");
    expect(merged.data.priceRules[0]!.tiers).toEqual([{ models: 5, points: 90 }]);
  });

  it("ranks a base holding nothing but the refreshed source last", () => {
    const only = mergeSources([part("bsdata-json", { datasheets: [datasheet({ models: [MODEL] })], stratagems: [stratagem({ cpCost: 2, effect: "Everything explodes." })], wargearPrices: [wargear(5)] })]).data;
    const merged = mergeOntoBase({ data: only, adapters: ["bsdata-json"], fetchedAt: FETCHED_AT }, [
      part("bsdata-json", { datasheets: [datasheet({ models: [MODEL] })], stratagems: [stratagem({ cpCost: 3, effect: "It fizzles." })], wargearPrices: [wargear(15)] }),
    ]);
    expect(merged.data.stratagems[0]).toMatchObject({ cpCost: 3, effect: "It fizzles." });
    expect(merged.data.wargearPrices[0]!.points).toBe(15);
  });
});

describe("mergeSources: the merged data copies its inputs", () => {
  const ABILITY: Ability = {
    id: "ab:f:squad:oath",
    name: "Oath",
    scope: "datasheet",
    text: "Re-roll a hit roll of 1.",
    isLegends: false,
    effects: [{ when: { stage: "hit", side: "attacker" }, op: "reroll", target: "hit-roll", value: "ones" }],
  };
  const WEAPON: WeaponProfile = { id: "wp:f:squad:bolter", name: "Bolter", kind: "ranged", range: 24, A: 2, skill: 3, S: 4, AP: 0, D: 1, keywords: [{ name: "RAPID FIRE", value: 1, raw: "Rapid Fire 1" }] };
  const PUBLICATION: Publication = { id: "pub:core", name: "Core Book" };
  const GAME_SYSTEM: GameSystem = { id: "wh40k-11e", name: "Warhammer 40,000", edition: "11", costTypes: [{ id: "pts", name: "Points" }] };

  /** One part per source, carrying every field the merge used to hand on by reference. */
  const sources = (): MergePart[] => [
    part("wahapedia-csv", {
      gameSystem: GAME_SYSTEM,
      publications: [PUBLICATION],
      abilities: [ABILITY],
      detachments: [detachment({ forceDispositions: ["HOLD THE RIDGE"] })],
      stratagems: [stratagem({ phases: ["shooting"] })],
      datasheets: [
        datasheet({
          models: [MODEL],
          weapons: [WEAPON],
          abilityIds: [ABILITY.id],
          keywords: ["INFANTRY"],
          factionKeywords: ["FACTION"],
          composition: [{ description: "5 Troopers", min: 5, max: 5 }],
          wargearOptions: ["Any model may take a plasma gun."],
          damagedProfile: { threshold: "1-3", description: "Halve the Attacks characteristic." },
        }),
      ],
    }),
    part("mfm-yaml", { datasheets: [datasheet({})], priceRules: [RULE], wargearPrices: [wargear(5)] }),
  ];

  /** Every object and array reachable from a value. */
  function refs(v: unknown, into = new Set<object>()): Set<object> {
    if (v === null || typeof v !== "object") return into;
    if (into.has(v)) return into;
    into.add(v);
    for (const x of Object.values(v)) refs(x, into);
    return into;
  }

  it("shares no array or object with the parts it merged", () => {
    const parts = sources();
    const merged = mergeSources(parts);
    const inputs = refs(parts);
    expect([...refs(merged.data)].filter((o) => inputs.has(o))).toHaveLength(0);
  });

  it("leaves the stored snapshot alone when the refreshed one is edited", () => {
    const stored = mergeSources(sources()).data;
    const merged = mergeOntoBase({ data: stored, adapters: ["wahapedia-csv", "mfm-yaml"], fetchedAt: FETCHED_AT }, [
      part("mfm-yaml", { datasheets: [datasheet({})], priceRules: [RULE] }),
    ]).data;

    const ds = merged.datasheets[0]!;
    ds.keywords.push("VEHICLE");
    ds.factionKeywords.push("OTHER");
    ds.weapons[0]!.keywords.push({ name: "HEAVY" });
    ds.composition[0]!.description = "edited";
    ds.wargearOptions.push("Any model may take a melta.");
    ds.damagedProfile!.threshold = "1-2";
    merged.priceRules[0]!.copyRange.min = 7;
    merged.priceRules[0]!.tiers[0]!.points = 999;
    merged.publications[0]!.name = "edited";
    merged.detachments[0]!.forceDispositions.push("HOLD THE LINE");
    merged.stratagems[0]!.phases.push("fight");
    merged.abilities[0]!.effects![0]!.value = "all";
    merged.gameSystem.costTypes.push({ id: "cp", name: "CP" });

    const was = stored.datasheets[0]!;
    expect(was.keywords).toEqual(["INFANTRY"]);
    expect(was.factionKeywords).toEqual(["FACTION"]);
    expect(was.weapons[0]!.keywords).toEqual(WEAPON.keywords);
    expect(was.composition).toEqual([{ description: "5 Troopers", min: 5, max: 5 }]);
    expect(was.wargearOptions).toEqual(["Any model may take a plasma gun."]);
    expect(was.damagedProfile!.threshold).toBe("1-3");
    expect(stored.priceRules[0]!.copyRange).toEqual({ min: 1 });
    expect(stored.priceRules[0]!.tiers).toEqual([{ models: 5, points: 90 }]);
    expect(stored.publications).toEqual([PUBLICATION]);
    expect(stored.detachments[0]!.forceDispositions).toEqual(["HOLD THE RIDGE"]);
    expect(stored.stratagems[0]!.phases).toEqual(["shooting"]);
    expect(stored.abilities[0]!.effects![0]!.value).toBe("ones");
    expect(stored.gameSystem.costTypes).toEqual([{ id: "pts", name: "Points" }]);
    expect(() => SnapshotData.parse(stored)).not.toThrow();
  });
});

describe("a chapter that pays different points from its parent", () => {
  // The MFM adapter gives a chapter its own datasheet id when that chapter's file charges different
  // points, so the parent id keeps the parent's price. The merge has to carry both through: the
  // datasheet keys include a family-level name key, and a fold there would put the two prices back
  // on one id and silently pick one.
  const faction = (id: string, name: string, parentFactionId?: string) => ({ id, gameSystemId: "wh40k-11e", name, keywords: [], ...(parentFactionId ? { parentFactionId } : {}) });
  const sheet = (id: string, factionId: string, withModel: boolean) => ({
    id,
    gameSystemId: "wh40k-11e",
    factionId,
    name: "Jump Intercessors",
    ...(withModel ? { models: [{ id: `${id}:m`, name: "Trooper", T: 4, Sv: 3, W: 2 }] } : {}),
  });
  const priced = (datasheetId: string, points: number): PriceRule => ({ datasheetId, copyRange: { min: 1 }, tiers: [{ models: 5, points }] });
  const factions = [faction("faction:space-marines", "Space Marines"), faction("faction:blood-angels", "Blood Angels", "faction:space-marines")];

  it("keeps each faction's own price when both sources carry the chapter", () => {
    const merged = mergeSources([
      part("mfm-yaml", {
        factions,
        datasheets: [sheet("ds:space-marines:jump", "faction:space-marines", false), sheet("ds:blood-angels:jump", "faction:blood-angels", false)],
        priceRules: [priced("ds:space-marines:jump", 85), priced("ds:blood-angels:jump", 95)],
      }),
      part("bsdata-json", {
        factions,
        datasheets: [sheet("ds:space-marines:jump", "faction:space-marines", true), sheet("ds:blood-angels:jump", "faction:blood-angels", true)],
      }),
    ]);
    expect(merged.data.datasheets.map((d) => d.id).sort()).toEqual(["ds:blood-angels:jump", "ds:space-marines:jump"]);
    const points = Object.fromEntries(merged.data.priceRules.map((r) => [r.datasheetId, r.tiers[0]!.points]));
    expect(points).toEqual({ "ds:space-marines:jump": 85, "ds:blood-angels:jump": 95 });
  });

  it("falls back to the parent's price when the structure source has no chapter datasheet", () => {
    // A filtered import, or a source that ships only the parent catalogue. The chapter datasheet has
    // no model profile from anywhere, so it is dropped and reported rather than kept as a stub.
    const merged = mergeSources([
      part("mfm-yaml", {
        factions,
        datasheets: [sheet("ds:space-marines:jump", "faction:space-marines", false), sheet("ds:blood-angels:jump", "faction:blood-angels", false)],
        priceRules: [priced("ds:space-marines:jump", 85), priced("ds:blood-angels:jump", 95)],
      }),
      part("bsdata-json", { factions: [factions[0]!], datasheets: [sheet("ds:space-marines:jump", "faction:space-marines", true)] }),
    ]);
    expect(merged.data.datasheets.map((d) => d.id)).toEqual(["ds:space-marines:jump"]);
    expect(merged.data.priceRules.map((r) => r.tiers[0]!.points)).toEqual([85]);
    expect(merged.unmatched.some((u) => u.entity === "datasheet" && u.id === "ds:blood-angels:jump")).toBe(true);
  });
});
