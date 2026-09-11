import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadSyntheticSnapshot } from "@grimstat/snapshot";
import { SYNTHETIC_DIR } from "../test-utils";
import { importRosterText } from "../roster/index";
import { dedupePublishedLists, extractList, feedSource, guessListHeader, parseArticle, parseFeed, parseHeading, parsePublishedListsFile, pastedList, publishedListKey, sourceOf, stringifyPublishedListsFile, type StoredPublishedList } from "./index";

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

describe("the corpus file", () => {
  const stored = (): StoredPublishedList[] => parseArticle(html, { title: "Club Night", url: "https://example.invalid/club-night/" }).lists.map((l) => ({ ...l, source: { title: "Club Night", url: "https://example.invalid/club-night/" }, importedAt: "2026-09-11T00:00:00.000Z" }));

  it("round-trips every list, with its provenance", () => {
    const lists = stored();
    const back = parsePublishedListsFile(stringifyPublishedListsFile(lists, "2026-09-11T00:00:00.000Z"));
    expect(back).toEqual(lists);
  });

  it("refuses what is not a corpus file, and says why", () => {
    expect(() => parsePublishedListsFile("not json")).toThrow(/Not JSON/);
    expect(() => parsePublishedListsFile({ format: "something-else", version: 1, lists: [] })).toThrow(/Not a published-lists file/);
    expect(() => parsePublishedListsFile({ format: "grimstat-published-lists", version: 1, lists: [{ heading: "x" }] })).toThrow(/Not a published-lists file/);
  });

  it("keeps one copy of a list published twice, the later one", () => {
    const [a, b] = stored();
    const reprint = { ...a!, source: { title: "Club Night pt.2" }, listText: `${a!.listText}   ` };
    const kept = dedupePublishedLists([a!, b!, reprint]);
    expect(kept).toHaveLength(2);
    expect(kept.find((l) => l.player === a!.player)?.source.title).toBe("Club Night pt.2");
    expect(publishedListKey(a!)).toBe(publishedListKey(reprint));
  });
});

describe("where a saved page says it came from", () => {
  it("prefers the canonical link and Open Graph, then the browser title's tail", () => {
    const page = `<html><head><title>Club Night pt.1 - Invented Wargaming</title><link rel="canonical" href="https://example.invalid/club-night/"><meta property="og:title" content="Club Night Invitational"></head><body></body></html>`;
    expect(sourceOf(page)).toEqual({ title: "Club Night Invitational", url: "https://example.invalid/club-night/", publication: "Invented Wargaming" });
  });

  it("falls back to the name it was given when the page says nothing", () => {
    expect(sourceOf("<html><body><p>hi</p></body></html>", "write-up")).toEqual({ title: "write-up" });
  });
});

describe("the feed's own provenance", () => {
  it("names the publication and links to the page its write-ups are listed on", () => {
    expect(feedSource(read("competitive/feed.xml"))).toEqual({ title: "Invented Wargaming Publication", url: "https://example.invalid/tag/competitive-innovations/" });
  });

  it("gives nothing for text that is not a feed", () => {
    expect(feedSource("<html>not a feed</html>")).toEqual({});
    expect(feedSource("")).toEqual({});
  });
});

