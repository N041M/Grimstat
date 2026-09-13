import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pendingWrite } from "./usePersistedSetting";

/** Collects what reached the store, so a test can say what was written and what was not. */
function recorder() {
  const written: Array<[string, unknown]> = [];
  return { written, write: async (key: string, value: unknown) => void written.push([key, value]) };
}

describe("a debounced write", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("collapses a run of changes into one write", async () => {
    const { written, write } = recorder();
    const w = pendingWrite(write, 250);
    w.schedule("k", 1);
    w.schedule("k", 2);
    w.schedule("k", 3);
    expect(written).toEqual([]);

    await vi.advanceTimersByTimeAsync(250);
    expect(written).toEqual([["k", 3]]);
  });

  it("writes the last edit when the wait is cut short, which is what unmounting does", async () => {
    const { written, write } = recorder();
    const w = pendingWrite(write, 250);
    w.schedule("k", 7);

    await vi.advanceTimersByTimeAsync(100);
    expect(written).toEqual([]);
    await w.flush();
    expect(written).toEqual([["k", 7]]);
  });

  it("does not write the same edit twice when the wait runs out after a flush", async () => {
    const { written, write } = recorder();
    const w = pendingWrite(write, 250);
    w.schedule("k", 7);
    await w.flush();
    await vi.advanceTimersByTimeAsync(500);
    expect(written).toEqual([["k", 7]]);
  });

  it("has nothing to write when nothing is waiting", async () => {
    const { written, write } = recorder();
    const w = pendingWrite(write, 250);
    await w.flush();
    await vi.advanceTimersByTimeAsync(500);
    expect(written).toEqual([]);
  });

  it("forgets what is waiting once it is cancelled", async () => {
    const { written, write } = recorder();
    const w = pendingWrite(write, 250);
    w.schedule("k", 7);
    w.cancel();
    await w.flush();
    await vi.advanceTimersByTimeAsync(500);
    expect(written).toEqual([]);
  });

  it("writes under the key the value was scheduled with, not the one that came after", async () => {
    const { written, write } = recorder();
    const w = pendingWrite(write, 250);
    w.schedule("first", 1);
    w.schedule("second", 2);
    await w.flush();
    expect(written).toEqual([["second", 2]]);
  });

  it("swallows a write that fails, because there is nothing to tell the person typing", async () => {
    const w = pendingWrite(async () => {
      throw new Error("no room");
    }, 250);
    w.schedule("k", 1);
    await expect(w.flush()).resolves.toBeUndefined();
  });
});
