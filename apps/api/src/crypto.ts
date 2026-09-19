/** Random tokens and their hashes, on the Web Crypto both Node and Workers have. */

const HEX = "0123456789abcdef";

export function randomToken(bytes = 32): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  let out = "";
  for (const b of buf) out += HEX[b >> 4]! + HEX[b & 15]!;
  return out;
}

/** Letters and digits with no look-alikes: no 0, o, 1, l or i. */
const TYPABLE = "abcdefghjkmnpqrstuvwxyz23456789";

/** An id short enough to type: eight characters from a set with no look-alikes. */
export function shortId(): string {
  const buf = new Uint8Array(8);
  crypto.getRandomValues(buf);
  let out = "";
  for (const b of buf) out += TYPABLE[b % TYPABLE.length];
  return out;
}

/**
 * A sign-in code: eight typable characters, drawn evenly. Typed on a phone it is what signs the
 * home-screen app in, where the link in the email would open the browser instead. Eight characters
 * from thirty-one is close to forty bits, and a code lives fifteen minutes behind the rate limit
 * on sign-in requests.
 */
export function signInCode(): string {
  let out = "";
  const buf = new Uint8Array(16);
  while (out.length < 8) {
    crypto.getRandomValues(buf);
    // Values past the last whole multiple of the alphabet are thrown away rather than folded.
    for (const b of buf) if (out.length < 8 && b < 248) out += TYPABLE[b % TYPABLE.length];
  }
  return out;
}

/** A code as typed or as carried by the link, in the form it was stored: lower case, letters and digits only. */
export const normaliseCode = (raw: string): string => raw.toLowerCase().replace(/[^a-z0-9]/g, "");

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