describe("a pasted list", () => {
  const text = ["Ashen Wardens - Club Night (975 points)", "Ashen Wardens", "Ember Vanguard (3 Detachment Points)", "HOLD THE RIDGE", "Incursion (1,000 points)", "", "Warden Captain (95 points)", "• Warlord", "", "Warden Squad (180 points)", "• 1x Warden Sergeant", "• 9x Warden"].join("\n");

  it("builds the record a write-up would have given, from what the user typed", () => {
    const got = pastedList({ listText: text, player: "A. Player", faction: "Ashen Wardens", detachments: "Ember Vanguard", forceDisposition: "HOLD THE RIDGE", placing: 1, sourceTitle: "Club Night Invitational", sourceUrl: "https://tournaments.example.invalid/event/abc" });
    expect(got).toMatchObject({
      heading: "A. Player - Ashen Wardens (Ember Vanguard) - HOLD THE RIDGE - 1st Place",
      player: "A. Player",
      faction: "Ashen Wardens",
      detachments: ["Ember Vanguard"],
      forceDisposition: "HOLD THE RIDGE",
      placing: 1,
      listName: "Ashen Wardens - Club Night",
      source: { title: "Club Night Invitational", url: "https://tournaments.example.invalid/event/abc", publication: "tournaments.example.invalid" },
    });
    expect(got?.listText).toBe(text);
    // The heading reads back through the write-up parser, so a corpus re-read stays whole.
    expect(parseHeading(got!.heading)).toMatchObject({ player: "A. Player", faction: "Ashen Wardens", detachments: ["Ember Vanguard"], forceDisposition: "HOLD THE RIDGE", placing: 1 });
  });

  it("keeps only the list when the paste brought a page's chrome, or the app's sign-off, with it", () => {
    const pasted = ["Event  Overview  Roster  Pairings", "Round 5 · Table 3", "", text, "", "Exported with App Version: v1.2.3", "Copyright someone", "Privacy Policy"].join("\n");
    expect(pastedList({ listText: pasted })?.listText).toBe(text);
  });

  it("needs two costed lines, or it is not a list", () => {
    expect(pastedList({ listText: "Just a sentence about 2000 points." })).toBeUndefined();
    expect(pastedList({ listText: "" })).toBeUndefined();
  });

  it("falls back to the list's own first line as the heading when nothing else was said", () => {
    const got = pastedList({ listText: text });
    expect(got?.heading).toBe("Ashen Wardens - Club Night (975 points)");
    expect(got?.detachments).toEqual([]);
    expect(got?.placing).toBeUndefined();
    expect(got?.source).toEqual({});
  });

  it("makes a link out of a bare host, names the publication after it, and ignores a non-link", () => {
    expect(pastedList({ listText: text, sourceUrl: " tournaments.example.invalid/event/abc " })?.source).toEqual({ url: "https://tournaments.example.invalid/event/abc", publication: "tournaments.example.invalid" });
    expect(pastedList({ listText: text, sourceUrl: "https://www.example.invalid/x" })?.source.publication).toBe("example.invalid");
    expect(pastedList({ listText: text, sourceUrl: "somewhere" })?.source).toEqual({});
  });

  it("splits detachments on the slash a heading uses, and drops a placing that is not one", () => {
    const got = pastedList({ listText: text, detachments: "Ember Vanguard / Thorn Tide", placing: 0 });
    expect(got?.detachments).toEqual(["Ember Vanguard", "Thorn Tide"]);
    expect(got?.heading).toBe("(Ember Vanguard/Thorn Tide)");
    expect(got?.placing).toBeUndefined();
    expect(pastedList({ listText: text, player: "B", placing: 22 })?.heading).toBe("B - 22nd Place");
  });
});

describe("guessing a list's header for prefilling", () => {
  it("reads the app's header: faction, detachment in Detachment Points, disposition in capitals", () => {
    const text = ["Ashen Wardens - Club Night (975 points)", "Ashen Wardens", "Ember Vanguard (3 Detachment Points)", "HOLD THE RIDGE", "Incursion (1,000 points)", "", "Warden Captain (95 points)", "• Warlord"].join("\n");
    expect(guessListHeader(text)).toEqual({ faction: "Ashen Wardens", detachment: "Ember Vanguard", forceDisposition: "HOLD THE RIDGE" });
  });

  it("reads the older header, where the detachment follows the size line and sections are in capitals", () => {
    const old = ["My Army (2000 points)", "", "Verdant Swarm", "Strike Force (2000 points)", "Thorn Tide", "", "CHARACTERS", "", "Thorn Broodmother (110 points)"].join("\n");
    expect(guessListHeader(old)).toEqual({ faction: "Verdant Swarm", detachment: "Thorn Tide" });
  });

  it("guesses nothing from a list with no header", () => {
    expect(guessListHeader("Warden Captain (95 points)\n• Warlord")).toEqual({});
    expect(guessListHeader("")).toEqual({});
  });
});
