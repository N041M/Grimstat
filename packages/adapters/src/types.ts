import type { Datasheet, SnapshotData, SourceRef } from "@grimstat/schema";

/**
 * A datasheet as emitted by a single adapter. Points-only sources (MFM) cannot supply model
 * profiles, so `models`/`weapons`/... are optional here; the snapshot merge fills them from
 * other sources and drops stubs that never receive a model profile.
 */
export type DatasheetStub = Pick<Datasheet, "id" | "gameSystemId" | "factionId" | "name"> & Partial<Datasheet>;

/** Output of every importer: a partial snapshot plus provenance and warnings. */
export type AdapterOutput = Omit<Partial<SnapshotData>, "datasheets"> & {
  datasheets?: DatasheetStub[];
  sourceRef: SourceRef;
  warnings: string[];
  /** Adapter-specific, loosely typed extras (e.g. the BSData selection-entry tree). */
  staging?: unknown;
};

export interface ParseOptions {
  /** Defaults to "wh40k-11e". */
  gameSystemId?: string;
  /** ISO timestamp recorded in sourceRef.fetchedAt (defaults to now). */
  fetchedAt?: string;
  /** Upstream URL recorded in sourceRef.url. */
  url?: string;
  /** Upstream ref (git SHA, version) recorded in sourceRef.ref when the adapter cannot derive one. */
  ref?: string;
}

/** Input for an adapter: either a single document or a map of file name -> file content. */
export type AdapterInput = string | Record<string, string>;

export interface Adapter {
  id: string;
  parse(input: AdapterInput, opts?: ParseOptions): AdapterOutput;
}

export const DEFAULT_GAME_SYSTEM_ID = "wh40k-11e";

export function asFileMap(input: AdapterInput, singleName: string): Record<string, string> {
  return typeof input === "string" ? { [singleName]: input } : input;
}

export function fetchedAtOrNow(opts?: ParseOptions): string {
  return opts?.fetchedAt ?? new Date().toISOString();
}
