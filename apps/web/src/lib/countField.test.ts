import { describe, expect, it } from "vitest";
import { commitCount, tidyEntry } from "./collection";

describe("a count field", () => {
  it("keeps the count when the field is empty, so clearing it to retype never commits a zero", () => {
    expect(commitCount("", 10)).toBe(10);
    expect(commitCount("   ", 10)).toBe(10);
  });

  it("keeps the count when what is in it does not read as a number", () => {
    expect(commitCount("-", 10)).toBe(10);
    expect(commitCount("abc", 10)).toBe(10);
  });

  it("commits what was typed, as a whole count that is never negative", () => {
    expect(commitCount("12", 10)).toBe(12);
    expect(commitCount("0", 10)).toBe(0);
    expect(commitCount("7.6", 10)).toBe(8);
    expect(commitCount("-3", 10)).toBe(0);
  });

  it("commits no more than the ceiling it was given, which is what is owned for the painted count", () => {
    expect(commitCount("30", 4, 10)).toBe(10);
  });

  it("is what stands between an emptied Owned field and the painted count", () => {
    const entry = { owned: 10, painted: 6 };
    expect(tidyEntry({ ...entry, owned: 0 }).painted).toBe(0);
    expect(tidyEntry({ ...entry, owned: commitCount("", entry.owned) }).painted).toBe(6);
  });
});
