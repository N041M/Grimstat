import { describe, expect, it } from "vitest";
import { CORPUS_FORMAT, CORPUS_VERSION, stringifyPublishedListsFile } from "@grimstat/adapters";
import { corpusBase, parseCorpusRecord, readCorpus, type FetchText } from "./corpusFetch";

const index = {
  format: CORPUS_FORMAT,
  version: CORPUS_VERSION,
  generatedAt: "2026-09-11T01:00:00.000Z",
  source: { id: "minihq", name: "MiniHeadQuarters", url: "https://miniheadquarters.com", publication: "miniheadquarters.com", attribution: "Lists published on MiniHeadQuarters" },
  files: [
    { name: "lists-2026-09.json", month: "2026-09", lists: 1, tournaments: 1 },
    { name: "lists-2026-08.json", month: "2026-08", lists: 1, tournaments: 1 },
  ],
  tournaments: [{ slug: "a", name: "A", date: "2026-09-05", url: "https://miniheadquarters.com/x", lists: 1, file: "lists-2026-09.json" }],
};
const list = (n: number) => ({ heading: `Faction - ${n}st Place`, detachments: [], placing: n, listText: `Unit (${n * 10} points)\n• 1x thing\nOther (5 points)`, source: { url: "https://miniheadquarters.com/x", publication: "miniheadquarters.com" }, importedAt: "2026-09-11T00:00:00.000Z" });

const served = new Map<string, string>([
  ["https://example.invalid/corpus/index.json", JSON.stringify(index)],
  ["https://example.invalid/corpus/lists-2026-09.json", stringifyPublishedListsFile([list(1)])],
]);
const fetchImpl: FetchText = async (url) => {
  const body = served.get(url);
  return { ok: body !== undefined, status: body !== undefined ? 200 : 404, text: async () => body ?? "" };
};

describe("the corpus location", () => {
  it("is a directory with one trailing slash, whether the user typed the index file, a slash, or neither", () => {
    expect(corpusBase("https://example.invalid/corpus")).toBe("https://example.invalid/corpus/");
    expect(corpusBase("https://example.invalid/corpus/")).toBe("https://example.invalid/corpus/");
    expect(corpusBase(" https://example.invalid/corpus/index.json ")).toBe("https://example.invalid/corpus/");
  });
});

describe("reading the corpus", () => {
  it("takes the index and every monthly file, and a missing file costs a warning rather than the fetch", async () => {
    const got = await readCorpus("https://example.invalid/corpus/", fetchImpl);
    expect(got.index.tournaments).toHaveLength(1);
    expect(got.lists).toHaveLength(1);
    expect(got.lists[0]?.placing).toBe(1);
    expect(got.warnings).toEqual(["lists-2026-08.json: HTTP 404"]);
  });

  it("fails when the index is missing or is not an index", async () => {
    await expect(readCorpus("https://example.invalid/elsewhere/", fetchImpl)).rejects.toThrow(/HTTP 404/);
    await expect(readCorpus("https://example.invalid/corpus/", async () => ({ ok: true, status: 200, text: async () => "{}" }))).rejects.toThrow(/Not a corpus index/);
  });
});

describe("the stored record", () => {
  it("comes back whole, null stays null, and junk is rejected", () => {
    const record = { url: "https://example.invalid/corpus/", generatedAt: "2026-09-11T01:00:00.000Z", fetchedAt: "2026-09-11T02:00:00.000Z", lists: 1, tournaments: 1, sourceName: "MiniHeadQuarters", sourceUrl: "https://miniheadquarters.com", publication: "miniheadquarters.com", attribution: "x", months: ["2026-09"] };
    expect(parseCorpusRecord(JSON.parse(JSON.stringify(record)))).toEqual(record);
    expect(parseCorpusRecord(null)).toBeNull();
    expect(parseCorpusRecord({ url: "x" })).toBeUndefined();
    expect(parseCorpusRecord("nonsense")).toBeUndefined();
  });
});
