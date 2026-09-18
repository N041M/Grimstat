/** Random tokens and their hashes, on the Web Crypto both Node and Workers have. */

const HEX = "0123456789abcdef";

export function randomToken(bytes = 32): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  let out = "";
  for (const b of buf) out += HEX[b >> 4]! + HEX[b & 15]!;
  return out;
}

/** An id short enough to type: eight characters from a set with no look-alikes. */
export function shortId(): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  const buf = new Uint8Array(8);
  crypto.getRandomValues(buf);
  let out = "";
  for (const b of buf) out += alphabet[b % alphabet.length];
  return out;
}

export async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  let out = "";
  for (const b of new Uint8Array(digest)) out += HEX[b >> 4]! + HEX[b & 15]!;
  return out;
}

/** An address hashed with a secret, so the server can count requests from it without keeping it. */
export async function hashIp(ip: string, salt: string): Promise<string> {
  return (await sha256(`${salt}|${ip}`)).slice(0, 32);
}
