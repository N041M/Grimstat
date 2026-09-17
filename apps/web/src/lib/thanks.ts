/**
 * People who sent feedback, and where to find them.
 *
 * One entry per person, in the order they first helped. `name` is whatever they want to be called,
 * `note` is the short version of what they helped with, and `link` is a profile of their choosing.
 * All three are shown as written, so ask before adding somebody and use the name and link they give
 * you. To add a person, append an entry:
 *
 *     { name: "Some Player", note: "spotted the Dark Angels points", link: "https://bsky.app/profile/…" },
 *
 * The About page hides the whole section while the list is empty.
 */

export interface Thanks {
  /** As the person wants to be credited. */
  readonly name: string;
  /** What they helped with, a few words. Optional. */
  readonly note?: string;
  /** An https profile link they gave you. Optional. */
  readonly link?: string;
}

export const THANKS: readonly Thanks[] = [];

/** The site a profile link points at, for the small label beside the name. */
export function thanksSite(link: string): string {
  try {
    return new URL(link).hostname.replace(/^www\./, "");
  } catch {
    return link;
  }
}
