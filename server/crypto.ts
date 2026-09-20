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

/**
 * Characters drawn evenly from the typable alphabet. A byte runs to 255 and the alphabet holds 31,
 * so the last eight values are thrown away and another byte drawn; folding them in would make the
 * first eight characters a ninth more likely than the rest.
 */
function typable(length: number): string {
  let out = "";
  const buf = new Uint8Array(Math.max(16, length * 2));
  while (out.length < length) {
    crypto.getRandomValues(buf);
    for (const b of buf) if (out.length < length && b < 248) out += TYPABLE[b % TYPABLE.length];
  }
  return out;
}

/** An id short enough to type: eight characters from a set with no look-alikes. */
export const shortId = (): string => typable(8);

/**
 * A sign-in code: eight typable characters, close to forty bits, valid fifteen minutes behind the
 * rate limit on sign-in requests. It signs in the home-screen app, which the emailed link cannot
 * reach because it opens the browser instead.
 */
export const signInCode = (): string => typable(8);

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

/**
 * An email address hashed with the same secret. The sign-in rows outlive the account so the hourly
 * limit cannot be reset by deleting one, and they count the hash, so the address itself can be
 * cleared the moment the account goes.
 */
export async function hashEmail(email: string, salt: string): Promise<string> {
  return (await sha256(`${salt}|email|${email}`)).slice(0, 32);
}
