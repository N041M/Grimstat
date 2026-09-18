import { describe, expect, it } from "vitest";
import { formatClosesOn, movedNotice } from "./moved";

describe("movedNotice", () => {
  it("is nothing for a build that has not moved", () => {
    expect(movedNotice({})).toBeUndefined();
    expect(movedNotice({ VITE_MOVED_TO: "  " })).toBeUndefined();
  });

  it("names the new address as a host and keeps the link", () => {
    const n = movedNotice({ VITE_MOVED_TO: "https://grimstat.com" });
    expect(n).toEqual({ url: "https://grimstat.com/", host: "grimstat.com" });
  });

  it("ignores an address that is not a web address", () => {
    expect(movedNotice({ VITE_MOVED_TO: "grimstat.com" })).toBeUndefined();
    expect(movedNotice({ VITE_MOVED_TO: "javascript:alert(1)" })).toBeUndefined();
  });

  it("carries the closing date only when it is a calendar date", () => {
    expect(movedNotice({ VITE_MOVED_TO: "https://grimstat.com", VITE_CLOSES_ON: "2026-10-16" })?.closesOn?.toISOString()).toBe("2026-10-16T12:00:00.000Z");
    expect(movedNotice({ VITE_MOVED_TO: "https://grimstat.com", VITE_CLOSES_ON: "soon" })?.closesOn).toBeUndefined();
    expect(movedNotice({ VITE_MOVED_TO: "https://grimstat.com", VITE_CLOSES_ON: "2026-13-40" })?.closesOn).toBeUndefined();
  });

  it("writes the closing date out in full", () => {
    expect(formatClosesOn(new Date("2026-10-16T12:00:00Z"), "en-GB")).toBe("16 October 2026");
  });
});
