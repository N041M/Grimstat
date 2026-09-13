import * as Comlink from "comlink";
import type { MetaResolveResult, MetaWorkerApi } from "./meta.worker";
import { notifyStoreChanged } from "../db";

export interface MetaProgress {
  readonly done: number;
  readonly total: number;
}

type Listener = (snapshotId: string, progress: MetaProgress | undefined) => void;

/** What a job in flight rejects with when the worker itself fails to load or to answer. */
export class MetaFailedError extends Error {
  constructor(options?: ErrorOptions) {
    super("Reading the published lists stopped. Try again.", options);
    this.name = "MetaFailedError";
  }
}

/** What the browser said about a worker that failed. */
function failureDetail(e: Event): string {
  return "message" in e && typeof e.message === "string" && e.message ? e.message : e.type;
}

/**
 * Owns the meta worker. One job runs per snapshot at a time; a second request for the same snapshot
 * joins the running one. Each batch the worker writes is announced as a store change, so a tab
 * watching the store shows lists as they resolve, and progress fans out to every subscriber.
 */
class MetaClient {
  private worker: Worker | undefined;
  private proxy: Comlink.Remote<MetaWorkerApi> | undefined;
  private readonly jobs = new Map<string, Promise<MetaResolveResult>>();
  private readonly progress = new Map<string, MetaProgress>();
  private readonly listeners = new Set<Listener>();
  /** Rejecters of the jobs in flight, so a failed worker settles them instead of leaving them waiting. */
  private readonly pending = new Set<(e: Error) => void>();

  private ensure(): Comlink.Remote<MetaWorkerApi> {
    if (!this.proxy) {
      const worker = new Worker(new URL("./meta.worker.ts", import.meta.url), { type: "module", name: "grimstat-meta" });
      // A worker that fails to load or throws on its own never answers, so the jobs waiting on it are
      // rejected here. The listener ignores a worker this client has already replaced.
      const failed = (e: Event): void => {
        if (this.worker === worker) this.fail(new MetaFailedError({ cause: failureDetail(e) }));
      };
      worker.addEventListener("error", failed);
      worker.addEventListener("messageerror", failed);
      this.worker = worker;
      this.proxy = Comlink.wrap<MetaWorkerApi>(worker);
    }
    return this.proxy;
  }

  /** Drop the worker and reject every job in flight. The next request starts a fresh worker. */
  private fail(e: Error): void {
    const waiting = [...this.pending];
    this.pending.clear();
    this.worker?.terminate();
    this.proxy?.[Comlink.releaseProxy]();
    this.worker = undefined;
    this.proxy = undefined;
    for (const reject of waiting) reject(e);
  }

  private emit(snapshotId: string, progress: MetaProgress | undefined): void {
    if (progress) this.progress.set(snapshotId, progress);
    else this.progress.delete(snapshotId);
    for (const l of this.listeners) l(snapshotId, progress);
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  progressOf(snapshotId: string): MetaProgress | undefined {
    return this.progress.get(snapshotId);
  }

  /** Resolve whatever this snapshot has not resolved yet. Resolves to the job's summary. */
  resolve(snapshotId: string): Promise<MetaResolveResult> {
    const running = this.jobs.get(snapshotId);
    if (running) return running;
    const proxy = this.ensure();
    let fail: (e: Error) => void = () => undefined;
    const job = new Promise<MetaResolveResult>((settle, reject) => {
      fail = reject;
      proxy
        .resolve(
          snapshotId,
          Comlink.proxy((done: number, total: number) => {
            this.emit(snapshotId, { done, total });
            if (done > 0) notifyStoreChanged("publishedResolved");
          }),
        )
        .then(settle, reject);
    }).finally(() => {
      this.pending.delete(fail);
      this.jobs.delete(snapshotId);
      this.emit(snapshotId, undefined);
      notifyStoreChanged("publishedResolved");
    });
    this.pending.add(fail);
    this.jobs.set(snapshotId, job);
    return job;
  }

  /** Start a job and forget it: the caller only wants the rows to exist when a tab next looks. */
  warm(snapshotId: string | undefined): void {
    if (snapshotId) void this.resolve(snapshotId).catch(() => undefined);
  }
}

export const metaClient = new MetaClient();
