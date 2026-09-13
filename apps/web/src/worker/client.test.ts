import { afterEach, describe, expect, it } from "vitest";
import type { Scenario, Snapshot } from "@grimstat/schema";
import { effectiveSnapshot } from "../lib/overrides";
import { CancelledError, SimClient, WorkerFailedError, snapshotKey } from "./client";

const NOW = "2026-01-01T00:00:00.000Z";

const RAW: Snapshot = {
  id: "snap",
  ownerId: "local",
  createdAt: NOW,
  updatedAt: NOW,
  revision: 0,
  gameSystemId: "wh40k-11e",
  checksum: "abc",
  sources: [],
  conflicts: [],
  data: {
    gameSystem: { id: "wh40k-11e", name: "x", edition: "11", costTypes: [] },
    factions: [],
    publications: [],
    datasheets: [],
    abilities: [{ id: "ab:x", name: "X", scope: "other", text: "t", isLegends: false }],
    detachments: [],
    enhancements: [],
    stratagems: [],
    priceRules: [],
    wargearPrices: [],
  },
};

/** What the app runs once an override is switched on. The id and the update time stay, the checksum moves. */
const PATCHED = effectiveSnapshot(RAW, [{ entity: "ability", id: "ab:x", patch: { effects: [] } }]).snapshot;

/** The fake worker answers every call, so nothing here reads the scenario. */
const SCENARIO = {} as Scenario;
const ANSWER = { result: {}, elapsedMs: 1 };

/** One message Comlink posted down the wire. */
interface Posted {
  id: string;
  type: string;
  path?: string[];
  argumentList?: Array<{ value: unknown }>;
}

type Handler = (e: unknown) => void;

/**
 * A stand-in for the Worker the client creates. It speaks Comlink's wire protocol back at the real
 * Comlink proxy, so the test can see exactly which calls were posted and answer the ones it chooses.
 */
class FakeWorker {
  static made: FakeWorker[] = [];
  terminated = false;
  private readonly posted: Posted[] = [];
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

  postMessage(message: Posted): void {
    this.posted.push(message);
  }

  terminate(): void {
    this.terminated = true;
  }

  /** The method calls posted so far, in order, with their arguments. */
  get calls(): Array<{ method: string; args: unknown[] }> {
    return this.applies.map((m) => ({ method: (m.path ?? []).join("."), args: (m.argumentList ?? []).map((a) => a.value) }));
  }

  private get applies(): Posted[] {
    return this.posted.filter((m) => m.type === "APPLY");
  }

  /** Answer the nth call the way the real worker would. */
  answer(index: number, value: unknown): void {
    const message = this.applies[index];
    if (!message) throw new Error(`no call ${index} to answer`);
    for (const l of [...(this.listeners.get("message") ?? [])]) l({ data: { id: message.id, type: "RAW", value } });
  }

  /** Fail the way a worker whose module will not load does. */
  fail(message: string): void {
    for (const l of [...(this.listeners.get("error") ?? [])]) l({ type: "error", message });
  }
}

const made = (): FakeWorker[] => FakeWorker.made;
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

function newClient(): SimClient {
  FakeWorker.made = [];
  globalThis.Worker = FakeWorker as unknown as typeof Worker;
  return new SimClient();
}

/** Move the client's clock on, so the next call finds the run in flight stale. */
const realNow = performance.now.bind(performance);
function age(ms: number): void {
  performance.now = () => realNow() + ms;
}

afterEach(() => {
  performance.now = realNow;
});

