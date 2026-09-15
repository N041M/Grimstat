import { describe, expect, it } from "vitest";
import type { SourceRef } from "@grimstat/schema";
import { cardModel } from "./FetchSources";

const stored: SourceRef = { adapter: "mfm-yaml", fetchedAt: "2026-09-01T00:00:00.000Z", ref: "mfm-v1.4@2026-09-01" };

describe("cardModel: the one thing a card says about the stored copy", () => {
  it("says current when the stored copy matches upstream", () => {
    expect(cardModel("mfm-yaml", undefined, stored, undefined, "current").status).toBe("current");
    expect(cardModel("mfm-yaml", undefined, stored, undefined, "current").stale).toBeFalsy();
  });

  it("says outdated, and asks to be looked at, when upstream has moved on", () => {
    const m = cardModel("mfm-yaml", undefined, stored, undefined, "stale");
    expect(m.status).toBe("outdated");
    expect(m.stale).toBe(true);
  });

  it("says not checked rather than claiming either way", () => {
    expect(cardModel("mfm-yaml", undefined, stored, undefined, "unknown").status).toBe("not checked");
  });

  it("says not fetched when there is no stored copy, whatever upstream reports", () => {
    expect(cardModel("mfm-yaml", undefined, undefined, undefined, "stale").status).toBe("not fetched");
  });

  it("says a source is not answering, before anything long has been started", () => {
    // The mirror's address is typed by hand, and a dead one used to look exactly like a live one
    // until a finished run turned out to have no stratagems in it.
    const m = cardModel("wahapedia-csv", undefined, stored, undefined, "unknown", "GET https://mirror.test/Last_update.csv -> HTTP 404");
    expect(m.status).toBe("not answering");
    expect(m.detail).toContain("HTTP 404");
    expect(m.fraction).toBe(0);
  });

  it("lets a run in progress win over the last failure, and over all of it", () => {
    const m = cardModel("wahapedia-csv", { id: "wahapedia-csv", stage: "downloading", index: 1, total: 19, files: 0, warnings: 0, sample: [] }, stored, undefined, "unknown", "HTTP 404");
    expect(m.status).toBe("downloading");
  });

  it("lets a run in progress win over all of it", () => {
    const m = cardModel("mfm-yaml", { id: "mfm-yaml", stage: "downloading", index: 2, total: 5, files: 0, warnings: 0, sample: [] }, stored, undefined, "stale");
    expect(m.live).toBe(true);
    expect(m.status).not.toBe("outdated");
  });
});
