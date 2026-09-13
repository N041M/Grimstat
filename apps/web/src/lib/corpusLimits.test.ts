import { describe, expect, it } from "vitest";
import { MAX_CORPUS_CHARS, MAX_CORPUS_FILES, readCorpus } from "./corpusFetch";

const index = (files: number) => ({
  format: "grimstat-corpus",
  version: 1,
  generatedAt: "2026-09-01T00:00:00.000Z",
  source: { id: "relay", name: "Relay", url: "https://example.invalid/", publication: "example.invalid", attribution: "Relay" },
  tournaments: [],
  files: Array.from({ length: files }, (_, i) => ({ name: `${2000 + i}-01.json`, month: `${2000 + i}-01`, lists: 1, tournaments: 1 })),
});

const serving = (body: unknown) => {
  const urls: string[] = [];
  const fetchImpl = (url: string) => {
    urls.push(url);
    return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(typeof body === "string" ? body : JSON.stringify(body)) });
  };
  return { urls, fetchImpl };
};

describe("how much of a corpus one fetch will read", () => {
  it("asks for every month an index of a sane size names", async () => {
    const { urls, fetchImpl } = serving(index(2));
    const read = await readCorpus("https://example.invalid/", fetchImpl);
    expect(read.index.files).toHaveLength(2);
    expect(urls).toEqual(["https://example.invalid/index.json", "https://example.invalid/2000-01.json", "https://example.invalid/2001-01.json"]);
  });

  it("refuses an index naming more files than it will fetch, before asking for any of them", async () => {
    const { urls, fetchImpl } = serving(index(MAX_CORPUS_FILES + 1));
    await expect(readCorpus("https://example.invalid/", fetchImpl)).rejects.toThrow(/names 241 files/);
    expect(urls).toHaveLength(1);
  });

  it("refuses an index longer than it will read", async () => {
    const { fetchImpl } = serving(" ".repeat(MAX_CORPUS_CHARS + 1));
    await expect(readCorpus("https://example.invalid/", fetchImpl)).rejects.toThrow(/more than the/);
  });

  it("leaves an oversized monthly file out and says so", async () => {
    let first = true;
    const fetchImpl = (_url: string) => {
      const body = first ? JSON.stringify(index(1)) : " ".repeat(MAX_CORPUS_CHARS + 1);
      first = false;
      return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(body) });
    };
    const read = await readCorpus("https://example.invalid/", fetchImpl);
    expect(read.lists).toHaveLength(0);
    expect(read.warnings[0]).toMatch(/2000-01\.json: \d+ characters/);
  });
});
