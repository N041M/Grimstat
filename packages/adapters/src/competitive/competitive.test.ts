import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadSyntheticSnapshot } from "@grimstat/snapshot";
import { SYNTHETIC_DIR } from "../test-utils";
import { importRosterText } from "../roster/index";
import { extractList, parseArticle, parseFeed, parseHeading } from "./index";

const read = (rel: string) => readFileSync(join(SYNTHETIC_DIR, rel), "utf8");
const html = read("competitive/write-up.html");

describe("the write-up feed", () => {
  const entries = parseFeed(read("competitive/feed.xml"));

  it("reads every entry, newest first", () => {
    expect(entries).toHaveLength(3);
    expect(entries[0]?.title).toContain("Club Night Invitational");
    expect(entries[0]?.url).toBe("https://example.invalid/competitive-innovations-club-night-pt-1/");
    expect(entries[0]?.published).toContain("10 Sep 2026");
  });

  it("marks which entries are 40k, because the feed carries every game the publication covers", () => {
    expect(entries.map((e) => e.isWarhammer40k)).toEqual([true, false, false]);
  });

  it("survives a feed with one item, or none, or nonsense", () => {
    const one = parseFeed('<rss><channel><item><title>[40k] In 11th: A</title><link>https://example.invalid/a/</link></item></channel></rss>');
    expect(one).toHaveLength(1);
    expect(parseFeed("<rss><channel></channel></rss>")).toEqual([]);
    expect(parseFeed("<html>not a feed</html>")).toEqual([]);
  });

  it("skips an entry with no link rather than inventing one", () => {
    expect(parseFeed("<rss><channel><item><title>Titled but linkless</title></item></channel></rss>")).toEqual([]);
  });
});

describe("reading a result heading", () => {
  it("takes the player, faction, detachments, disposition and placing", () => {
    const got = parseHeading("A. Player - Ashen Wardens (Ember Vanguard/Thorn Tide) - HOLD THE RIDGE - 1st Place");
    expect(got).toMatchObject({
      player: "A. Player",
      faction: "Ashen Wardens",
      detachments: ["Ember Vanguard", "Thorn Tide"],
      forceDisposition: "HOLD THE RIDGE",
      placing: 1,
    });
  });

  it("copes with a heading that names no disposition", () => {
    const got = parseHeading("B. Player - Verdant Swarm (Thorn Tide) - 2nd Place");
    expect(got?.faction).toBe("Verdant Swarm");
    expect(got?.forceDisposition).toBeUndefined();
    expect(got?.placing).toBe(2);
  });

  it("copes with no detachments in brackets", () => {
    expect(parseHeading("C. Player - Ashen Wardens - 3rd Place")).toMatchObject({ faction: "Ashen Wardens", detachments: [], placing: 3 });
  });

  it("reads every ordinal, and keeps the heading whole so a mis-parse can be checked", () => {
    for (const [text, place] of [["P - F - 1st Place", 1], ["P - F - 2nd Place", 2], ["P - F - 3rd Place", 3], ["P - F - 11th Place", 11]] as const) {
      expect(parseHeading(text)?.placing).toBe(place);
    }
    expect(parseHeading("P - F - 1st Place")?.heading).toBe("P - F - 1st Place");
  });

  it("refuses a heading with no placing, because that is a section title", () => {
    expect(parseHeading("Acknowledgements")).toBeUndefined();
    expect(parseHeading("Closing Thoughts")).toBeUndefined();
    expect(parseHeading("The List")).toBeUndefined();
  });
});

describe("pulling the lists out of a write-up", () => {
  const article = parseArticle(html, { url: "https://example.invalid/a/", title: "Club Night", publication: "Invented Publication" });

  it("finds one list per result, and nothing under the prose", () => {
    expect(article.lists).toHaveLength(2);
    expect(article.lists.map((l) => l.placing)).toEqual([1, 2]);
  });

  it("keeps each list's heading data with its text", () => {
    const first = article.lists[0]!;
    expect(first.player).toBe("A. Player");
    expect(first.faction).toBe("Ashen Wardens");
    expect(first.detachments).toEqual(["Ember Vanguard"]);
    expect(first.forceDisposition).toBe("HOLD THE RIDGE");
    expect(first.listName).toBe("Ashen Wardens - Club Night Invitational");
  });

  it("keeps the list text verbatim, bullets and all", () => {
    const text = article.lists[0]!.listText;
    expect(text).toContain("Warden Captain (95 points)");
    expect(text).toContain("• 9x Warden");
    expect(text).toContain("Ember Vanguard (3 Detachment Points)");
    expect(text).not.toMatch(/<[a-z]/i); // no markup survives
  });

  it("carries its provenance, because an imported list is somebody's work", () => {
    expect(article.source.url).toBe("https://example.invalid/a/");
    expect(article.source.publication).toBe("Invented Publication");
  });

  it("says so when an article has no results in it", () => {
    const none = parseArticle("<article><h2>Just Prose</h2><p>Nothing here.</p></article>");
    expect(none.lists).toEqual([]);
    expect(none.warnings.join(" ")).toMatch(/no list headings/i);
  });

  it("warns when a result heading has no list under it", () => {
    const empty = parseArticle("<h2>A. Player - Ashen Wardens - 1st Place</h2><p>The list was not published.</p>");
    expect(empty.lists).toEqual([]);
    expect(empty.warnings.join(" ")).toMatch(/No list found/);
  });
});

describe("finding the list inside a block", () => {
  it("needs more than one points line, so a heading mentioning points is not a list", () => {
    expect(extractList("<p>He spent 500 points on it (500 points)</p>")).toBeUndefined();
  });

  it("keeps plain lines inside a list — faction, detachment and section names have no points", () => {
    const got = extractList("<p>Warden Captain (95 points)</p><p>Ashen Wardens</p><p>Ember Vanguard</p><p>Warden Squad (180 points)</p>");
    expect(got).toContain("Ashen Wardens");
    expect(got).toContain("Ember Vanguard");
  });

  it("stops at a long stretch of prose", () => {
    const got = extractList("<p>Unit A (10 points)</p><p>Unit B (20 points)</p>" + "<p>prose</p>".repeat(6) + "<p>Not part of it (30 points)</p>");
    expect(got).toContain("Unit A");
    expect(got).not.toContain("Not part of it");
  });

  it("returns nothing for an empty block", () => {
    expect(extractList("")).toBeUndefined();
    expect(extractList("<p></p>")).toBeUndefined();
  });
});

describe("what the lists are for", () => {
  it("hands the importer something it can resolve against a snapshot", () => {
    // The point of keeping the text verbatim: the corpus is portable, and it only becomes units when
    // the user has game data of their own loaded.
    const snapshot = loadSyntheticSnapshot();
    const article = parseArticle(html);
    const { roster, warnings } = importRosterText(article.lists[0]!.listText, snapshot);
    expect(roster.units.map((u) => u.datasheetId)).toEqual(["ds:ashen-wardens:warden-captain", "ds:ashen-wardens:warden-squad"]);
    expect(roster.detachments[0]?.detachmentId).toBe("det:ashen-wardens:ember-vanguard");
    expect(roster.detachments[0]?.forceDisposition).toBe("HOLD THE RIDGE");
    expect(warnings).toEqual([]);
  });
});
