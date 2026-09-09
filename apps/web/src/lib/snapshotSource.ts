import type { Snapshot } from "@grimstat/schema";
import { loadSyntheticSnapshot } from "@grimstat/snapshot";
import { loadFallbackSyntheticSnapshot } from "./sampleSnapshot";

/**
 * Sample data source for the Data page.
 * Prefers `@grimstat/snapshot`'s synthetic fixture; while that package's `synthetic/snapshot.json` is still empty
 * (it fails `Snapshot.parse`), the local stand-in in ./sampleSnapshot.ts is used instead.
 * TODO(snapshot-pkg): once the fixture is populated, drop the fallback and this try/catch.
 */
export function loadSampleSnapshot(): Snapshot {
  try {
    return loadSyntheticSnapshot();
  } catch {
    return loadFallbackSyntheticSnapshot();
  }
}
