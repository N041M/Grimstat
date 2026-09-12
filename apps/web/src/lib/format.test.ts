import { describe, expect, it } from "vitest";
import { fmtRelative, ordinal, shortRef } from "./format";

describe("shortRef", () => {
  it("shortens a git object id to eight characters", () => {
    expect(shortRef("5b261ec423d5d017bb733c4f3c0a760b085d1a2c")).toBe("5b261ec4");
    expect(shortRef("ABCDEF0123456789")).toBe("ABCDEF01");
  });

  it("leaves readable references alone", () => {
    expect(shortRef("mfm-v1.4@2026-09-02")).toBe("mfm-v1.4@2026-09-02");
    expect(shortRef("2026-09-07 15:20:22")).toBe("2026-09-07 15:20:22");
    expect(shortRef("abc123")).toBe("abc123"); // too short to be an object id
    expect(shortRef(undefined)).toBeUndefined();
  });
});

describe("ordinal", () => {
  it("picks the English suffix by plural category", () => {
    expect(ordinal(1)).toBe("1st");
    expect(ordinal(2)).toBe("2nd");
    expect(ordinal(3)).toBe("3rd");
    expect(ordinal(4)).toBe("4th");
    expect(ordinal(11)).toBe("11th");
    expect(ordinal(12)).toBe("12th");
    expect(ordinal(13)).toBe("13th");
    expect(ordinal(21)).toBe("21st");
    expect(ordinal(112)).toBe("112th");
  });
});

describe("fmtRelative", () => {
  const now = Date.parse("2026-09-12T12:00:00Z");
  it("reads through the dictionary", () => {
    expect(fmtRelative("2026-09-12T11:59:50Z", now)).toBe("just now");
    expect(fmtRelative("2026-09-12T11:30:00Z", now)).toBe("30m ago");
    expect(fmtRelative("2026-09-12T09:00:00Z", now)).toBe("3h ago");
    expect(fmtRelative("2026-09-10T12:00:00Z", now)).toBe("2d ago");
    expect(fmtRelative("2026-08-01T12:00:00Z", now)).toBe("2026-08-01");
  });
});
