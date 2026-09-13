import { describe, expect, it } from "vitest";
import { fetchSource, type FetchLike } from "./sources";

/**
 * The deadline on a download. Without one a server that accepts a connection and then stops sending
 * holds the whole run open, which is how a scheduled job reaches its six-hour limit instead of
 * failing in a minute.
 */

describe("a download's deadline", () => {
  it("puts a signal that is not yet aborted on every request", async () => {
    const signals: Array<AbortSignal | undefined> = [];
    const fetch: FetchLike = async (_url, init) => {
      signals.push(init?.signal);
      return { ok: true, status: 200, text: async () => "a|b|\n1|2|\n" };
    };
    await fetchSource("wahapedia-csv", fetch, { urls: ["https://example.invalid/wh/"] });
    expect(signals).toHaveLength(19);
    for (const signal of signals) {
      expect(signal).toBeInstanceOf(AbortSignal);
      expect(signal!.aborted).toBe(false);
    }
  });

  it("reports a request that ran out of time as an error naming the file", async () => {
    const fetch: FetchLike = async () => {
      const e = new Error("The operation was aborted due to timeout");
      e.name = "TimeoutError";
      throw e;
    };
    await expect(fetchSource("wahapedia-csv", fetch, { urls: ["https://example.invalid/wh/"] })).rejects.toThrow(/Factions\.csv -> no answer within \d+ seconds/);
  });

  it("leaves every other failure alone", async () => {
    const fetch: FetchLike = async () => {
      throw new Error("getaddrinfo ENOTFOUND example.invalid");
    };
    await expect(fetchSource("wahapedia-csv", fetch, { urls: ["https://example.invalid/wh/"] })).rejects.toThrow(/ENOTFOUND/);
  });
});
