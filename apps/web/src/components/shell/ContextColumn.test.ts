import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { mayReplaceScenario, setReplaceScenarioGuard } from "./ContextColumn";

describe("the question asked before the calculator's scenario is replaced", () => {
  let undo: (() => void) | undefined;
  afterEach(() => {
    undo?.();
    undo = undefined;
  });

  it("answers yes when no shell has registered one", async () => {
    await expect(mayReplaceScenario()).resolves.toBe(true);
  });

  it("passes the answer the shell gives back to the caller", async () => {
    undo = setReplaceScenarioGuard(() => Promise.resolve(false));
    await expect(mayReplaceScenario()).resolves.toBe(false);
  });

  it("goes back to yes once the shell takes its question away", async () => {
    setReplaceScenarioGuard(() => Promise.resolve(false))();
    await expect(mayReplaceScenario()).resolves.toBe(true);
  });

  it("keeps the newest question when an older one is taken away", async () => {
    const stale = setReplaceScenarioGuard(() => Promise.resolve(true));
    undo = setReplaceScenarioGuard(() => Promise.resolve(false));
    stale();
    await expect(mayReplaceScenario()).resolves.toBe(false);
  });
});

/**
 * A pasted permalink changes the hash without reloading the page, and the palette, this column and
 * the Scenarios table all load a scenario without leaving the screen, so each of the four has to
 * ask before it drops what the calculator is holding.
 */
describe("every screen that loads a scenario", () => {
  const SCREENS = ["../../App.tsx", "./ContextColumn.tsx", "./CommandPalette.tsx", "../../pages/ScenariosPage.tsx"];
  const CALLS = /(?<![A-Za-z])replaceScenario\(/g;
  const ASKS = /mayReplaceScenario\(/g;

  it("asks first", async () => {
    for (const screen of SCREENS) {
      const src = await readFile(new URL(screen, import.meta.url), "utf8");
      const calls = src.match(CALLS)?.length ?? 0;
      expect(calls, screen).toBeGreaterThan(0);
      expect(src.match(ASKS)?.length ?? 0, screen).toBeGreaterThanOrEqual(calls);
    }
  });
});
