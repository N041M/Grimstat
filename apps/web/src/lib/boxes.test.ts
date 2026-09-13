import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadSyntheticSnapshot } from "@grimstat/snapshot";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { BoxFileSchema, type BoxSet } from "../data/boxes";
import { boxesByYear, boxesFor, forgetBoxSets, isOlderThanEdition, LEGENDS_FROM, linesForFactions, loadBoxSets, modelsByDatasheet, nameLine, resolveBox, unitSize } from "./boxes";

const snapshot = loadSyntheticSnapshot();

/** The file the app ships and reads at runtime, checked here as the app would check it. */
const BOXES_FILE = fileURLToPath(new URL("../../public/boxes.json", import.meta.url));
const file = BoxFileSchema.parse(JSON.parse(readFileSync(BOXES_FILE, "utf8")));
const BOX_SETS: readonly BoxSet[] = file.boxes;
const ds = (id: string) => snapshot.data.datasheets.find((d) => d.id === `ds:${id}`)!;

/** Boxes in the synthetic vocabulary, so nothing here asserts a real product's contents. */
const box = (lines: BoxSet["lines"]): BoxSet => ({ id: "b", name: "Test box", kind: "battleforce", announced: "2026-01-01", lines, source: "test" });

describe("reading a box against a snapshot", () => {
  it("counts a line that gives models as it is written", () => {
    const read = resolveBox(box([{ name: "Warden Squad", models: 10 }]), snapshot);
    expect(read.lines[0]!.ds?.id).toBe("ds:ashen-wardens:warden-squad");
    expect(read.lines[0]!.models).toBe(10);
    expect(read.models).toBe(10);
    expect(read.unknown).toEqual([]);
  });

  /** "a Command Squad" is one unit; how many models that is belongs to the datasheet. */
  it("asks the datasheet how many models a unit is", () => {
    expect(unitSize(ds("ashen-wardens:warden-squad"))).toBe(5);
    expect(unitSize(ds("ashen-wardens:warden-captain"))).toBe(1);
    const read = resolveBox(box([{ name: "Warden Squad", units: 2 }]), snapshot);
    expect(read.lines[0]!.models).toBe(10);
  });

  it("reads the same words in another order as the same unit", () => {
    const read = resolveBox(box([{ name: "Squad Warden", models: 5 }, { name: "The Ashen Crusher", models: 1 }]), snapshot);
    expect(read.lines.map((l) => l.ds?.id)).toEqual(["ds:ashen-wardens:warden-squad", "ds:ashen-wardens:ashen-crusher"]);
  });

  /**
   * A name that is merely contained in a datasheet's is not that datasheet. The importer accepts
   * containment because a line somebody typed into a list is known to name a unit in that list;
   * a box read against any snapshot at all has no such backing, and "Captain" took the Warden
   * Captain and put models on a datasheet nobody had bought.
   */
  it("refuses a datasheet that merely contains the name", () => {
    const read = resolveBox(box([{ name: "Captain", models: 1 }, { name: "Warden", models: 5 }]), snapshot);
    expect(read.lines.map((l) => l.ds)).toEqual([undefined, undefined]);
    expect(read.unknown).toEqual(["Captain", "Warden"]);
  });

  /**
   * The whole point of reporting rather than dropping: a player told "added 3 units" when the box
   * holds four has no way to know their data is behind, and their shelf is quietly wrong.
   */
  it("reports a line this snapshot has no datasheet for instead of dropping it", () => {
    const read = resolveBox(box([{ name: "Warden Squad", models: 5 }, { name: "Void Hammer Squad", models: 3 }]), snapshot);
    expect(read.unknown).toEqual(["Void Hammer Squad"]);
    expect(read.lines[1]!.ds).toBeUndefined();
    expect(read.models).toBe(5);
  });

  it("keeps the other datasheets a kit builds, when the snapshot has them", () => {
    const read = resolveBox(box([{ name: "Ashen Crusher", models: 1, or: ["Warden Captain", "Nothing At All"] }]), snapshot);
    expect(read.lines[0]!.alternatives.map((d) => d.name)).toEqual(["Warden Captain"]);
  });
});

/**
 * A sprue of drones builds shield, gun or marker drones in whatever mix somebody glued, and the
 * list of what it could be is open rather than a choice of two. The box supplies the models; the
 * datasheet is a question for whoever owns them.
 */
