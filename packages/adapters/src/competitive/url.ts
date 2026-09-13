/**
 * The links that come in with imported lists.
 *
 * A link read out of a file, a feed or a saved page is put in front of the user as something to
 * click, so only http and https links are kept. Zod's own url check accepts any scheme a browser can
 * parse, `javascript:` included, which is why the scheme is tested here.
 */

import { z } from "zod";

export function isHttpUrl(value: unknown): boolean {
  if (typeof value !== "string" || !value.trim()) return false;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  return parsed.protocol === "http:" || parsed.protocol === "https:";
}

/** The first http(s) link of the candidates, or nothing when none of them is one. */
export const firstHttpUrl = (...candidates: (string | undefined)[]): string | undefined => candidates.find(isHttpUrl);

/** A link a record carries. */
export const HttpUrl = z.string().refine(isHttpUrl, { message: "must be an http:// or https:// link" });

/**
 * A file named in the corpus index, which the app appends to the address the corpus is fetched from.
 * A name with a path in it would point the fetch somewhere else, so a name is one plain file name.
 */
export const CorpusFileName = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*\.json$/, { message: "must be a plain .json file name" });
