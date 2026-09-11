import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { importRosterText, parseArticle } from "@grimstat/adapters";
import { loadSyntheticSnapshot } from "@grimstat/snapshot";
import type { PublishedListRecord } from "../db";
import { publishedListId } from "./publishedLists";
import { closest, detachmentField, dispositionField, fieldRows, overlap, peersFor, resolveField, resolvePublished, resolvePublishedCached, sideBySide, tallyOf, type PeerList } from "./meta";

const snapshot = loadSyntheticSnapshot();
const html = readFileSync(join(process.cwd(), "fixtures/synthetic/competitive/write-up.html"), "utf8");

const record = (list: Omit<PublishedListRecord, "id" | "source" | "importedAt">): PublishedListRecord => {
  const stored = { ...list, source: { title: "Club Night" }, importedAt: "2026-09-11T00:00:00.000Z" };
  return { ...stored, id: publishedListId(stored) };
};

/** The two published lists of the fixture, plus a third Ashen Wardens list that leans on the Crusher. */
const corpus = (): PublishedListRecord[] => [
  ...parseArticle(html).lists.map((l) => record(l)),
  record({
    heading: "C. Player - Ashen Wardens (Ember Vanguard) - 3rd Place",
    player: "C. Player",
    faction: "Ashen Wardens",
    detachments: ["Ember Vanguard"],
    placing: 3,
    listText: ["Ashen Wardens - Club Night (1000 points)", "Ashen Wardens", "Ember Vanguard", "Incursion (1000 points)", "", "Warden Captain (95 points)", "• Warlord", "", "Ashen Crusher (150 points)", "• 1x Vortex cannon", "", "Ashen Crusher (150 points)", "• 1x Vortex cannon", ""].join("\n"),
  }),
];

const mine = () =>
  importRosterText(["Ashen Wardens - Mine (1000 points)", "Ashen Wardens", "Ember Vanguard", "Incursion (1000 points)", "", "Warden Captain (95 points)", "", "Warden Squad (180 points)", "• 1x Warden Sergeant", "• 4x Warden", "", "Warden Squad (180 points)", "• 1x Warden Sergeant", "• 4x Warden", ""].join("\n"), snapshot).roster;

describe("resolving the field", () => {
  const resolved = corpus().map((r) => resolvePublished(r, snapshot));
  const peers = resolved.filter((p): p is PeerList => p !== undefined);

  it("reads every published list the snapshot knows into units, and drops the ones it does not", () => {
    // The fixture's second list is for units the synthetic snapshot never heard of.
    expect(resolved.map((p) => p?.roster.factionId)).toEqual(["faction:ashen-wardens", undefined, "faction:ashen-wardens"]);
    expect(peers[0]!.tally.get("ds:ashen-wardens:warden-squad")).toMatchObject({ units: 1, models: 10 });
    expect(peers[0]!.points).toBeGreaterThan(0);
  });

  it("measures a list against its own faction only, as filtered", () => {
    const roster = mine();
    expect(peersFor(peers, roster, { placing: "all", detachment: "any" })).toHaveLength(2);
    expect(peersFor(peers, roster, { placing: "winners", detachment: "any" })).toHaveLength(1);
    expect(peersFor(peers, roster, { placing: "top3", detachment: "same" })).toHaveLength(2);
    expect(peersFor(peers, { ...roster, detachments: [] }, { placing: "all", detachment: "same" })).toHaveLength(0);
  });

  it("gives up on text no snapshot can read, rather than counting an empty list", () => {
    expect(resolvePublished(record({ heading: "x - y - 1st Place", detachments: [], listText: "Just prose (2000 points) and more prose (5 points)" }), snapshot)).toBeUndefined();
  });
});

