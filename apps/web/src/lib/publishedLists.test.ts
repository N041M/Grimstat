import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { PublishedListRecord } from "../db";
import { classifyPublishedText, feedChecklist, parsePublishedFeed, publishedListId, publishedSources, readPublishedFeed, readPublishedFile, type PublishedFeed } from "./publishedLists";

const fixture = (rel: string) => readFileSync(join(process.cwd(), "fixtures/synthetic/competitive", rel), "utf8");

const record = (source: PublishedListRecord["source"], n = 1): PublishedListRecord => {
  const stored = { heading: `P${n} - Faction - 1st Place`, player: `P${n}`, detachments: [], listText: `Unit (${n * 10} points)\n• 1x thing\nOther (5 points)`, source, importedAt: "2026-09-11T00:00:00.000Z" };
  return { ...stored, id: publishedListId(stored) };
};

describe("the record id", () => {
  const list = (player: string, placing: number) => ({ heading: `${player} - Faction - ${placing}`, player, placing, detachments: [], listText: "Intercessor Squad (80 points) 5x bolt rifle", source: {}, importedAt: "2026-09-11T00:00:00.000Z" });

  it("is the same for the same list and different for a different one", () => {
    expect(publishedListId(list("Ada", 1))).toBe(publishedListId(list("Ada", 1)));
    expect(publishedListId(list("Ada", 1))).not.toBe(publishedListId(list("Ada", 2)));
  });

  it("is 128 bits wide, so the corpus does not outgrow it", () => {
    expect(publishedListId(list("Ada", 1))).toMatch(/^pl-[0-9a-f]{32}$/);
  });

  it("keeps apart two lists the 32-bit hash gave the same id", () => {
    // Both sides of this pair hash to 60b46b73 under FNV-1a — the first collision a run of
    // generated players and placings turned up, at some sixty thousand records.
    expect(publishedListId(list("Player 14301", 30))).not.toBe(publishedListId(list("Player 62254", 47)));
  });

  it("gives a hundred thousand generated lists a hundred thousand ids", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100000; i++) ids.add(publishedListId(list(`Player ${i}`, (i % 64) + 1)));
    expect(ids.size).toBe(100000);
  });
});

describe("the sources table", () => {
  it("gives a write-up with neither a link nor a title a row of its own", () => {
    const rows = publishedSources([record({ title: "Anonymous" }, 1), record({}, 2), record({}, 3)]);
    expect(rows.map((r) => r.lists)).toEqual([1, 1, 1]);
    expect(new Set(rows.map((r) => r.key)).size).toBe(3);
  });

  it("still folds the lists of one write-up into one row", () => {
    const rows = publishedSources([record({ url: "https://example.invalid/a/" }, 1), record({ url: "https://example.invalid/a/" }, 2)]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.lists).toBe(2);
  });
});

describe("telling the files apart", () => {
  it("knows a corpus, a feed and a page by their content, not their names", () => {
    expect(classifyPublishedText('\uFEFF{"format":"grimstat-published-lists"}')).toBe("corpus");
    expect(classifyPublishedText(fixture("feed.xml"))).toBe("feed");
    expect(classifyPublishedText('<feed xmlns="http://www.w3.org/2005/Atom"><entry/></feed>')).toBe("feed");
    expect(classifyPublishedText("<!-- saved --><rss><channel/></rss>")).toBe("feed");
    expect(classifyPublishedText(fixture("write-up.html"))).toBe("page");
    expect(classifyPublishedText("Warden Captain (95 points)\n• Warlord")).toBeUndefined();
  });

  it("refuses to read a feed as a write-up, and says which door it belongs at", () => {
    expect(() => readPublishedFile("feed.xml", fixture("feed.xml"))).toThrow(/a feed, not a write-up/);
  });
});

describe("the feed as a checklist", () => {
  const feed = readPublishedFeed(fixture("feed.xml"), "2026-09-11T10:00:00.000Z");

  it("keeps the feed's title, link and entries, and when it was loaded", () => {
    expect(feed.title).toBe("Invented Wargaming Publication");
    expect(feed.url).toBe("https://example.invalid/tag/competitive-innovations/");
    expect(feed.loadedAt).toBe("2026-09-11T10:00:00.000Z");
    expect(feed.entries).toHaveLength(3);
  });

  it("lists the 40k write-ups only, each with the lists stored from it", () => {
    const rows = feedChecklist(feed, []);
    expect(rows.map((r) => r.entry.title)).toEqual(["[40k] Competitive Innovations in 11th: Club Night Invitational pt.1"]);
    expect(rows[0]?.lists).toBe(0);
  });

  it("matches a write-up by its link's path, so a publication that moved domains still counts", () => {
    const records = [record({ url: "https://moved.example.invalid/competitive-innovations-club-night-pt-1/", title: "Something else" }, 1), record({ url: "https://moved.example.invalid/competitive-innovations-club-night-pt-1" }, 2), record({ url: "https://example.invalid/unrelated/" }, 3)];
    expect(feedChecklist(feed, records)[0]?.lists).toBe(2);
  });

  it("falls back to the title, with the feed's game tag taken off", () => {
    const records = [record({ title: "Competitive Innovations in 11th: Club Night Invitational pt.1" }, 1)];
    expect(feedChecklist(feed, records)[0]?.lists).toBe(1);
  });
});

describe("the stored feed", () => {
  it("comes back as it went in, and null stays null", () => {
    const feed: PublishedFeed = readPublishedFeed(fixture("feed.xml"), "2026-09-11T10:00:00.000Z");
    expect(parsePublishedFeed(JSON.parse(JSON.stringify(feed)))).toEqual(feed);
    expect(parsePublishedFeed(null)).toBeNull();
  });

  it("rejects what is not a feed, and drops entries that are not entries", () => {
    expect(parsePublishedFeed("nonsense")).toBeUndefined();
    expect(parsePublishedFeed({ entries: [] })).toBeUndefined();
    expect(parsePublishedFeed({ loadedAt: "2026-09-11", entries: [{ title: "no link" }, { title: "ok", url: "https://example.invalid/a/" }] })).toEqual({ loadedAt: "2026-09-11", entries: [{ title: "ok", url: "https://example.invalid/a/", isWarhammer40k: false }] });
  });
});
