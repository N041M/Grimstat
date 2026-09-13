/**
 * What the import and meta clients do when their worker dies.
 *
 * A worker whose module will not load, or which throws on its own, never answers the call waiting on
 * it. Without the error listener that call waits for ever: the Data page's Fetch button stays
 * disabled with no way back, and the Meta tab never stops saying it is working.
 *
 * `client.test.ts` asks the same question of the simulation client. These two own their workers the
 * same way and are covered here together, because the fake worker below is the whole of the setup.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import type { ImportRequest } from "../lib/importProgress";

vi.mock("../db", () => ({ notifyStoreChanged: () => undefined }));

type Handler = (e: unknown) => void;

/** A stand-in for the Worker a client creates. It answers nothing; the tests only make it fail. */
class FakeWorker {
  static made: FakeWorker[] = [];
  terminated = false;
  private readonly listeners = new Map<string, Set<Handler>>();

  constructor() {
    FakeWorker.made.push(this);
  }
  addEventListener(type: string, listener: Handler): void {
    const set = this.listeners.get(type) ?? new Set<Handler>();
    set.add(listener);
    this.listeners.set(type, set);
  }
  removeEventListener(type: string, listener: Handler): void {
    this.listeners.get(type)?.delete(listener);
  }
  postMessage(): void {
    /* the tests never let a call be answered */
  }
  terminate(): void {
    this.terminated = true;
  }
  /** Fail the way a worker whose module will not load does. */
  fail(message: string): void {
    for (const l of [...(this.listeners.get("error") ?? [])]) l({ type: "error", message });
  }
}

const install = (): void => {
  FakeWorker.made = [];
  globalThis.Worker = FakeWorker as unknown as typeof Worker;
};
const made = (): FakeWorker[] => FakeWorker.made;
const BROKEN = "Failed to fetch dynamically imported module";

afterEach(() => {
  vi.resetModules();
});

describe("the import client", () => {
  const request = { gameSystemId: "wh40k-11e", sources: [], label: "test" } as ImportRequest;

  it("rejects the run in flight when the worker fails, and frees the button", async () => {
    install();
    const { ImportClient, ImportFailedError } = await import("./importClient");
    const client = new ImportClient();
    const run = client.run(request, () => undefined);
    expect(client.running).toBe(true);
    made()[0]!.fail(BROKEN);
    await expect(run).rejects.toBeInstanceOf(ImportFailedError);
    expect(client.running).toBe(false);
    expect(made()[0]!.terminated).toBe(true);
  });

  it("says what the browser reported", async () => {
    install();
    const { ImportClient } = await import("./importClient");
    const run = new ImportClient().run(request, () => undefined);
    made()[0]!.fail(BROKEN);
    await expect(run).rejects.toMatchObject({ cause: BROKEN });
  });

  it("takes a fresh worker for the next run", async () => {
    install();
    const { ImportClient } = await import("./importClient");
    const client = new ImportClient();
    const first = client.run(request, () => undefined);
    made()[0]!.fail(BROKEN);
    await expect(first).rejects.toThrow();
    void client.run(request, () => undefined).catch(() => undefined);
    expect(made()).toHaveLength(2);
  });
});

describe("the meta client", () => {
  it("rejects every job in flight when the worker fails", async () => {
    install();
    const { metaClient, MetaFailedError } = await import("./metaClient");
    const one = metaClient.resolve("snap-1");
    const two = metaClient.resolve("snap-2");
    made()[0]!.fail(BROKEN);
    await expect(one).rejects.toBeInstanceOf(MetaFailedError);
    await expect(two).rejects.toBeInstanceOf(MetaFailedError);
    expect(made()[0]!.terminated).toBe(true);
  });

  it("stops reporting progress for a snapshot whose job died", async () => {
    install();
    const { metaClient } = await import("./metaClient");
    const job = metaClient.resolve("snap-1");
    made()[0]!.fail(BROKEN);
    await expect(job).rejects.toThrow();
    expect(metaClient.progressOf("snap-1")).toBeUndefined();
  });
});
