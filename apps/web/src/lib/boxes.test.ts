import { describe, expect, it } from "vitest";
import { loadSyntheticSnapshot } from "@grimstat/snapshot";
import type { BoxSet } from "../data/boxes";
import { BOX_SETS } from "../data/boxes";
import { boxesFor, linesForFactions, resolveBox, unitSize } from "./boxes";

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

  it("uses ids that are its own", () => {
    expect(new Set(BOX_SETS.map((b) => b.id)).size).toBe(BOX_SETS.length);
  });

  /** The synthetic snapshot shares no unit with the real world, so none of these can place. */
  it("offers no box a snapshot cannot place a single line of", () => {
    expect(boxesFor(BOX_SETS, snapshot)).toEqual([]);
  });
});