describe("a line the box leaves to its owner", () => {
  const drones = box([{ name: "Warden Squad", models: 5 }, { name: "Drones", models: 8, ownerNames: true }]);

  it("keeps its models and waits to be told what they are", () => {
    const read = resolveBox(drones, snapshot);
    expect(read.toName.map((l) => [l.line.name, l.models])).toEqual([["Drones", 8]]);
    expect(read.lines[1]!.ds).toBeUndefined();
    expect(read.lines[1]!.needsName).toBe(true);
  });

  it("is a question, not a gap in the data", () => {
    // The distinction the screen depends on: one asks the player something, the other tells them
    // their snapshot is behind. Reporting a drone sprue as missing data would be a lie.
    const read = resolveBox(drones, snapshot);
    expect(read.unknown).toEqual([]);
  });

  it("is never guessed at from the word on the sprue", () => {
    // "Warden" alone would have taken the Warden Squad under the old containment rule.
    const read = resolveBox(box([{ name: "Warden", models: 8, ownerNames: true }]), snapshot);
    expect(read.lines[0]!.ds).toBeUndefined();
  });

  it("stays off the shelf until it is labelled, then counts where it is told", () => {
    const read = resolveBox(drones, snapshot);
    expect(linesForFactions(read, ["faction:ashen-wardens"]).map((l) => l.line.name)).toEqual(["Warden Squad"]);
    const labelled = nameLine(read.toName[0]!, ds("verdant-swarm:thornlings"));
    expect(labelled.needsName).toBe(false);
    expect(labelled.models).toBe(8);
    expect(labelled.ds!.id).toBe("ds:verdant-swarm:thornlings");
  });
});

/**
 * A Rhino is a Rhino. Several armies field one, each off its own sheet, so the shelf counts them
 * apart even though the model is the same plastic.
 */
describe("a unit more than one army fields", () => {
  const shared = (faction: string, name: string) => {
    const copy = structuredClone(snapshot);
    const from = copy.data.datasheets.find((d) => d.name === "Ashen Crusher")!;
    copy.data.datasheets.push({ ...from, id: `${from.id}:${faction}`, factionId: faction, name });
    return copy;
  };

  it("names the other armies that field it, one per army", () => {
    const snap = shared("faction:verdant-swarm", "Ashen Crusher");
    const read = resolveBox(box([{ name: "Warden Squad", models: 5 }, { name: "Ashen Crusher", models: 1 }]), snap);
    const crusher = read.lines[1]!;
    // The box is Ashen Wardens, so the Wardens' sheet is the one it counts against.
    expect(crusher.ds!.factionId).toBe("faction:ashen-wardens");
    expect(crusher.alsoIn.map((d) => d.factionId)).toEqual(["faction:verdant-swarm"]);
  });

  it("says nothing about a unit only one army fields", () => {
    const read = resolveBox(box([{ name: "Warden Squad", models: 5 }]), snapshot);
    expect(read.lines[0]!.alsoIn).toEqual([]);
  });

  it("counts it once against the army whose box it is, not once per army", () => {
    const snap = shared("faction:verdant-swarm", "Ashen Crusher");
    const read = resolveBox(box([{ name: "Warden Squad", models: 5 }, { name: "Ashen Crusher", models: 1 }]), snap);
    expect(read.factionIds).toEqual(["faction:ashen-wardens"]);
    expect(modelsByDatasheet(read.lines).size).toBe(2);
    expect(read.models).toBe(6);
  });
});

/**
 * A unit moved to Legends is the unit that came in an older box, and the live sheet of that name is
 * usually the kit that replaced it. Which of the two somebody is holding depends on when they
 * bought it, so the box's age decides and the other sheet is offered beside it.
 */
