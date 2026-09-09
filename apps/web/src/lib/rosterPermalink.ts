import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from "lz-string";
import { Roster } from "@grimstat/schema";

/** Roster permalinks: `#/armies?r=<token>`; the token embeds the whole roster plus its snapshot id. */
export const ROSTER_PERMALINK_PARAM = "r";

export interface RosterPermalinkPayload {
  roster: Roster;
  snapshotId: string;
}

export function encodeRosterPermalink(payload: RosterPermalinkPayload): string {
  return compressToEncodedURIComponent(JSON.stringify({ v: 1, roster: payload.roster, snapshotId: payload.snapshotId }));
}

/** Decode a token produced by encodeRosterPermalink. Throws on malformed input. */
export function decodeRosterPermalink(token: string): RosterPermalinkPayload {
  const json = decompressFromEncodedURIComponent(token);
  if (!json) throw new Error("Permalink could not be decompressed");
  const parsed: unknown = JSON.parse(json);
  if (!parsed || typeof parsed !== "object") throw new Error("Permalink payload is not an object");
  const obj = parsed as { roster?: unknown; snapshotId?: unknown };
  const roster = Roster.parse(obj.roster);
  const snapshotId = typeof obj.snapshotId === "string" && obj.snapshotId ? obj.snapshotId : roster.snapshotId;
  return { roster, snapshotId };
}

export function rosterPermalinkUrl(payload: RosterPermalinkPayload, base = typeof location !== "undefined" ? `${location.origin}${location.pathname}` : "/"): string {
  return `${base}#/armies?${ROSTER_PERMALINK_PARAM}=${encodeRosterPermalink(payload)}`;
}

/** Extract the roster token from a hash ("#/armies?r=..." or "#r=..."); undefined if none. */
export function rosterTokenFromHash(hash: string): string | undefined {
  const h = hash.startsWith("#") ? hash.slice(1) : hash;
  const direct = new RegExp(`^${ROSTER_PERMALINK_PARAM}=(.+)$`).exec(h);
  if (direct && direct[1]) return direct[1];
  const q = h.indexOf("?");
  if (q >= 0) {
    const v = new URLSearchParams(h.slice(q + 1)).get(ROSTER_PERMALINK_PARAM);
    if (v) return v;
  }
  return undefined;
}
