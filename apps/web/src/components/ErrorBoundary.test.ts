import { describe, expect, it } from "vitest";
import { isChunkLoadError } from "./ErrorBoundary";

describe("isChunkLoadError", () => {
  it("recognises the wording each browser uses for a part of the app that did not arrive", () => {
    expect(isChunkLoadError(new TypeError("Failed to fetch dynamically imported module: https://example.com/BattleCanvas-a1b2.js"))).toBe(true);
    expect(isChunkLoadError(new TypeError("error loading dynamically imported module"))).toBe(true);
    expect(isChunkLoadError(new TypeError("Importing a module script failed."))).toBe(true);
    const named = new Error("Loading chunk 7 failed");
    named.name = "ChunkLoadError";
    expect(isChunkLoadError(named)).toBe(true);
  });

  it("leaves an ordinary failure alone, so the page is not offered a reload it does not need", () => {
    expect(isChunkLoadError(new TypeError("Cannot read properties of undefined (reading 'map')"))).toBe(false);
    expect(isChunkLoadError(new Error("The calculation stopped. Try again."))).toBe(false);
    expect(isChunkLoadError("Failed to fetch dynamically imported module")).toBe(false);
    expect(isChunkLoadError(undefined)).toBe(false);
  });
});