describe("a name carried by both a Legends sheet and a live one", () => {
  /** The synthetic snapshot with one name on two sheets, Legends and live. */
  const twinned = () => {
    const copy = structuredClone(snapshot);
    const live = copy.data.datasheets.find((d) => d.name === "Ashen Crusher")!;
    copy.data.datasheets.push({ ...live, id: `${live.id}:legends`, isLegends: true });
    return copy;
  };
  const crusher = (announced?: string): BoxSet => ({
    id: "b", name: "Test box", kind: "battleforce", ...(announced ? { announced } : {}),
    lines: [{ name: "Warden Squad", models: 5 }, { name: "Ashen Crusher", models: 1 }], source: "test",
  });

  it("gives an old box the Legends sheet", () => {
    const read = resolveBox(crusher("2016"), twinned());
    expect(read.lines[1]!.ds!.isLegends).toBe(true);
  });

  it("gives a box of this edition the live sheet", () => {
    const read = resolveBox(crusher("2026-06-01"), twinned());
    expect(read.lines[1]!.ds!.isLegends).toBeFalsy();
  });

  /** A box nobody could date is an old box; the undated ones are the old ones. */
  it("treats a box with no date as old", () => {
    expect(isOlderThanEdition({ ...crusher(), announced: undefined } as BoxSet)).toBe(true);
    expect(resolveBox(crusher(), twinned()).lines[1]!.ds!.isLegends).toBe(true);
  });

  it("offers the sheet it did not take, so the owner can say which they have", () => {
    const read = resolveBox(crusher("2016"), twinned());
    expect(read.lines[1]!.alternatives.map((d) => !!d.isLegends)).toEqual([false]);
    const now = resolveBox(crusher("2026-06-01"), twinned());
    expect(now.lines[1]!.alternatives.map((d) => !!d.isLegends)).toEqual([true]);
  });

  it("says nothing extra when only one sheet carries the name", () => {
    expect(resolveBox(crusher("2016"), snapshot).lines[1]!.alternatives).toEqual([]);
  });

  it("keeps the edition it reckons from in one place", () => {
    expect(LEGENDS_FROM).toMatch(/^\d{4}$/);
  });
});

/**
 * A name the data does not carry at all is the reader's to place. Saying "not in your data" and
 * stopping leaves them holding models with nowhere to count them.
 */
describe("a name under neither a Legends sheet nor a live one", () => {
  const missing = box([{ name: "Warden Squad", models: 5 }, { name: "Marneus Calgar", models: 1 }]);

  it("is handed back to be labelled rather than only reported", () => {
    const read = resolveBox(missing, snapshot);
    expect(read.toName.map((l) => l.line.name)).toEqual(["Marneus Calgar"]);
    expect(read.lines[1]!.unknownName).toBe(true);
    expect(read.lines[1]!.models).toBe(1);
  });

  it("still says the data does not carry it", () => {
    expect(resolveBox(missing, snapshot).unknown).toEqual(["Marneus Calgar"]);
  });

  it("is told apart from a line the box left open on purpose", () => {
    const read = resolveBox(box([{ name: "Drones", models: 8, ownerNames: true }, { name: "Marneus Calgar", models: 1 }]), snapshot);
    expect(read.toName.map((l) => [l.line.name, !!l.unknownName])).toEqual([["Drones", false], ["Marneus Calgar", true]]);
  });

  it("counts where it is told once labelled", () => {
    const read = resolveBox(missing, snapshot);
    const named = nameLine(read.toName[0]!, ds("ashen-wardens:warden-captain"));
    expect(modelsByDatasheet([named]).get("ds:ashen-wardens:warden-captain")!.models).toBe(1);
  });
});

describe("a box holding more than one army", () => {
  const twoArmies = box([
    { name: "Warden Squad", models: 10 },
    { name: "Thornlings", models: 10 },
    { name: "Spine Drake", models: 1 },
  ]);

  it("lists the factions its lines reach, in the order they appear", () => {
    const read = resolveBox(twoArmies, snapshot);
    expect(read.factionIds).toEqual(["faction:ashen-wardens", "faction:verdant-swarm"]);
    expect(read.models).toBe(21);
  });

  it("gives only the ticked army's lines, so half a split box stays off the shelf", () => {
    const read = resolveBox(twoArmies, snapshot);
    const mine = linesForFactions(read, ["faction:ashen-wardens"]);
    expect(mine.map((l) => l.ds!.name)).toEqual(["Warden Squad"]);
    expect(mine.reduce((s, l) => s + l.models, 0)).toBe(10);
  });

  it("gives nothing when no army is ticked", () => {
    expect(linesForFactions(resolveBox(twoArmies, snapshot), [])).toEqual([]);
  });
});

