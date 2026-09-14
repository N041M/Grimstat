import { describe, expect, it } from "vitest";
import { Roster } from "@grimstat/schema";
import { loadSyntheticSnapshot } from "@grimstat/snapshot";
import { scanList, type Answers } from "./fit";
import { fromWords, tokenise } from "./tokens";

const snapshot = loadSyntheticSnapshot();
const scan = (text: string, answers?: Answers) => scanList(snapshot, tokenise(text), answers ? { answers } : {});
/** The units a draft holds, as "N x Name". */
const listOf = (text: string, answers?: Answers) => scan(text, answers).units.map((u) => `${u.models} x ${u.name}`);

describe("scanList", () => {
  it("reads a bulleted list with no points on it at all", () => {
    const draft = scan(["Ember Vanguard - HOLD THE RIDGE", "Characters", "Warden Captain - Relic blade (Ember Blade)", "Squads", "2 x 5 Warden Squad", "Vehicles", "Ashen Crusher"].join("\n"));
    expect(draft.units.map((u) => `${u.models} x ${u.name}`)).toEqual(["1 x Warden Captain", "5 x Warden Squad", "5 x Warden Squad", "1 x Ashen Crusher"]);
    expect(draft.roster.factionId).toBe("faction:ashen-wardens");
    expect(draft.roster.detachments.map((d) => [d.detachmentId, d.forceDisposition])).toEqual([["det:ashen-wardens:ember-vanguard", "HOLD THE RIDGE"]]);
    expect(draft.questions).toEqual([]);
  });

  it("costs a list that printed no costs", () => {
    // 80 for the captain, 15 for the enhancement, 90 each for the two squads, 150 for the crusher.
    const draft = scan(["Warden Captain - Ember Blade", "2 x 5 Warden Squad", "Ashen Crusher"].join("\n"));
    expect(draft.total).toBe(425);
    expect(draft.roster.battleSize).toBe("combat-patrol");
    // The first price band covers copies one and two, so both squads cost 90 rather than 90 and 100.
    expect(draft.units.map((u) => u.computedCost)).toEqual([95, 90, 90, 150]);
  });

  it("keeps the cost the list printed beside the one it works out", () => {
    const draft = scan("Ashen Crusher 150\nWarden Captain 80");
    expect(draft.units.map((u) => [u.printedCost, u.computedCost])).toEqual([[150, 150], [80, 80]]);
  });

  it("marks a unit whose printed cost disagrees with the snapshot", () => {
    // 140 is no cost the Ashen Crusher can come to, so it is not read as one.
    const draft = scan("Ashen Crusher 140");
    expect(draft.units[0]).toMatchObject({ printedCost: undefined, computedCost: 150 });
  });

  it("puts the wargear on the only unit that can carry it, whatever the order", () => {
    const draft = scan("Warden Captain\nAshen Crusher\nFusion beamer\nRelic blade");
    expect(draft.units.map((u) => [u.name, u.wargear.join("+")])).toEqual([["Warden Captain", "Relic blade"], ["Ashen Crusher", "Fusion beamer"]]);
  });

  it("puts the enhancement on the character", () => {
    const draft = scan("2 x 5 Warden Squad\nWarden Captain\nEmber Blade");
    const captain = draft.units.find((u) => u.name === "Warden Captain");
    expect(captain?.enhancementId).toBe("enh:ashen-wardens:ember-blade");
    expect(draft.units.filter((u) => u.name === "Warden Squad").every((u) => !u.enhancementId)).toBe(true);
  });

  /*
   * The claim the design rests on, end to end. Recognising a two-column overlay across its full
   * width delivers the columns interleaved, and that has to produce the same army.
   */
  it("reads the same army out of a stream whose columns were interleaved", () => {
    const written = ["Warden Captain 80", "Relic blade", "Ashen Crusher 150", "Fusion beamer", "10 x Warden Squad 180", "Flux carbine"].join("\n");
    const read = ["Ashen Crusher 150", "Warden Captain 80", "Fusion beamer", "Relic blade", "10 x Warden Squad 180", "Flux carbine"].join("\n");
    const a = scan(written);
    const b = scan(read);
    expect(b.total).toBe(a.total);
    expect(b.units.map((u) => `${u.models} x ${u.name} ${u.wargear.join("+")}`).sort()).toEqual(a.units.map((u) => `${u.models} x ${u.name} ${u.wargear.join("+")}`).sort());
  });

  it("ignores the byline and the result line", () => {
    const draft = scan(["by Travis Knights, 3-0 at OP RTT #2 11th Ed", "Ashen Crusher", "Knocked out by Orks War Horde 85-75"].join("\n"));
    expect(listOf2(draft)).toEqual(["1 x Ashen Crusher"]);
  });

  const listOf2 = (d: ReturnType<typeof scan>) => d.units.map((u) => `${u.models} x ${u.name}`);
});

