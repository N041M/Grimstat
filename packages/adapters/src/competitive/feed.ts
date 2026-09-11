/**
 * The write-up feed.
 *
 * A publication's RSS feed is an interface published for machines, and it answers a plainly identified
 * client, unlike the article pages behind their bot challenge. This module reads only the feed, which
 * offers titles, links and dates. The lists themselves live in the articles, which the user opens and
 * supplies.
 */

import { XMLParser } from "fast-xml-parser";
import type { FeedEntry } from "./types";

/** Titles are tagged with their game; 40k write-ups are the ones naming the edition. */
const IS_40K = /\b(?:40k|in 11th|in 10th)\b/i;

/**
 * Entries of an RSS feed, newest first.
 *
 * Tolerant of the shapes feeds arrive in — a `<link>` that is an element or an attribute, a title in
 * CDATA or entity-escaped, a `<guid>` standing in for a missing link — because a feed that changes
 * shape should cost a warning rather than the whole import.
 */
export function parseFeed(xml: string): FeedEntry[] {
  const channel = channelOf(xml);
  if (!channel) return [];

  const raw = channel["item"] ?? channel["entry"];
  const items = Array.isArray(raw) ? raw : raw ? [raw] : [];

  const out: FeedEntry[] = [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const it = item as Record<string, unknown>;
    const title = text(it["title"]);
    const url = text(it["link"]) || attr(it["link"], "@href") || text(it["guid"]);
    if (!title || !url) continue;
    const published = text(it["pubDate"]) || text(it["published"]) || text(it["updated"]);
    out.push({ title, url, ...(published ? { published } : {}), isWarhammer40k: IS_40K.test(title) });
  }
  return out;
}

/**
 * The feed's own title and link, meaning the publication and the page its write-ups are listed on.
 * A checklist built from the feed is headed with these.
 */
export function feedSource(xml: string): { title?: string; url?: string } {
  const channel = channelOf(xml);
  if (!channel) return {};
  const title = text(channel["title"]);
  const url = text(channel["link"]) || attr(channel["link"], "@href");
  return { ...(title ? { title } : {}), ...(url ? { url } : {}) };
}

/** The RSS channel or Atom feed element, or nothing when the text is not a feed at all. */
function channelOf(xml: string): Record<string, unknown> | undefined {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@", trimValues: true, processEntities: true });
  let doc: unknown;
  try {
    doc = parser.parse(xml);
  } catch {
    return undefined;
  }
  if (!doc || typeof doc !== "object") return undefined;
  const d = doc as Record<string, unknown>;
  const channel = (d["rss"] as Record<string, unknown> | undefined)?.["channel"] ?? d["feed"];
  return channel && typeof channel === "object" ? (channel as Record<string, unknown>) : undefined;
}

function text(v: unknown): string {
  if (typeof v === "string") return v.trim();
  if (typeof v === "number") return String(v);
  if (v && typeof v === "object") {
    const inner = (v as Record<string, unknown>)["#text"];
    if (typeof inner === "string") return inner.trim();
  }
  return "";
}

function attr(v: unknown, name: string): string {
  if (Array.isArray(v)) {
    for (const entry of v) {
      const got = attr(entry, name);
      if (got) return got;
    }
    return "";
  }
  if (v && typeof v === "object") {
    const got = (v as Record<string, unknown>)[name];
    if (typeof got === "string") return got.trim();
  }
  return "";
}
