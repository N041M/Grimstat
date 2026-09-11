import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SYNTHETIC_DIR } from "../test-utils";
import type { FetchLike } from "../sources";
import { addToCorpus, crawlMinihq, emptyCorpusIndex, joinTournament, minihqUrls, parseArmyLists, parseCorpusIndex, parseIndexTotal, parsePlatformDate, parseResults, parseTournamentIndex, scrubNames, stringifyCorpusIndex, type CorpusSource } from "./index";

const read = (rel: string) => readFileSync(join(SYNTHETIC_DIR, "minihq", rel), "utf8");
const index = read("index.html");
const results = read("results.html");
const lists = read("army-lists.html");

describe("the platform's dates", () => {
  it("reads the abbreviated and full month forms, and passes ISO through", () => {
    expect(parsePlatformDate("Sept. 5, 2026")).toBe("2026-09-05");
    expect(parsePlatformDate("March 14, 2026")).toBe("2026-03-14");
    expect(parsePlatformDate("Nov. 22, 2025")).toBe("2025-11-22");
    expect(parsePlatformDate("2026-01-02")).toBe("2026-01-02");
    expect(parsePlatformDate("Smarch 1, 2026")).toBeUndefined();
    expect(parsePlatformDate(undefined)).toBeUndefined();
  });
});

describe("the tournament index", () => {
  it("reads every card with its slug, name, date, game and registrations, whether the link is absolute or not", () => {
    const got = parseTournamentIndex(index);
    expect(got.map((t) => t.slug)).toEqual(["club-night-invitational-2026-09-05", "harbour-open-2026-08-29", "spring-melee-2026-03-14"]);
    expect(got[0]).toEqual({ slug: "club-night-invitational-2026-09-05", name: "Club Night Invitational", date: "2026-09-05", game: "Warhammer 40000", registrations: 24 });
    expect(got[2]).toMatchObject({ name: "Spring Mélée", date: "2026-03-14", game: "Age of Sigmar" });
  });

  it("reads the total the page announces", () => {
    expect(parseIndexTotal(index)).toBe(5);
    expect(parseIndexTotal("<p>nothing</p>")).toBeUndefined();
  });
});

describe("a results page", () => {
  it("gives each player their placing and faction, the faction being the last segment", () => {
    expect(parseResults(results)).toEqual([
      { placing: 1, player: "Warden_One", faction: "Ashen Wardens" },
      { placing: 2, player: "Broodmother's Kid", faction: "Verdant Swarm" },
      { placing: 3, player: "Latecomer", faction: "Ashen Wardens" },
    ]);
  });
});

describe("an army-lists page", () => {
  it("gives each list its player, faction and text, with an empty text for a picture", () => {
    const got = parseArmyLists(lists);
    expect(got.map((l) => [l.player, l.faction])).toEqual([
      ["Warden_One", "Ashen Wardens"],
      ["Broodmother's Kid", "Verdant Swarm"],
      ["Pictured", "Ashen Wardens"],
    ]);
    expect(got[0]?.text).toContain("Warden Captain (95 points)");
    expect(got[0]?.text).toContain("+ PLAYER: Warden One");
    expect(got[2]?.text).toBe("");
  });
});

describe("scrubbing names", () => {
  it("removes the organiser's player and team lines in either language, and nothing else", () => {
    expect(scrubNames("+ PLAYER: A\n+ ARMY: B\n+ TEAM: C\n+ Joueur : D\nPseudo: E\nWarden Captain (95 points)")).toBe("+ ARMY: B\nWarden Captain (95 points)");
  });
});

describe("joining lists to placings", () => {
  const tournament = parseTournamentIndex(index)[0]!;
  const joined = joinTournament(tournament, parseArmyLists(lists), parseResults(results), { importedAt: "2026-09-11T00:00:00.000Z" });

  it("keeps the readable lists, counts the picture, and attaches placings by nickname", () => {
    expect(joined.lists).toHaveLength(2);
    expect(joined.skipped).toBe(1);
    expect(joined.unplaced).toBe(0);
    expect(joined.lists.map((l) => l.placing)).toEqual([1, 2]);
  });

  it("drops names by default: no player, no organiser name line, no sign-off, and a heading without a person", () => {
    const first = joined.lists[0]!;
    expect(first.player).toBeUndefined();
    expect(first.listText).not.toMatch(/PLAYER|Warden One|Exported with/);
    expect(first.listText.split("\n")[0]).toBe("Warden Captain (95 points)");
    expect(first.heading).toBe("Ashen Wardens (Ember Vanguard) - 1st Place");
  });

  it("reads the detachment from the organiser's header when the app's own header is absent, and from the app's when present", () => {
    expect(joined.lists[0]?.detachments).toEqual(["Ember Vanguard"]);
    expect(joined.lists[1]?.detachments).toEqual(["Thorn Tide"]);
    expect(joined.lists[1]?.listName).toBe("Verdant Swarm - Club Night");
  });

  it("records where the list was published, and when", () => {
    expect(joined.lists[0]?.source).toEqual({ title: "Club Night Invitational", url: minihqUrls.lists(tournament.slug), publication: "miniheadquarters.com", published: "2026-09-05" });
    expect(joined.lists[0]?.importedAt).toBe("2026-09-11T00:00:00.000Z");
  });

  it("keeps names only when asked", () => {
    const named = joinTournament(tournament, parseArmyLists(lists), parseResults(results), { keepNames: true });
    expect(named.lists[0]?.player).toBe("Warden_One");
    expect(named.lists[0]?.heading).toBe("Warden_One - Ashen Wardens (Ember Vanguard) - 1st Place");
    // The organiser's header is not the list, so it falls away either way.
    expect(named.lists[0]?.listText.split("\n")[0]).toBe("Warden Captain (95 points)");
  });

  it("counts a list whose player is not in the results as unplaced, and still keeps it", () => {
    const partial = joinTournament(tournament, parseArmyLists(lists), parseResults(results).slice(1));
    expect(partial.unplaced).toBe(1);
    expect(partial.lists[0]?.placing).toBeUndefined();
  });
});