describe("readings the data settles", () => {
  it("reads two units of five rather than one of two", () => {
    expect(listOf("2 x 5 Warden Squad")).toEqual(["5 x Warden Squad", "5 x Warden Squad"]);
  });

  it("reads ten models rather than ten units", () => {
    expect(listOf("10x Warden Squad")).toEqual(["10 x Warden Squad"]);
  });

  it("reads two units of a one-model datasheet", () => {
    expect(listOf("2 x Ashen Crusher")).toEqual(["1 x Ashen Crusher", "1 x Ashen Crusher"]);
  });

  it("uses the printed cost to choose between two legal readings", () => {
    // Thornlings field at 10 to 20, so "2 x 10 Thornlings" is two units of ten or one of two.
    // Only the first is a size the unit has, and 60 is what one unit of ten costs.
    expect(listOf("2 x 10 Thornlings 60")).toEqual(["10 x Thornlings", "10 x Thornlings"]);
  });
});

/*
 * Matching tolerates misspelling so that a photograph can be read, and the same tolerance finds
 * units in things that are not lists. What tells the two apart is what sits around the match.
 */
describe("text that is not a list", () => {
  it("finds no army in a menu whose dishes read like units", () => {
    const menu = ["The Gilded Ladle", "Garden squash soup 6.50", "Spiced drake pie 14.00", "Ashen crust flatbread 11.50"].join("\n");
    expect(scan(menu).units).toEqual([]);
  });

  it("finds no army in names that are all near misses", () => {
    expect(scan("Warder Chaplain - relic hammer\n2 x 8 Warding Squadron").units).toEqual([]);
  });

  it("takes the same weak names once the picture also names a detachment", () => {
    // The menu's words again, under a detachment. One piece of firm evidence is enough.
    const list = ["Ember Vanguard", "Garden squash soup 6.50", "Ashen crust flatbread"].join("\n");
    expect(scan(list).units.length).toBeGreaterThan(0);
  });

  it("takes weak names when one unit in the list is unmistakable", () => {
    expect(scan("Warden Captain\nAshen crust flatbread").units.map((u) => u.name)).toEqual(["Warden Captain", "Ashen Crusher"]);
  });

  it("hands back an empty draft rather than refusing", () => {
    const draft = scan("qkkz vmrh wq ptlxn ddgb");
    expect(draft.units).toEqual([]);
    expect(draft.roster.units).toEqual([]);
    expect(draft.total).toBe(0);
  });
});

