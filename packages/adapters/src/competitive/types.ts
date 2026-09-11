/**
 * Army lists published in tournament write-ups.
 *
 * A write-up gives each list a heading naming the player, their faction, the detachments they took,
 * their Force Disposition and where they placed — more than any free tournament API exposes — and
 * then prints the list exactly as the official app exported it. That is the shape this module
 * recovers, and the list text is kept verbatim so `importRosterText` can resolve it against whatever
 * snapshot the user has loaded.
 */

/** One published list, with everything the write-up said about it. */
export interface PublishedList {
  /** The heading the list appeared under, kept whole so a mis-parse can always be checked. */
  readonly heading: string;
  readonly player?: string;
  readonly faction?: string;
  readonly detachments: readonly string[];
  readonly forceDisposition?: string;
  /** 1 for first place, 2 for second, and so on. Absent when the heading did not say. */
  readonly placing?: number;
  /** The list's own first line, which the app writes as "<faction> - <event> (<n> points)". */
  readonly listName?: string;
  /** The list exactly as published. Not parsed here: that needs a snapshot, and this module has none. */
  readonly listText: string;
}

/** Where a set of lists came from. Provenance is required, not decorative. */
export interface ArticleSource {
  readonly url?: string;
  readonly title?: string;
  readonly published?: string;
  readonly publication?: string;
}

export interface PublishedArticle {
  readonly source: ArticleSource;
  readonly lists: readonly PublishedList[];
  /** Headings that looked like list headings but yielded no list, and anything else skipped. */
  readonly warnings: readonly string[];
}

/** One entry of the write-up feed. */
export interface FeedEntry {
  readonly title: string;
  readonly url: string;
  readonly published?: string;
  /**
   * Whether the title marks this as a 40k article. The feed carries every game the publication
   * covers, and the titles are the only thing distinguishing them.
   */
  readonly isWarhammer40k: boolean;
}

/** A published list as kept on the user's machine: the list, where it came from, and when. */
export interface StoredPublishedList extends PublishedList {
  readonly source: ArticleSource;
  readonly importedAt: string;
}
