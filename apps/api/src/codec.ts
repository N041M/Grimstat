/**
 * Record bodies at rest. A body is JSON on the wire and gzip of that JSON in the database, which
 * is about a fifth of the size for a roster. Both hosts have CompressionStream, so the same code
 * runs on Cloudflare and on Node.
 *
 * A row written before compression holds its JSON in `body`. Such rows are read as they are and
 * compressed by the nightly purge, so every reader goes through `bodyText`.
 */

export async function gzipText(text: string): Promise<Uint8Array> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function gunzipText(bytes: Uint8Array): Promise<string> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).text();
}

/** A BLOB as the host hands it back: a Uint8Array on Node, an ArrayBuffer or an array of numbers on D1. */
export function asBytes(v: unknown): Uint8Array | undefined {
  if (v == null) return undefined;
  if (v instanceof Uint8Array) return v;
  if (v instanceof ArrayBuffer) return new Uint8Array(v);
  if (Array.isArray(v)) return Uint8Array.from(v as number[]);
  return undefined;
}

export const byteLength = (text: string | null | undefined): number => (text ? new TextEncoder().encode(text).length : 0);

/** The two columns a body may sit in. */
export interface StoredBody {
  body: string | null;
  body_gz: unknown;
}

/** The JSON text of a stored body, whichever column holds it. Nothing for a tombstone. */
export async function bodyText(row: StoredBody): Promise<string | undefined> {
  const gz = asBytes(row.body_gz);
  if (gz) return gunzipText(gz);
  return row.body ?? undefined;
}

/** How many bytes the row takes in the database, which is what the account's size counts. */
export function storedLength(row: StoredBody): number {
  return asBytes(row.body_gz)?.length ?? byteLength(row.body);
}
