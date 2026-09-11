/**
 * The published 11th-edition layouts, fetched onto this machine.
 *
 * Same policy as every other piece of game data here: nothing ships in the app, the user fetches it
 * from a community source, and the result records where it came from. The source is the 40kdc-data
 * project (CC BY 4.0); the layouts it carries are the Event Companion cards, placed by centroid, with
 * the on-top scenery composed from its template catalogue.
 */

import { FORTYKDC, convertFortykdc, fetchFortykdc } from "@grimstat/adapters";
import { saveLayouts, type StoredLayout } from "./layoutStore";

export interface PublishedLayoutsFetch {
  readonly stored: number;
  readonly warnings: readonly string[];
  readonly ref?: string;
}

/** A layout that came from the published source rather than from the app or the user. */
export const isPublished = (id: string): boolean => id.startsWith(FORTYKDC.idPrefix);

export const publishedIn = (library: readonly StoredLayout[]): number => library.filter((l) => isPublished(l.layout.id)).length;

export async function fetchPublishedLayouts(): Promise<PublishedLayoutsFetch> {
  const { files, ref, url } = await fetchFortykdc();
  const { layouts, warnings } = convertFortykdc(files, { importedFrom: url, ...(ref ? { ref } : {}) });
  if (layouts.length) await saveLayouts(layouts, ref ? `${FORTYKDC.name} @ ${ref}` : FORTYKDC.name);
  return { stored: layouts.length, warnings, ...(ref ? { ref } : {}) };
}
