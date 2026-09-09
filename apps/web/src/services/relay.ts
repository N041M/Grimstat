/**
 * Permalink relay seam. A future backend can turn long `#s=` links into short ones.
 * The local implementation never touches the network and simply reports "unavailable".
 */
export interface RelayService {
  readonly available: boolean;
  /** Returns a short URL for `longUrl`, or null when no relay is configured. */
  shorten(longUrl: string): Promise<string | null>;
  /** Resolves a short id back to the long URL, or null. */
  resolve(shortId: string): Promise<string | null>;
}

export const localRelay: RelayService = {
  available: false,
  shorten: async () => null,
  resolve: async () => null,
};

let current: RelayService = localRelay;
export function relay(): RelayService {
  return current;
}
export function setRelayService(s: RelayService): void {
  current = s;
}
