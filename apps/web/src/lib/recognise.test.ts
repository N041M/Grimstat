import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stallGuard } from "./recognise";

/**
 * The watchdog behind the recogniser's loading step.
 *
 * Its files are fetched from the app's own origin, and a browser that refuses one of them leaves the
 * load neither finished nor failed. The screen sat at "Getting ready to read pictures…" for as long
 * as anybody was willing to watch it, which is the one outcome a reader cannot act on.
 */
describe("stallGuard", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("gives up once nothing has happened for the whole window", async () => {
    const guard = stallGuard(1000);
    const seen = guard.stalled.catch((e: Error) => e);
    vi.advanceTimersByTime(999);
    await Promise.resolve();
    vi.advanceTimersByTime(1);
    const error = await seen;
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).name).toBe("RecogniserStalledError");
    expect((error as Error).message).toContain("1 second");
  });

  it("starts the window again on every step the recogniser reports", async () => {
    const guard = stallGuard(1000);
    let fired = false;
    void guard.stalled.catch(() => (fired = true));
    for (let i = 0; i < 5; i++) {
      vi.advanceTimersByTime(900);
      guard.tick();
    }
    vi.advanceTimersByTime(900);
    await Promise.resolve();
    expect(fired, "a load that keeps reporting is not called stalled").toBe(false);
    vi.advanceTimersByTime(200);
    await Promise.resolve();
    expect(fired).toBe(true);
  });

  it("stops when the read is over, so a finished read cannot reject afterwards", async () => {
    const guard = stallGuard(1000);
    let fired = false;
    void guard.stalled.catch(() => (fired = true));
    guard.stop();
    vi.advanceTimersByTime(10_000);
    await Promise.resolve();
    expect(fired).toBe(false);
  });
});
