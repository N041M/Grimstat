/**
 * The list is empty until somebody is added to it, so these tests are the guard on what gets added:
 * a name once, a link that goes somewhere over https, and a note short enough for the line it sits
 * on.
 */

import { describe, expect, it } from "vitest";
import { THANKS, thanksSite } from "./thanks";

describe("the thanks list", () => {
  it("names each person once", () => {
    const names = THANKS.map((p) => p.name);
    for (const name of names) expect(name.trim().length).toBeGreaterThan(0);
    expect(new Set(names).size).toBe(names.length);
  });

  it("links only to an https profile", () => {
    for (const { name, link } of THANKS) {
      if (link === undefined) continue;
      expect(() => new URL(link), name).not.toThrow();
      expect(new URL(link).protocol, name).toBe("https:");
    }
  });

  it("keeps the note to a few words", () => {
    for (const { name, note } of THANKS) {
      if (note === undefined) continue;
      expect(note.trim().length, name).toBeGreaterThan(0);
      expect(note.length, name).toBeLessThanOrEqual(60);
    }
  });
});

describe("the site beside a name", () => {
  it("is the host, without the www", () => {
    expect(thanksSite("https://bsky.app/profile/someone")).toBe("bsky.app");
    expect(thanksSite("https://www.reddit.com/user/someone")).toBe("reddit.com");
  });

  it("falls back to the text for anything that is not a URL", () => {
    expect(thanksSite("not a url")).toBe("not a url");
  });
});
