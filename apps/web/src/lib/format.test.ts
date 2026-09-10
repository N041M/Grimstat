import { describe, expect, it } from "vitest";
import { shortRef } from "./format";

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