describe("crawling", () => {
  const served = new Map<string, string>([
    [minihqUrls.index(1), index],
    [minihqUrls.lists("club-night-invitational-2026-09-05"), lists],
    [minihqUrls.results("club-night-invitational-2026-09-05"), results],
    [minihqUrls.lists("harbour-open-2026-08-29"), lists],
  ]);
  const requested: string[] = [];
  const fetchImpl: FetchLike = async (url) => {
    requested.push(url);
    const body = served.get(url);
    return { ok: body !== undefined, status: body !== undefined ? 200 : 404, text: async () => body ?? "" };
  };

  it("fetches the lists and results of each ended 40k tournament since the date, newest first, and stops at older pages", async () => {
    requested.length = 0;
    const crawl = await crawlMinihq({ since: "2026-08-01", delayMs: 0 }, fetchImpl);
    expect(crawl.tournaments.map((t) => t.tournament.slug)).toEqual(["club-night-invitational-2026-09-05", "harbour-open-2026-08-29"]);
    expect(crawl.tournaments[0]?.lists).toHaveLength(2);
    // The March tournament is older than the date and not fetched; the index has one page.
    expect(requested).not.toContain(minihqUrls.lists("spring-melee-2026-03-14"));
    expect(requested.filter((u) => u.includes("page=")).length).toBe(1);
    expect(crawl.requests).toBe(5);
    // Harbour Open has no results page served: a warning, and its lists carry no placing.
    expect(crawl.warnings).toEqual([`GET ${minihqUrls.results("harbour-open-2026-08-29")} -> HTTP 404`]);
    expect(crawl.tournaments[1]?.unplaced).toBe(2);
  });

  it("skips tournaments fetched before, and stops at the limit", async () => {
    const skipped = await crawlMinihq({ since: "2026-08-01", delayMs: 0, skip: new Set(["club-night-invitational-2026-09-05"]) }, fetchImpl);
    expect(skipped.tournaments.map((t) => t.tournament.slug)).toEqual(["harbour-open-2026-08-29"]);
    const limited = await crawlMinihq({ since: "2026-08-01", delayMs: 0, limit: 1 }, fetchImpl);
    expect(limited.tournaments).toHaveLength(1);
  });

  it("fails loudly when the index itself cannot be read", async () => {
    await expect(crawlMinihq({ since: "2026-08-01", delayMs: 0 }, async () => ({ ok: false, status: 500, text: async () => "" }))).rejects.toThrow(/index could not be read/);
  });
});

describe("the corpus index", () => {
  const source: CorpusSource = { id: "minihq", name: "MiniHeadQuarters", url: "https://miniheadquarters.com", publication: "miniheadquarters.com", attribution: "Lists published on MiniHeadQuarters" };
  const tournament = parseTournamentIndex(index)[0]!;
  const batch = [joinTournament(tournament, parseArmyLists(lists), parseResults(results), { importedAt: "2026-09-11T00:00:00.000Z" })];

  it("folds a crawl into a monthly file and the index, and a second fold of the same crawl changes nothing", () => {
    const first = addToCorpus(emptyCorpusIndex(source, "2026-09-11T01:00:00.000Z"), new Map(), batch, "2026-09-11T01:00:00.000Z");
    expect(first.touched).toEqual(["lists-2026-09.json"]);
    expect(first.files.get("lists-2026-09.json")).toHaveLength(2);
    expect(first.index.files).toEqual([{ name: "lists-2026-09.json", month: "2026-09", lists: 2, tournaments: 1 }]);
    expect(first.index.tournaments[0]).toMatchObject({ slug: tournament.slug, name: "Club Night Invitational", date: "2026-09-05", lists: 2, file: "lists-2026-09.json" });
    const again = addToCorpus(first.index, first.files, batch, "2026-09-12T01:00:00.000Z");
    expect(again.files.get("lists-2026-09.json")).toHaveLength(2);
    expect(again.index.tournaments).toHaveLength(1);
    expect(again.index.generatedAt).toBe("2026-09-12T01:00:00.000Z");
  });

  it("round-trips through JSON and rejects what is not an index", () => {
    const { index: built } = addToCorpus(emptyCorpusIndex(source), new Map(), batch);
    expect(parseCorpusIndex(stringifyCorpusIndex(built))).toEqual(built);
    expect(() => parseCorpusIndex("{}")).toThrow(/Not a corpus index/);
    expect(() => parseCorpusIndex("nonsense")).toThrow(/Not JSON/);
  });
});
