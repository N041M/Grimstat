/**
 * How many requests one network address may make, per kind of request, per minute.
 *
 * `auth` is sign-in starts and finishes, where every request can cost an email. `links` is making
 * short links, which costs storage. `api` is everything else. On Cloudflare the counting is done by
 * the platform's rate-limit bindings, one per bucket, declared in the web app's wrangler.jsonc with
 * the same numbers as below. On Node it is a sliding window in memory.
 *
 * A device syncs every five minutes and after a change, and a first sync of a large account takes
 * a few requests in a row, so sixty a minute leaves room. What bounds a script is the account's
 * daily allowance of writes, in sync.ts.
 */
export type RateBucket = "auth" | "api" | "links";

export const RATE_LIMITS: Readonly<Record<RateBucket, { limit: number; periodSec: number }>> = {
  auth: { limit: 5, periodSec: 60 },
  api: { limit: 60, periodSec: 60 },
  links: { limit: 20, periodSec: 60 },
};

export interface RateLimiter {
  /** Whether one more request from `key` is within the bucket's allowance. Counts the request. */
  allow(bucket: RateBucket, key: string): Promise<boolean>;
}

/** The shape of a Cloudflare rate-limit binding. */
export interface RateLimitBinding {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export function bindingLimiter(bindings: Record<RateBucket, RateLimitBinding | undefined>): RateLimiter {
  return {
    async allow(bucket, key) {
      const b = bindings[bucket];
      if (!b) return true;
      return (await b.limit({ key })).success;
    },
  };
}

/** Sliding windows in memory, for Node and for tests. */
export function memoryLimiter(now: () => number = Date.now): RateLimiter {
  const seen = new Map<string, number[]>();
  return {
    async allow(bucket, key) {
      const { limit, periodSec } = RATE_LIMITS[bucket];
      const t = now();
      const id = `${bucket}|${key}`;
      const times = (seen.get(id) ?? []).filter((x) => x > t - periodSec * 1000);
      if (times.length >= limit) {
        seen.set(id, times);
        return false;
      }
      times.push(t);
      seen.set(id, times);
      return true;
    },
  };
}

/** Allows everything. For tests that are not about limits. */
export const noLimiter: RateLimiter = { allow: async () => true };