describe("a list against the field", () => {
  const all = corpus().map((r) => resolvePublished(r, snapshot)).filter((p): p is PeerList => p !== undefined);
  const roster = mine();
  const peers = peersFor(all, roster, { placing: "all", detachment: "any" });
  const { tally, points } = tallyOf(roster, snapshot);

  it("counts what the field takes and notes how this list differs", () => {
    const rows = fieldRows(tally, peers, snapshot);
    const by = new Map(rows.map((r) => [r.datasheetId, r]));
    // Both peers take a captain; so does this list.
    expect(by.get("ds:ashen-wardens:warden-captain")).toMatchObject({ yours: 1, takenBy: 2, share: 1, note: "match" });
    // One peer takes a squad; this list takes two.
    expect(by.get("ds:ashen-wardens:warden-squad")).toMatchObject({ yours: 2, takenBy: 1, share: 0.5, typicalUnits: 1, note: "more" });
    // Half the field takes Crushers, two at a time; this list has none.
    expect(by.get("ds:ashen-wardens:ashen-crusher")).toMatchObject({ yours: 0, takenBy: 1, share: 0.5, typicalUnits: 2, note: "missing" });
    // Sorted by how much of the field takes them.
    expect(rows.map((r) => r.datasheetId)[0]).toBe("ds:ashen-wardens:warden-captain");
  });

  it("drops what nobody much takes and this list lacks", () => {
    expect(fieldRows(tally, peers, snapshot, 0.9).map((r) => r.datasheetId)).not.toContain("ds:ashen-wardens:ashen-crusher");
  });

  it("finds the placing list this one most resembles, by points in common", () => {
    const near = closest(tally, points, peers, 2);
    expect(near[0]!.peer.record.player).toBe("A. Player");
    expect(near[0]!.overlap).toBeGreaterThan(near[1]!.overlap);
    expect(overlap(tally, points, tally, points)).toBeCloseTo(1, 6);
    expect(overlap(new Map(), 0, tally, points)).toBe(0);
  });

  it("lays two lists side by side, shared units first", () => {
    const theirs = peers.find((p) => p.record.player === "C. Player")!;
    const rows = sideBySide(tally, theirs.tally, snapshot);
    expect(rows[0]).toMatchObject({ datasheetId: "ds:ashen-wardens:warden-captain" });
    expect(rows[0]!.yours && rows[0]!.theirs).toBeTruthy();
    expect(rows.find((r) => r.datasheetId === "ds:ashen-wardens:warden-squad")!.theirs).toBeUndefined();
    expect(rows.find((r) => r.datasheetId === "ds:ashen-wardens:ashen-crusher")!.yours).toBeUndefined();
  });

  it("tallies the field's detachments and dispositions", () => {
    expect(detachmentField(peers, snapshot)).toEqual([{ name: "Ember Vanguard", lists: 2, share: 1 }]);
    expect(dispositionField(peers)).toEqual([{ name: "HOLD THE RIDGE", lists: 1, share: 0.5 }]);
  });
});

describe("resolving a corpus in slices", () => {
  it("gives the same peers as resolving one by one, reports progress up to the total, and yields between slices", async () => {
    const records = corpus();
    const seen: number[] = [];
    const peers = await resolveField(records, snapshot, { sliceMs: 0, onProgress: (done) => seen.push(done) });
    expect(peers.map((p) => p.record.id)).toEqual(records.map((r) => resolvePublished(r, snapshot)).filter((p): p is PeerList => p !== undefined).map((p) => p.record.id));
    expect(seen[seen.length - 1]).toBe(records.length);
    expect(seen.length).toBeGreaterThan(1);
  });

  it("remembers what it resolved, so a second pass returns the same objects", async () => {
    const records = corpus();
    const first = await resolveField(records, snapshot, { sliceMs: 0 });
    const second = await resolveField(records, snapshot, { sliceMs: 0 });
    expect(second).toEqual(first);
    expect(resolvePublishedCached(records[0]!, snapshot)).toBe(first[0]);
  });

  it("stops when asked", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(resolveField(corpus(), snapshot, { sliceMs: 0, signal: controller.signal })).rejects.toThrow(/cancelled/);
  });
});