describe("questions", () => {
  it("asks which army when the units do not agree", () => {
    const draft = scan("Warden Squad\nThornlings");
    const question = draft.questions.find((q) => q.kind === "faction");
    expect(question?.options.map((o) => o.id).sort()).toEqual(["faction:ashen-wardens", "faction:verdant-swarm"]);
    expect(draft.army.factionId).toBeUndefined();
  });

  it("settles the army once the reader answers, and drops the question", () => {
    const answered = scan("Warden Squad\nThornlings", { faction: "faction:verdant-swarm" });
    expect(answered.army.factionId).toBe("faction:verdant-swarm");
    expect(answered.roster.factionId).toBe("faction:verdant-swarm");
    expect(answered.questions.some((q) => q.kind === "faction")).toBe(false);
  });

  it("asks which detachment when nothing named one", () => {
    const draft = scan("Warden Squad\nWarden Captain\nAshen Crusher");
    const question = draft.questions.find((q) => q.kind === "detachment");
    expect(question?.options.map((o) => o.label)).toEqual(["Ember Vanguard"]);
  });

  it("asks which unit a name was when the match was poor", () => {
    const draft = scan("Wardn Squod\nWarden Captain\nAshen Crusher");
    const question = draft.questions.find((q) => q.kind === "unit");
    expect(question?.asked).toBe("Wardn Squod");
    expect(question?.options.some((o) => o.id === "ds:ashen-wardens:warden-squad")).toBe(true);
  });

  it("takes the reader's word for which unit it was", () => {
    const draft = scan("Wardn Squod\nWarden Captain\nAshen Crusher", { "unit:0": "ds:ashen-wardens:warden-captain" });
    expect(draft.units.map((u) => u.name)).toEqual(["Warden Captain", "Warden Captain", "Ashen Crusher"]);
    expect(draft.questions.some((q) => q.kind === "unit")).toBe(false);
  });

  /*
   * Which of two identical squads carries a weapon barely changes the army, and the roster editor is
   * where a reader would move it. Asking is how an import ends up putting ten questions in front of
   * somebody before they have seen the list.
   */
  it("does not ask which of two copies of one datasheet carries a weapon", () => {
    const draft = scan("Warden Squad\nWarden Squad\nFlux carbine");
    expect(draft.questions.some((q) => q.kind === "owner")).toBe(false);
    // It is still placed, on the nearer of the two.
    expect(draft.units.filter((u) => u.wargear.includes("Flux carbine"))).toHaveLength(1);
  });

  it("asks nothing at all about a list that reads cleanly", () => {
    expect(scan(["Ember Vanguard", "Warden Captain - Relic blade", "10 x Warden Squad", "Ashen Crusher"].join("\n")).questions).toEqual([]);
  });

  it("hands back a saveable draft even with a question outstanding", () => {
    const draft = scan("Warden Squad\nThornlings");
    expect(draft.questions.length).toBeGreaterThan(0);
    expect(draft.roster.units).toHaveLength(2);
    expect(draft.roster.factionId).toBeTruthy();
  });
});

describe("the draft as the app will save it", () => {
  it("passes the schema the import dialog validates against", () => {
    const draft = scan(["Ember Vanguard - HOLD THE RIDGE", "Warden Captain - Relic blade (Ember Blade)", "2 x 5 Warden Squad", "Ashen Crusher"].join("\n"));
    const saved = Roster.parse({ ...draft.roster, id: "r1", snapshotId: snapshot.id, gameSystemId: snapshot.gameSystemId });
    expect(saved.units).toHaveLength(4);
    expect(saved.units.every((u) => u.models.every((m) => m.count > 0))).toBe(true);
  });

  it("gives the army a name from what it found", () => {
    expect(scan("Ember Vanguard\nWarden Captain").roster.name).toBe("Ashen Wardens - Ember Vanguard");
    expect(scanList(snapshot, tokenise("Warden Captain"), { name: "Brian's list" }).roster.name).toBe("Brian's list");
  });
});

describe("a list that came from a picture", () => {
  const word = (text: string, x: number, y: number) => ({ text, confidence: 0.85, box: { x, y, w: text.length * 9, h: 16 } });

  /* Two columns of cards, recognised across the full width so the right column comes first. */
  it("reads two columns of cards", () => {
    const tokens = fromWords([
      // Left column.
      word("Warden", 40, 200),
      word("Captain", 100, 200),
      word("80", 300, 200),
      word("Relic", 40, 230),
      word("blade", 80, 230),
      // Right column, started higher up the picture.
      word("Ashen", 500, 150),
      word("Crusher", 560, 150),
      word("150", 760, 150),
      word("Fusion", 500, 180),
      word("beamer", 560, 180),
    ]);
    const draft = scanList(snapshot, tokens);
    expect(draft.units.map((u) => [u.name, u.printedCost, u.wargear.join("+")])).toEqual([
      ["Ashen Crusher", 150, "Fusion beamer"],
      ["Warden Captain", 80, "Relic blade"],
    ]);
    // The Fusion beamer costs the Ashen Crusher 10 on top of its 150.
    expect(draft.total).toBe(240);
  });
});