describe("what a box adds to the shelf", () => {
  /**
   * The shelf counts one number per datasheet. Two lines of the same unit handed over separately
   * would each be added to the count read before either of them landed, so the first would be lost.
   */
  it("sums a unit a box names more than once", () => {
    const read = resolveBox(box([{ name: "Warden Squad", models: 10 }, { name: "Warden Squad", models: 5 }]), snapshot);
    expect(read.lines).toHaveLength(2);
    const totals = modelsByDatasheet(read.lines);
    expect(totals.size).toBe(1);
    expect(totals.get("ds:ashen-wardens:warden-squad")!.models).toBe(15);
  });

  it("leaves out what it could not place and what is not labelled yet", () => {
    const read = resolveBox(box([
      { name: "Warden Squad", models: 5 },
      { name: "Void Hammer Squad", models: 3 },
      { name: "Drones", models: 8, ownerNames: true },
    ]), snapshot);
    expect([...modelsByDatasheet(read.lines).values()].map((v) => [v.ds.name, v.models])).toEqual([["Warden Squad", 5]]);
  });

  it("counts a labelled line once it has been named", () => {
    const read = resolveBox(box([{ name: "Drones", models: 8, ownerNames: true }]), snapshot);
    const named = nameLine(read.toName[0]!, ds("verdant-swarm:thornlings"));
    expect(modelsByDatasheet([named]).get("ds:verdant-swarm:thornlings")!.models).toBe(8);
  });
});

describe("a line written two ways at once", () => {
  it("counts the models it states rather than working them out from units", () => {
    const read = resolveBox(box([{ name: "Warden Squad", models: 3, units: 2 }]), snapshot);
    expect(read.lines[0]!.models).toBe(3);
  });

  /**
   * There is no datasheet to ask how big a unit is, so a line left to its owner has to give its
   * models outright. The seed list is checked for this; the behaviour is pinned here so the zero is
   * a known answer rather than a surprise.
   */
  it("adds nothing for a line left to its owner that counts units instead of models", () => {
    const read = resolveBox(box([{ name: "Drones", units: 2, ownerNames: true }]), snapshot);
    expect(read.lines[0]!.models).toBe(0);
    expect(modelsByDatasheet(read.lines).size).toBe(0);
  });
});

describe("ordering the boxes", () => {
  const dated = (id: string, name: string, announced: string): BoxSet => ({ id, name, kind: "battleforce", announced, lines: [{ name: "Warden Squad", models: 5 }], source: "test" });

  it("puts the newest first, so the box just bought is at the top", () => {
    const all = [dated("a", "Older", "2023-05-01"), dated("b", "Newest", "2026-02-01"), dated("c", "Middle", "2024-11-16")];
    expect(boxesFor(all, snapshot).map((r) => r.box.name)).toEqual(["Newest", "Middle", "Older"]);
  });

  it("settles two boxes of one day by name, rather than by the order they were typed in", () => {
    const all = [dated("b", "Zeta", "2026-02-01"), dated("a", "Alpha", "2026-02-01")];
    expect(boxesFor(all, snapshot).map((r) => r.box.name)).toEqual(["Alpha", "Zeta"]);
  });

  /**
   * A shop can list an old box's contents without ever saying when it came out. Filing it under a
   * year somebody made up would be worse than saying so, and it still belongs in the list.
   */
  it("puts a box nobody could date after the dated ones, under its own heading", () => {
    const undated: BoxSet = { id: "u", name: "Undated", kind: "battleforce", lines: [{ name: "Warden Squad", models: 5 }], source: "test" };
    const read = boxesFor([undated, dated("a", "Old", "2023-05-01"), dated("b", "New", "2026-02-01")], snapshot);
    expect(read.map((r) => r.box.name)).toEqual(["New", "Old", "Undated"]);
    expect(boxesByYear(read).map((g) => g.year)).toEqual(["2026", "2023", undefined]);
  });

  it("groups them under the year they were announced in, newest year first", () => {
    const all = [dated("a", "Old", "2023-05-01"), dated("b", "New", "2026-02-01"), dated("c", "Also new", "2026-09-01")];
    const years = boxesByYear(boxesFor(all, snapshot));
    expect(years.map((g) => [g.year, g.boxes.length])).toEqual([["2026", 2], ["2023", 1]]);
  });

  /** The case the year exists for: one name, two boxes, different models inside. */
  it("keeps two boxes that share a name, and dates them apart", () => {
    const all = [
      { ...dated("swarm-2024", "Battleforce: Tyranid Swarm", "2024-11-16"), lines: [{ name: "Thornlings", models: 10 }] },
      { ...dated("swarm-2026", "Battleforce: Tyranid Swarm", "2026-06-15"), lines: [{ name: "Thornlings", models: 20 }] },
    ];
    const read = boxesFor(all, snapshot);
    expect(read.map((r) => [r.box.announced, r.models])).toEqual([["2026-06-15", 20], ["2024-11-16", 10]]);
    expect(boxesByYear(read).map((g) => g.year)).toEqual(["2026", "2024"]);
  });
});