describe("shipping a snapshot to the worker", () => {
  it("hands each variant over under its own key, so an override never serves the un-patched data", async () => {
    const client = newClient();
    expect(PATCHED.id).toBe(RAW.id); // an override keeps the id and only moves the checksum
    expect(snapshotKey(PATCHED)).not.toBe(snapshotKey(RAW));

    const first = client.run(SCENARIO, RAW);
    const worker = made()[0]!;
    expect(worker.calls[0]).toEqual({ method: "putSnapshot", args: [snapshotKey(RAW), RAW] });
    worker.answer(0, [snapshotKey(RAW)]);
    await tick();
    expect(worker.calls[1]).toEqual({ method: "run", args: [SCENARIO, snapshotKey(RAW)] });
    worker.answer(1, ANSWER);
    await first;

    // Switching the override on: the patched snapshot is a second entry, not an overwrite of the first.
    const second = client.run(SCENARIO, PATCHED);
    expect(worker.calls[2]).toEqual({ method: "putSnapshot", args: [snapshotKey(PATCHED), PATCHED] });
    worker.answer(2, [snapshotKey(RAW), snapshotKey(PATCHED)]);
    await tick();
    expect(worker.calls[3]).toEqual({ method: "run", args: [SCENARIO, snapshotKey(PATCHED)] });
    worker.answer(3, ANSWER);
    await second;

    // Switching it off again: the worker still holds the raw snapshot, and the run asks for that one.
    const third = client.run(SCENARIO, RAW);
    expect(worker.calls[4]).toEqual({ method: "run", args: [SCENARIO, snapshotKey(RAW)] });
    worker.answer(4, ANSWER);
    await third;
  });

  it("hands a snapshot over again once the worker reports it has dropped it", async () => {
    const client = newClient();
    const first = client.run(SCENARIO, RAW);
    const worker = made()[0]!;
    worker.answer(0, [snapshotKey(RAW)]);
    await tick();
    worker.answer(1, ANSWER);
    await first;

    // The worker kept the patched snapshot and dropped the raw one.
    const second = client.run(SCENARIO, PATCHED);
    worker.answer(2, [snapshotKey(PATCHED)]);
    await tick();
    worker.answer(3, ANSWER);
    await second;

    const third = client.run(SCENARIO, RAW);
    expect(worker.calls[4]).toEqual({ method: "putSnapshot", args: [snapshotKey(RAW), RAW] });
    worker.answer(4, [snapshotKey(PATCHED), snapshotKey(RAW)]);
    await tick();
    worker.answer(5, ANSWER);
    await third;
  });

  it("ships one snapshot per worker, and again after the worker is replaced", async () => {
    const client = newClient();
    const first = client.run(SCENARIO, RAW);
    const worker = made()[0]!;
    worker.answer(0, [snapshotKey(RAW)]);
    await tick();
    worker.answer(1, ANSWER);
    await first;

    const second = client.run(SCENARIO, RAW);
    expect(worker.calls[2]).toEqual({ method: "run", args: [SCENARIO, snapshotKey(RAW)] });
    worker.answer(2, ANSWER);
    await second;

    client.dispose();
    const third = client.run(SCENARIO, RAW);
    const fresh = made()[1]!;
    expect(fresh.calls[0]).toEqual({ method: "putSnapshot", args: [snapshotKey(RAW), RAW] });
    fresh.answer(0, [snapshotKey(RAW)]);
    await tick();
    fresh.answer(1, ANSWER);
    await third;
  });
});

describe("a worker that stops answering", () => {
  it("settles the call in flight when a stale run makes the client respawn the worker", async () => {
    const client = newClient();
    const stale = client.run(SCENARIO, undefined);
    const worker = made()[0]!;
    expect(worker.calls).toHaveLength(1); // posted, and never answered

    age(5000); // longer than the client waits for a superseded run
    const next = client.run(SCENARIO, undefined);
    expect(worker.terminated).toBe(true);

    // The stale call resolves with no outcome. Rejecting it would mark the row it came from failed for good.
    await expect(stale).resolves.toEqual({ seq: 1, outcome: undefined });

    const fresh = made()[1]!;
    fresh.answer(0, ANSWER);
    expect((await next).outcome).toEqual(ANSWER);
  });

  it("rejects the calls in flight with CancelledError when the user cancels", async () => {
    const client = newClient();
    const call = client.run(SCENARIO, undefined);
    expect(made()[0]!.calls).toHaveLength(1);
    client.cancel();
    await expect(call).rejects.toBeInstanceOf(CancelledError);
    expect(made()[0]!.terminated).toBe(true);
  });

  it("rejects the calls in flight when the worker itself fails", async () => {
    const client = newClient();
    const call = client.run(SCENARIO, undefined);
    const worker = made()[0]!;
    worker.fail("Failed to fetch dynamically imported module");
    await expect(call).rejects.toBeInstanceOf(WorkerFailedError);
    expect(worker.terminated).toBe(true);

    // The next call gets a fresh worker rather than the broken one.
    const next = client.run(SCENARIO, undefined);
    const fresh = made()[1]!;
    fresh.answer(0, ANSWER);
    expect((await next).outcome).toEqual(ANSWER);
  });
});
