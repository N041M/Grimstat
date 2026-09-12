/**
 * The published 11th-edition layouts, fetched onto this machine.
 *
 * Same policy as every other piece of game data here: nothing ships in the app, the user fetches it
 * from a community source, and the result records where it came from. The source is the 40kdc-data
 * project (CC BY 4.0); the layouts it carries are the Event Companion cards, placed by centroid, with
 * the on-top scenery composed from its template catalogue.
 */

import { FORTYKDC, convertFortykdc, fetchFortykdc, type FetchLike } from "@grimstat/adapters";
import { saveLayouts, type StoredLayout } from "./layoutStore";

export interface PublishedLayoutsFetch {
  readonly stored: number;
  readonly warnings: readonly string[];
  readonly ref?: string;
}

/** A layout that came from the published source rather than from the app or the user. */
export const isPublished = (id: string): boolean => id.startsWith(FORTYKDC.idPrefix);

export const publishedIn = (library: readonly StoredLayout[]): number => library.filter((l) => isPublished(l.layout.id)).length;

/** Thrown when the signal a caller passed in is aborted while the fetch is running. */
export const CANCELLED = "cancelled";

/** How many files the fetch reads. Known before it starts, so the panel can count them down. */
export const LAYOUT_FILE_COUNT = FORTYKDC.files.length;

export interface PublishedLayoutsOptions {
  /** Aborting it stops the fetch before the next file and before anything is stored. */
  readonly signal?: AbortSignal;
  readonly onProgress?: (done: number, total: number) => void;
}

export async function fetchPublishedLayouts(opts: PublishedLayoutsOptions = {}): Promise<PublishedLayoutsFetch> {
  const { signal, onProgress } = opts;
  let done = 0;
  onProgress?.(done, LAYOUT_FILE_COUNT);
  // The dataset's own fetch takes the files one at a time, so wrapping it counts them and carries the signal.
  const fetchImpl: FetchLike = async (target, init) => {
    if (signal?.aborted) throw new Error(CANCELLED);
    const res = await fetch(target, { ...(init?.headers ? { headers: init.headers } : {}), ...(signal ? { signal } : {}) });
    if (target.startsWith(FORTYKDC.rawBase)) {
      done += 1;
      onProgress?.(done, LAYOUT_FILE_COUNT);
    }
    return res;
  };
  const { files, ref, url } = await fetchFortykdc(fetchImpl);
  if (signal?.aborted) throw new Error(CANCELLED);
  const { layouts, warnings } = convertFortykdc(files, { importedFrom: url, ...(ref ? { ref } : {}) });
  if (layouts.length) await saveLayouts(layouts, ref ? `${FORTYKDC.name} @ ${ref}` : FORTYKDC.name);
  return { stored: layouts.length, warnings, ...(ref ? { ref } : {}) };
}
