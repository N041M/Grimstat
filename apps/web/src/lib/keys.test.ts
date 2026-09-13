/**
 * The shortcut hints name keys the reader actually has.
 *
 * The Command key is not on a Windows keyboard, so a hint reading "⌘K" tells a Windows reader
 * nothing. The handlers answer to Command and to Control either way; these tests cover what the
 * hint says, and that every string carrying a key name is given one.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "../i18n";

const MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";
const WINDOWS = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";

async function keysFor(userAgent: string) {
  vi.resetModules();
  vi.stubGlobal("navigator", { userAgent });
  return import("./keys");
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("the modifier a hint names", () => {
  it("is the Command symbol on a Mac", async () => {
    const k = await keysFor(MAC);
    expect(k.MOD).toBe("⌘");
    expect(k.MOD_NAME).toBe("⌘");
    expect(k.SHIFT).toBe("⇧");
    expect(k.DELETE_KEY).toBe("⌫");
    expect(k.ENTER).toBe("↵");
  });

  it("is spelled out on Windows", async () => {
    const k = await keysFor(WINDOWS);
    expect(k.MOD).toBe("Ctrl+");
    expect(k.MOD_NAME).toBe("Ctrl");
    expect(k.SHIFT).toBe("Shift+");
    expect(k.DELETE_KEY).toBe("Backspace");
    expect(k.ENTER).toBe("Enter");
  });

  it("reads as a whole shortcut on both", async () => {
    expect(`${(await keysFor(MAC)).MOD}K`).toBe("⌘K");
    expect(`${(await keysFor(WINDOWS)).MOD}K`).toBe("Ctrl+K");
  });

  it("spells them out where there is no browser to ask", async () => {
    vi.resetModules();
    vi.stubGlobal("navigator", undefined);
    const k = await import("./keys");
    expect(k.MOD).toBe("Ctrl+");
  });
});

describe("the strings that carry a key name", () => {
  /** Every hint that names a key, with the values its caller passes. */
  const hints = [
    ["palette.openHint", { mod: "Ctrl+" }],
    ["palette.footOpen", { mod: "Ctrl+" }],
    ["palette.footRun", { enter: "Enter" }],
    ["battle.terrain.keys", { mod: "Ctrl+", shift: "Shift+", del: "Backspace" }],
    ["battle.group.hint", { mod: "Ctrl" }],
  ] as const;

  it("has every placeholder filled in", () => {
    for (const [key, vars] of hints) {
      const text = t(key, vars);
      expect(text, `${key} left a placeholder unfilled`).not.toMatch(/\{[a-z]+\}/i);
    }
  });

  it("carries no Command symbol of its own on Windows", () => {
    for (const [key, vars] of hints) {
      expect(t(key, vars), `${key} names a key a Windows reader does not have`).not.toMatch(/[⌘⌥⇧⌫]/);
    }
  });
});
