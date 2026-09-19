import { describe, expect, it } from "vitest";
import { SnapshotData, type Ability, type Detachment, type GameSystem, type PriceRule, type Publication, type Stratagem, type WargearPrice, type WeaponProfile } from "@grimstat/schema";
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

/**
 * Updating one source rebuilds the snapshot from every source it had: the fresh part, and the others
 * re-read from the files kept on this machine. These tests stand in for that by merging the same
 * parts again with one of them changed.
 *
 * The question each one asks is whether a field landed with the source that has authority over it.
 * Both ways of getting that wrong matter. A refresh that leaves its own source's fields stale does
 * nothing at all, and one that lets the refreshed source win every field replaces the points and the
 * rules text with its own copies of them.
 */
describe("refreshing one source", () => {
  /** The three parts a full import merged, as they would be read back and re-merged. */
  const original = (): Record<string, MergePart> => ({
    "mfm-yaml": part("mfm-yaml", { datasheets: [datasheet({})], priceRules: [RULE], stratagems: [stratagem({ cpCost: 1 })] }),
    "bsdata-json": part("bsdata-json", { datasheets: [datasheet({ models: [MODEL], wargearOptions: ["A model may take a plasma gun."] })], stratagems: [stratagem({ cpCost: 2, effect: "BSData's wording." })], wargearPrices: [wargear(5)] }),
    "wahapedia-csv": part("wahapedia-csv", { datasheets: [datasheet({ models: [MODEL] })], stratagems: [stratagem({ effect: "Everything explodes." })] }),
  });

  const stored = mergeSources(Object.values(original())).data;

  /** Fetch one source again with different values, and merge it with the other two as they were. */
  const refresh = (adapter: string, body: Omit<MergePart, "sourceRef">) => {
    const parts = original();
    parts[adapter] = part(adapter, body);
    return mergeSources(Object.values(parts));
  };

  it("took each field from its authority to begin with", () => {
    expect(stored.stratagems[0]).toMatchObject({ cpCost: 1, effect: "Everything explodes." });
    expect(stored.priceRules[0]!.tiers).toEqual([{ models: 5, points: 90 }]);
    expect(stored.wargearPrices[0]!.points).toBe(5);
    expect(stored.datasheets[0]!.wargearOptions).toEqual(["A model may take a plasma gun."]);
  });

  it("moves MFM's points and leaves Wahapedia's text and BSData's structure alone", () => {
    const merged = refresh("mfm-yaml", { datasheets: [datasheet({})], priceRules: [{ ...RULE, tiers: [{ models: 5, points: 75 }] }], stratagems: [stratagem({ cpCost: 4, effect: "MFM's terse wording." })] });
    expect(merged.data.priceRules[0]!.tiers).toEqual([{ models: 5, points: 75 }]);
    expect(merged.data.stratagems[0]!.cpCost).toBe(4);
    expect(merged.data.stratagems[0]!.effect).toBe("Everything explodes.");
    expect(merged.data.datasheets[0]!.wargearOptions).toEqual(["A model may take a plasma gun."]);
    expect(merged.data.wargearPrices[0]!.points).toBe(5);
  });

  it("moves Wahapedia's text and leaves MFM's points and BSData's structure alone", () => {
    const merged = refresh("wahapedia-csv", { datasheets: [datasheet({ models: [MODEL] })], stratagems: [stratagem({ cpCost: 9, effect: "It fizzles." })] });
    expect(merged.data.stratagems[0]!.effect).toBe("It fizzles.");
    expect(merged.data.stratagems[0]!.cpCost).toBe(1);
    expect(merged.data.priceRules[0]!.tiers).toEqual([{ models: 5, points: 90 }]);
    expect(merged.data.datasheets[0]!.wargearOptions).toEqual(["A model may take a plasma gun."]);
    expect(merged.data.wargearPrices[0]!.points).toBe(5);
  });

  it("moves BSData's own fields and leaves MFM's points and Wahapedia's text alone", () => {
    // The one the old merge could not do. BSData owns wargear options and wargear prices here, so
    // both have to follow the fresh copy while the points and the rules text stay where they were.
    const merged = refresh("bsdata-json", {
      datasheets: [datasheet({ models: [MODEL], wargearOptions: ["A model may take a melta gun."] })],
      stratagems: [stratagem({ cpCost: 3, effect: "BSData's new wording." })],
      wargearPrices: [wargear(15)],
    });
    expect(merged.data.datasheets[0]!.wargearOptions).toEqual(["A model may take a melta gun."]);
    expect(merged.data.wargearPrices[0]!.points).toBe(15);
    expect(merged.data.priceRules[0]!.tiers).toEqual([{ models: 5, points: 90 }]);
    expect(merged.data.stratagems[0]!.effect).toBe("Everything explodes.");
    expect(merged.data.stratagems[0]!.cpCost).toBe(1);
  });

  it("takes the fresh copy of everything when the snapshot had one source", () => {
    const merged = mergeSources([part("bsdata-json", { datasheets: [datasheet({ models: [MODEL] })], stratagems: [stratagem({ cpCost: 3, effect: "It fizzles." })], wargearPrices: [wargear(15)] })]);
    expect(merged.data.stratagems[0]).toMatchObject({ cpCost: 3, effect: "It fizzles." });
    expect(merged.data.wargearPrices[0]!.points).toBe(15);
  });

  it("keeps an entity only one source carries", () => {
    const parts = original();
    parts["bsdata-json"] = part("bsdata-json", { datasheets: [datasheet({ models: [MODEL] })], detachments: [detachment()] });
    const merged = mergeSources(Object.values(parts));
    expect(merged.data.detachments).toHaveLength(1);
    expect(() => SnapshotData.parse(merged.data)).not.toThrow();
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

  it("leaves an earlier merge of the same parts alone when the later one is edited", () => {
    const parts = sources();
    const stored = mergeSources(parts).data;
    const merged = mergeSources(parts).data;

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

  it("keeps the chapter's price by copying the parent's profiles", () => {
    // A filtered import, or a source that ships only the parent catalogue. No source describes the
    // chapter's datasheet, so it takes the profiles of the same unit in the parent faction and the
    // points the chapter publishes stay on it.
    const merged = mergeSources([
      part("mfm-yaml", {
        factions,
        datasheets: [sheet("ds:space-marines:jump", "faction:space-marines", false), sheet("ds:blood-angels:jump", "faction:blood-angels", false)],
        priceRules: [priced("ds:space-marines:jump", 85), priced("ds:blood-angels:jump", 95)],
      }),
      part("bsdata-json", { factions: [factions[0]!], datasheets: [sheet("ds:space-marines:jump", "faction:space-marines", true)] }),
    ]);
    expect(merged.data.datasheets.map((d) => d.id).sort()).toEqual(["ds:blood-angels:jump", "ds:space-marines:jump"]);
    const points = Object.fromEntries(merged.data.priceRules.map((r) => [r.datasheetId, r.tiers[0]!.points]));
    expect(points).toEqual({ "ds:space-marines:jump": 85, "ds:blood-angels:jump": 95 });
    const chapter = merged.data.datasheets.find((d) => d.id === "ds:blood-angels:jump")!;
    expect(chapter.factionId).toBe("faction:blood-angels");
    expect(chapter.models.map((m) => m.name)).toEqual(["Trooper"]);
    // its own profile ids, so two datasheets never share one
    expect(chapter.models.map((m) => m.id)).toEqual(["ds:blood-angels:jump:m"]);
    expect(merged.unmatched).toEqual([]);
  });
});

describe("mergeSources: leader and support lists", () => {
  it("drops a reference to a datasheet no source describes", () => {
    const merged = mergeSources([
      part("mfm-yaml", {
        datasheets: [
          datasheet({ id: "ds:f:captain", name: "Captain", leaderTo: ["ds:f:squad", "ds:f:ghosts"] }),
          datasheet({}),
          datasheet({ id: "ds:f:ghosts", name: "Ghosts" }),
        ],
      }),
      part("wahapedia-csv", {
        datasheets: [datasheet({ id: "ds:f:captain", name: "Captain", models: [{ ...MODEL, id: "mp:f:captain:captain" }] }), datasheet({ models: [MODEL] })],
      }),
    ]);
    expect(merged.data.datasheets.map((d) => d.id).sort()).toEqual(["ds:f:captain", "ds:f:squad"]);
    expect(merged.data.datasheets.find((d) => d.id === "ds:f:captain")!.leaderTo).toEqual(["ds:f:squad"]);
    expect(merged.warnings).toContain('datasheet ds:f:captain: leader/support reference "ds:f:ghosts" names a datasheet no source describes, so it was dropped.');
  });
});

describe("mergeSources: glossary", () => {
  const sustained = { id: "gl:sustained-hits", name: "Sustained Hits", key: "SUSTAINED HITS", text: "from bsdata" };
  const blast = { id: "gl:blast", name: "Blast", key: "BLAST", text: "from bsdata" };

  it("unions the keyword rules and takes a shared keyword from the source that ranks highest for text", () => {
    const merged = mergeSources([
      part("bsdata-json", { glossary: [sustained, blast] }),
      part("wahapedia-csv", { glossary: [{ ...sustained, text: "from wahapedia" }] }),
    ]);
    expect(merged.data.glossary!.map((g) => g.key).sort()).toEqual(["BLAST", "SUSTAINED HITS"]);
    expect(merged.data.glossary!.find((g) => g.key === "SUSTAINED HITS")!.text).toBe("from wahapedia");
  });

  it("leaves the glossary out when no source carries one", () => {
    const merged = mergeSources([part("mfm-yaml", {}), part("wahapedia-csv", {})]);
    expect(merged.data.glossary).toBeUndefined();
  });

  it("copies the entries rather than sharing them with the part they came from", () => {
    const part1 = part("bsdata-json", { glossary: [{ ...blast }] });
    const merged = mergeSources([part1]);
    merged.data.glossary![0]!.text = "edited";
    expect(part1.glossary![0]!.text).toBe("from bsdata");
  });
});

/**
 * Precedence decides which source is right about a price the sources disagree on. When the points
 * authority's table is missing rows another source has, there is nothing to disagree about, and
 * taking the authority's table whole would leave a unit at that size with no price.
 */
describe("mergeSources: a points table that is missing rows", () => {
  const priced = (rules: { min: number; max?: number; tiers: [number, number][] }[]): PriceRule[] =>
    rules.map((r) => ({ datasheetId: "ds:f:squad", copyRange: r.max === undefined ? { min: r.min } : { min: r.min, max: r.max }, tiers: r.tiers.map(([models, points]) => ({ models, points })) }));

  const sig = (rules: PriceRule[]): string =>
    rules.map((r) => `[${r.copyRange.min},${r.copyRange.max ?? ""}]${r.tiers.map((t) => `${t.models}:${t.points}`).join(",")}`).sort().join(" | ");

  const merge = (authority: PriceRule[], other: PriceRule[]): ReturnType<typeof mergeSources> =>
    mergeSources([
      part("mfm-yaml", { datasheets: [datasheet({})], priceRules: authority }),
      part("wahapedia-csv", { datasheets: [datasheet({ models: [MODEL] })], priceRules: other }),
    ]);

  it("takes the table that prices the larger unit as well", () => {
    const merged = merge(priced([{ min: 1, tiers: [[10, 160]] }]), priced([{ min: 1, tiers: [[10, 160], [20, 320]] }]));
    expect(sig(merged.data.priceRules)).toBe("[1,]10:160,20:320");
  });

  it("takes the copy bands from the source that has them when the authority states one base price", () => {
    const merged = merge(priced([{ min: 1, tiers: [[5, 100]] }]), priced([{ min: 1, max: 3, tiers: [[5, 100], [10, 190]] }, { min: 4, tiers: [[5, 110], [10, 200]] }]));
    expect(sig(merged.data.priceRules)).toBe("[1,3]5:100,10:190 | [4,]5:110,10:200");
  });

  it("records the conflict with the fuller table as the chosen one", () => {
    const merged = merge(priced([{ min: 1, tiers: [[10, 160]] }]), priced([{ min: 1, tiers: [[10, 160], [20, 320]] }]));
    expect(merged.conflicts.filter((c) => c.field === "points")).toEqual([
      {
        entity: "datasheet",
        id: "ds:f:squad",
        field: "points",
        chosen: "[1,]10:160,20:320",
        candidates: [
          { adapter: "mfm-yaml", value: "[1,]10:160" },
          { adapter: "wahapedia-csv", value: "[1,]10:160,20:320" },
        ],
      },
    ]);
  });

  it("keeps the authority's price when the two disagree about a size they both price", () => {
    const merged = merge(priced([{ min: 1, tiers: [[5, 90]] }]), priced([{ min: 1, tiers: [[5, 100], [10, 200]] }]));
    expect(sig(merged.data.priceRules)).toBe("[1,]5:90");
    expect(merged.conflicts.some((c) => c.field === "points" && c.chosen === "[1,]5:90")).toBe(true);
  });

  it("keeps the authority's copy bands rather than trading them for extra sizes", () => {
    const merged = merge(priced([{ min: 1, max: 2, tiers: [[5, 90]] }, { min: 3, tiers: [[5, 100]] }]), priced([{ min: 1, tiers: [[5, 90], [10, 180], [20, 360]] }]));
    expect(sig(merged.data.priceRules)).toBe("[1,2]5:90 | [3,]5:100");
  });

  it("carries the fuller table's smallest first-copy price into the fallback", () => {
    const merged = merge(priced([{ min: 1, tiers: [[10, 160]] }]), priced([{ min: 1, tiers: [[5, 90], [10, 160]] }]));
    expect(sig(merged.data.priceRules)).toBe("[1,]5:90,10:160");
    expect(merged.data.datasheets[0]!.fallbackPoints).toBe(90);
  });
});

/**
 * BSData is a constraint system rather than a points table, and this importer reconstructs a table by
 * replaying its modifiers. A builder that evaluates the catalogue never reaches a modifier the unit's
 * own constraints forbid, but replaying them on their own does, so the reconstruction can carry a
 * price for a size the unit cannot be.
 */
describe("mergeSources: a points table reconstructed from a rules engine", () => {
  const priced = (tiers: [number, number][], min = 1, max?: number): PriceRule[] => [
    { datasheetId: "ds:f:squad", copyRange: max === undefined ? { min } : { min, max }, tiers: tiers.map(([models, points]) => ({ models, points })) },
  ];

  const sig = (rules: PriceRule[]): string =>
    rules.map((r) => `[${r.copyRange.min},${r.copyRange.max ?? ""}]${r.tiers.map((t) => `${t.models}:${t.points}`).join(",")}`).sort().join(" | ");

  const published = (rules: PriceRule[]): MergePart => part("mfm-yaml", { datasheets: [datasheet({ models: [MODEL] })], priceRules: rules });
  const derived = (rules: PriceRule[]): MergePart => part("bsdata-json", { datasheets: [datasheet({})], priceRules: rules });

  it("drops a row for a size the published table does not list", () => {
    const merged = mergeSources([published(priced([[5, 145]])), derived(priced([[5, 145], [6, 360]]))]);
    expect(sig(merged.data.priceRules)).toBe("[1,]5:145");
    expect(merged.warnings).toContain('datasheet ds:f:squad ("Squad"): bsdata-json prices 6 models at 360. No published points table lists that size, so the row was dropped.');
  });

  it("does not let a size nobody publishes make a derived table look fuller", () => {
    const merged = mergeSources([published(priced([[5, 145]])), derived(priced([[5, 145], [6, 360]]))]);
    expect(merged.data.priceRules[0]!.tiers).toEqual([{ models: 5, points: 145 }]);
    expect(merged.conflicts.filter((c) => c.field === "points")).toEqual([]);
  });

  it("keeps the rows whose size is published and drops only the rest", () => {
    const merged = mergeSources([published(priced([[3, 85], [6, 170]])), derived(priced([[3, 85], [4, 150]]))]);
    expect(sig(merged.data.priceRules)).toBe("[1,]3:85,6:170");
    expect(merged.warnings.some((w) => w.includes("4 models at 150"))).toBe(true);
    expect(merged.warnings.some((w) => w.includes("3 models at 85"))).toBe(false);
  });

  it("names every dropped row in one warning", () => {
    const merged = mergeSources([published(priced([[3, 85], [6, 170]])), derived(priced([[1, 85], [4, 150]]))]);
    expect(merged.warnings.filter((w) => w.includes("published points table"))).toEqual([
      'datasheet ds:f:squad ("Squad"): bsdata-json prices 1 model at 85 and 4 models at 150. No published points table lists those sizes, so the rows were dropped.',
    ]);
  });

  it("still takes a copy band from the derived source when every size it prices is published", () => {
    const merged = mergeSources([published(priced([[6, 145]])), derived([...priced([[6, 145]], 1, 2), ...priced([[6, 160]], 3)])]);
    expect(sig(merged.data.priceRules)).toBe("[1,2]6:145 | [3,]6:160");
    expect(merged.warnings.some((w) => w.includes("published points table"))).toBe(false);
  });

  it("uses the derived table whole when no source publishes one", () => {
    const merged = mergeSources([derived(priced([[5, 145], [6, 360]]))], { dropStubs: false });
    expect(sig(merged.data.priceRules)).toBe("[1,]5:145,6:360");
    expect(merged.warnings.some((w) => w.includes("published points table"))).toBe(false);
  });

  it("leaves every source alone when no adapter is marked as derived", () => {
    const merged = mergeSources([published(priced([[5, 145]])), derived(priced([[5, 145], [6, 360]]))], { derivedPoints: [] });
    expect(sig(merged.data.priceRules)).toBe("[1,]5:145,6:360");
  });
});
