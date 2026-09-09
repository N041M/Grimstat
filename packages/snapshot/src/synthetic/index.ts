import { Snapshot } from "@grimstat/schema";
import raw from "./snapshot.json";

/**
 * The synthetic fixture snapshot (invented factions, units and numbers; no Games Workshop content).
 * Imported statically so it ships inside the browser bundle. Validated on every load.
 */
export function loadSyntheticSnapshot(): Snapshot {
  return Snapshot.parse(raw);
}
