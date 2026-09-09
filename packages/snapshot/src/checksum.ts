/**
 * Canonical JSON: object keys sorted recursively, `undefined` members dropped, arrays kept in order.
 * Two structurally equal values always serialise to the same string regardless of key insertion order.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

export function sortKeys<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => sortKeys(v)) as unknown as T;
  if (value && typeof value === "object" && !(value instanceof Date)) {
    const src = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(src).sort()) {
      const v = src[key];
      if (v === undefined) continue;
      out[key] = sortKeys(v);
    }
    return out as T;
  }
  return value;
}

function toHex(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s;
}

/** SHA-256 hex digest of a UTF-8 string. Uses WebCrypto when available (browsers, Node >= 19), else node:crypto. */
export async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const subtle = (globalThis as { crypto?: { subtle?: SubtleCrypto } }).crypto?.subtle;
  if (subtle) {
    const digest = await subtle.digest("SHA-256", bytes);
    return toHex(new Uint8Array(digest));
  }
  const specifier = "node:crypto";
  const mod = (await import(/* @vite-ignore */ specifier)) as { createHash(alg: string): { update(data: Uint8Array): { digest(enc: "hex"): string } } };
  return mod.createHash("sha256").update(bytes).digest("hex");
}

/** Checksum of a value's canonical JSON. */
export function checksumOf(value: unknown): Promise<string> {
  return sha256Hex(canonicalJson(value));
}
