import { describe, expect, it } from "vitest";
import { fmt, fmtRelative, fmtSampled, ordinal, overlaps, shortRef } from "./format";

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

describe("fmtSampled", () => {
  it("prints to the finest place the interval can tell apart", () => {
    // The four magnitudes a sampled analysis actually produces.
    expect(fmtSampled(4.266, 0.5)).toBe("4");
    expect(fmtSampled(4.266, 0.07)).toBe("4.3");
    expect(fmtSampled(4.266, 0.05)).toBe("4.3");
    expect(fmtSampled(4.266, 0.005)).toBe("4.27");
  });

  it("stops at maxDigits however tight the interval is", () => {
    expect(fmtSampled(4.26638, 0.00004)).toBe("4.27");
    expect(fmtSampled(4.26638, 0.00004, 4)).toBe("4.2664");
    expect(fmtSampled(4.26638, 0.05, 4)).toBe("4.3");
  });

  it("never goes below whole numbers however wide the interval is", () => {
    expect(fmtSampled(4.266, 5)).toBe("4");
    expect(fmtSampled(4.266, 500)).toBe("4");
  });

  it("prints an exact result exactly as fmt does", () => {
    expect(fmtSampled(4.266)).toBe(fmt(4.266));
    expect(fmtSampled(4.266, undefined, 3)).toBe(fmt(4.266, 3));
    expect(fmtSampled(undefined, 0.5)).toBe("–");
    expect(fmtSampled(Number.POSITIVE_INFINITY, 0.5)).toBe("–");
  });

  it("reads a half-width that is not a positive finite number as no interval at all", () => {
    expect(fmtSampled(4.266, 0)).toBe("4.27");
    expect(fmtSampled(4.266, -0.5)).toBe("4.27");
    expect(fmtSampled(4.266, Number.NaN)).toBe("4.27");
    expect(fmtSampled(4.266, Number.POSITIVE_INFINITY)).toBe("4.27");
  });
});

describe("overlaps", () => {
  it("is true when the gap is no wider than the two half-widths together", () => {
    expect(overlaps(4.25, 0.125, 4.375, 0.125)).toBe(true); // gap 0.125, reach 0.25
    expect(overlaps(4.25, 0.125, 4.75, 0.125)).toBe(false); // gap 0.5, reach 0.25
    // Intervals that exactly touch count as overlapping.
    expect(overlaps(4.25, 0.125, 4.5, 0.125)).toBe(true);
    expect(overlaps(4.5, 0.125, 4.25, 0.125)).toBe(true); // and the order makes no difference
  });

  it("treats a missing half-width as an exact figure standing at a point", () => {
    expect(overlaps(4.25, undefined, 4.3125, undefined)).toBe(false);
    expect(overlaps(4.25, undefined, 4.3125, 0.0625)).toBe(true);
    expect(overlaps(4.25, undefined, 4.3125, 0.03125)).toBe(false);
    // A half-width that is not a positive finite number reaches nowhere either.
    expect(overlaps(4.25, Number.NaN, 4.3125, 0)).toBe(false);
  });

  it("counts two equal figures as tied whether or not they were sampled", () => {
    expect(overlaps(4.2, undefined, 4.2, undefined)).toBe(true);
    expect(overlaps(0, undefined, 0, undefined)).toBe(true);
    expect(overlaps(Number.POSITIVE_INFINITY, undefined, Number.POSITIVE_INFINITY, undefined)).toBe(true);
  });

  it("cannot call two figures tied when one of them is not a number", () => {
    expect(overlaps(Number.NaN, 0.1, 4.2, 0.1)).toBe(false);
    expect(overlaps(Number.POSITIVE_INFINITY, 0.1, 4.2, 0.1)).toBe(false);
  });
});
