import * as Comlink from "comlink";
import type { ImportResult, ImportWorkerApi } from "./import.worker";
import type { ImportEvent, ImportRequest } from "../lib/importProgress";

export class ImportCancelledError extends Error {
  override readonly name = "ImportCancelledError";
  constructor() {
    super("Import cancelled");
  }
}

/**
 * Owns the import Web Worker. One run at a time; `cancel()` terminates the worker outright (the only
 * way to interrupt a synchronous parse) and rejects the pending run with ImportCancelledError. The
 * worker is recreated lazily for the next run, so a cancelled download costs nothing afterwards.
 */
export class ImportClient {
  private worker: Worker | undefined;
  private proxy: Comlink.Remote<ImportWorkerApi> | undefined;
  private pending: { reject(e: Error): void } | undefined;
  private listeners = new Set<() => void>();

  private ensure(): Comlink.Remote<ImportWorkerApi> {
    if (!this.proxy) {
      this.worker = new Worker(new URL("./import.worker.ts", import.meta.url), { type: "module", name: "grimstat-import" });
      this.proxy = Comlink.wrap<ImportWorkerApi>(this.worker);
    }
    return this.proxy;
  }

  private respawn(): void {
    this.worker?.terminate();
    this.proxy?.[Comlink.releaseProxy]();
    this.worker = undefined;
    this.proxy = undefined;
  }

  get running(): boolean {
    return this.pending !== undefined;
  }

  /**
   * Be told when a run starts or ends; returns the way to stop being told.
   *
   * The panel that starts an import is not always mounted for the whole of it — the user can leave
   * the Data page and come back, and the run carries on in the worker. A panel that asks here knows
   * the run has ended even though it was somebody else's mount that started it.
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private announce(): void {
    for (const l of this.listeners) l();
  }

  run(request: ImportRequest, onEvent: (e: ImportEvent) => void): Promise<ImportResult> {
    if (this.pending) return Promise.reject(new Error("An import is already running"));
    const proxy = this.ensure();
    return new Promise<ImportResult>((resolve, reject) => {
      const mine = { reject };
      this.pending = mine;
      this.announce();
      const settle = (): boolean => {
        if (this.pending !== mine) return false; // cancelled meanwhile; the worker is gone
        this.pending = undefined;
        this.announce();
        return true;
      };
      proxy.run(request, Comlink.proxy(onEvent)).then(
        (r) => settle() && resolve(r),
        (e: unknown) => settle() && reject(e instanceof Error ? e : new Error(String(e))),
      );
    });
  }

  cancel(): void {
    const p = this.pending;
    if (!p) return;
    this.pending = undefined;
    this.respawn();
    p.reject(new ImportCancelledError());
    this.announce();
  }

  dispose(): void {
    this.cancel();
    this.respawn();
  }
}

let shared: ImportClient | undefined;
export function importClient(): ImportClient {
  if (!shared) shared = new ImportClient();
  return shared;
}
