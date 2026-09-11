import * as Comlink from "comlink";
import type { MetaResolveResult, MetaWorkerApi } from "./meta.worker";
import { notifyStoreChanged } from "../db";

export interface MetaProgress {
  readonly done: number;
  readonly total: number;
}

type Listener = (snapshotId: string, progress: MetaProgress | undefined) => void;

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

  private ensure(): Comlink.Remote<MetaWorkerApi> {
    if (!this.proxy) {
      this.worker = new Worker(new URL("./meta.worker.ts", import.meta.url), { type: "module", name: "grimstat-meta" });
      this.proxy = Comlink.wrap<MetaWorkerApi>(this.worker);
    }
    return this.proxy;
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
    const job = proxy
      .resolve(
        snapshotId,
        Comlink.proxy((done: number, total: number) => {
          this.emit(snapshotId, { done, total });
          if (done > 0) notifyStoreChanged("publishedResolved");
        }),
      )
      .finally(() => {
        this.jobs.delete(snapshotId);
        this.emit(snapshotId, undefined);
        notifyStoreChanged("publishedResolved");
      });
    this.jobs.set(snapshotId, job);
    return job;
  }

  /** Start a job and forget it: the caller only wants the rows to exist when a tab next looks. */
  warm(snapshotId: string | undefined): void {
    if (snapshotId) void this.resolve(snapshotId).catch(() => undefined);
  }
}

export const metaClient = new MetaClient();
