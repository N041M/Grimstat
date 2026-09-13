import { describe, expect, it } from "vitest";
import { loadSyntheticSnapshot } from "@grimstat/snapshot";
import type { BoxSet } from "../data/boxes";
import { BOX_SETS } from "../data/boxes";
import { boxesFor, linesForFactions, nameLine, resolveBox, unitSize } from "./boxes";

const snapshot = loadSyntheticSnapshot();
const ds = (id: string) => snapshot.data.datasheets.find((d) => d.id === `ds:${id}`)!;

/** Boxes in the synthetic vocabulary, so nothing here asserts a real product's contents. */
const box = (lines: BoxSet["lines"]): BoxSet => ({ id: "b", name: "Test box", kind: "battleforce", lines, source: "test" });

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

describe("the shipped seed list", () => {
  it("has an id, a name, a source and at least one line for every box", () => {
    expect(BOX_SETS.length).toBeGreaterThan(0);
    for (const b of BOX_SETS) {
      expect(b.id, b.name).toMatch(/^[a-z0-9-]+$/);
      expect(b.name.length, b.id).toBeGreaterThan(0);
      expect(b.source, b.name).toMatch(/^https:\/\//);
      expect(b.lines.length, b.name).toBeGreaterThan(0);
    }
  });

  it("gives every line a count, one way or the other", () => {
    for (const b of BOX_SETS) {
      for (const l of b.lines) {
        expect(l.models ?? l.units, `${b.name}: ${l.name}`).toBeGreaterThan(0);
        expect(l.name.trim(), b.name).not.toBe("");
      }
    }
  });

  /** A line whose datasheet is its owner's to pick still has to say how many models that is. */
  it("counts the models of a line it leaves to its owner", () => {
    for (const b of BOX_SETS) {
      for (const l of b.lines.filter((x) => x.ownerNames)) {
        expect(l.models, `${b.name}: ${l.name}`).toBeGreaterThan(0);
        expect(l.units, `${b.name}: ${l.name}`).toBeUndefined();
      }
    }
  });

  it("uses ids that are its own", () => {
    expect(new Set(BOX_SETS.map((b) => b.id)).size).toBe(BOX_SETS.length);
  });

  /** The synthetic snapshot shares no unit with the real world, so none of these can place. */
  it("offers no box a snapshot cannot place a single line of", () => {
    expect(boxesFor(BOX_SETS, snapshot)).toEqual([]);
  });
});