describe("the list the app ships", () => {
  /**
   * The boxes are typed in by hand off announcements, so the file is checked rather than trusted.
   * Parsing it above is most of that: an id that is not a slug, a source that is not a URL, a line
   * that counts nothing, or a line left to its owner without a model count all stop the parse and
   * name what they are. What is left here is what one line cannot know about another.
   */
  it("holds boxes", () => {
    expect(BOX_SETS.length).toBeGreaterThan(0);
    expect(BOX_SETS.reduce((n, b) => n + b.lines.length, 0)).toBeGreaterThan(BOX_SETS.length);
  });

  it("uses ids that are its own", () => {
    expect(new Set(BOX_SETS.map((b) => b.id)).size).toBe(BOX_SETS.length);
  });

  /**
   * Names come back. A Battleforce sold one year under a name can be sold again years later with
   * different models in it, and a reader picking "the Tyranid Swarm one" has to be able to see
   * which of them is theirs. Sharing a name is allowed; sharing a name and a date is not, because
   * then nothing on screen tells them apart.
   */
  it("never repeats a name on the same day", () => {
    const seen = new Set<string>();
    for (const b of BOX_SETS) {
      const key = `${b.name.toLowerCase()}\u0000${b.announced ?? ""}`;
      expect(seen.has(key), `${b.name} (${b.announced}) is in the list twice`).toBe(false);
      seen.add(key);
    }
  });

  it("dates a box to something that reads as a date, where it is dated at all", () => {
    for (const b of BOX_SETS) if (b.announced) expect(Number.isNaN(Date.parse(b.announced)), b.name).toBe(false);
  });

  /** Older boxes are remembered by the year, and inventing a day for one would invent a fact. */
  it("takes a year on its own, for a box whose day nobody recorded", () => {
    expect(BoxFileSchema.safeParse({ boxes: [{ ...BOX_SETS[0], announced: "2004" }] }).success).toBe(true);
    expect(BoxFileSchema.safeParse({ boxes: [{ ...BOX_SETS[0], announced: "2004-09" }] }).success).toBe(true);
    expect(BoxFileSchema.safeParse({ boxes: [{ ...BOX_SETS[0], announced: "sometime" }] }).success).toBe(false);
  });

  it("reaches back more than fifteen years", () => {
    const years = BOX_SETS.map((b) => Number(b.announced?.slice(0, 4))).filter((y) => !Number.isNaN(y));
    expect(Math.max(...years) - Math.min(...years)).toBeGreaterThanOrEqual(15);
  });

  /** The synthetic snapshot shares no unit with the real world, so none of these can place. */
  it("offers no box a snapshot cannot place a single line of", () => {
    expect(boxesFor(BOX_SETS, snapshot)).toEqual([]);
  });
});

describe("reading the list at runtime", () => {
  const respond = (body: unknown, ok = true) => () => Promise.resolve({ ok, status: ok ? 200 : 404, json: () => Promise.resolve(body) } as Response);

  beforeEach(() => {
    forgetBoxSets();
    // The two failures below are the point of those tests; their report is not the test's output.
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("reads the file and keeps it, rather than fetching it again for every screen", async () => {
    let reads = 0;
    const fetcher = ((...a: unknown[]) => {
      reads += 1;
      return respond(file)(...(a as []));
    }) as typeof fetch;
    expect((await loadBoxSets(fetcher)).length).toBe(BOX_SETS.length);
    await loadBoxSets(fetcher);
    expect(reads).toBe(1);
  });

  /**
   * The boxes are a convenience on a page that counts models perfectly well without them, so a
   * stray comma in a data file must not cost the reader the page.
   */
  it("gives an empty list when the file will not parse, rather than throwing", async () => {
    expect(await loadBoxSets(respond({ boxes: [{ id: "no", name: "Bad" }] }) as typeof fetch)).toEqual([]);
  });

  it("gives an empty list when the file is not there", async () => {
    expect(await loadBoxSets(respond({}, false) as typeof fetch)).toEqual([]);
  });
});
