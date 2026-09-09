import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from "lz-string";
import { Scenario } from "@grimstat/schema";

export const PERMALINK_PARAM = "s";

export interface PermalinkPayload {
  scenario: Scenario;
  snapshotId?: string;
}

/** Encode `{scenario, snapshotId}` into the URL-fragment token used after `#s=`. */
export function encodePermalink(payload: PermalinkPayload): string {
  const body: { v: number; scenario: Scenario; snapshotId?: string } = { v: 1, scenario: payload.scenario };
  if (payload.snapshotId) body.snapshotId = payload.snapshotId;
  return compressToEncodedURIComponent(JSON.stringify(body));
}

/** Decode a token produced by encodePermalink. Throws on malformed input. */
export function decodePermalink(token: string): PermalinkPayload {
  const json = decompressFromEncodedURIComponent(token);
  if (!json) throw new Error("Permalink could not be decompressed");
  const parsed: unknown = JSON.parse(json);
  if (!parsed || typeof parsed !== "object") throw new Error("Permalink payload is not an object");
  const obj = parsed as { scenario?: unknown; snapshotId?: unknown };
  const scenario = Scenario.parse(obj.scenario);
  const snapshotId = typeof obj.snapshotId === "string" ? obj.snapshotId : scenario.snapshotId;
  return snapshotId ? { scenario, snapshotId } : { scenario };
}

/** Full shareable URL for the current origin. */
export function permalinkUrl(payload: PermalinkPayload, base = typeof location !== "undefined" ? `${location.origin}${location.pathname}` : "/"): string {
  return `${base}#${PERMALINK_PARAM}=${encodePermalink(payload)}`;
}

/** Extract the token from a location hash ("#s=..." or "#/x?s=..."); undefined if none. */
export function permalinkTokenFromHash(hash: string): string | undefined {
  const h = hash.startsWith("#") ? hash.slice(1) : hash;
  const direct = new RegExp(`^${PERMALINK_PARAM}=(.+)$`).exec(h);
  if (direct && direct[1]) return direct[1];
  const q = h.indexOf("?");
  if (q >= 0) {
    const params = new URLSearchParams(h.slice(q + 1));
    const v = params.get(PERMALINK_PARAM);
    if (v) return v;
  }
  return undefined;
}
