import type { Roster } from "@grimstat/schema";
import { db, saveRosterWithVersion } from "../db";
import { cloneRoster } from "./roster";

/**
 * Store armies read from a file the app saved earlier.
 *
 * An army whose id is already stored is saved as a copy, named by `copyName`, so an import never
 * overwrites the army it came from. The ids are read from the database rather than from any list
 * on screen, and every army written here joins the set, so a file that carries the same id twice
 * cannot overwrite its own first army either. `present` counts the copies made.
 */
export async function storeImportedArmies(rosters: readonly Roster[], copyName: (name: string) => string): Promise<{ saved: Roster[]; present: number }> {
  const existing = new Set(await db.rosters.toCollection().primaryKeys());
  let present = 0;
  const saved: Roster[] = [];
  for (const r of rosters) {
    const clash = existing.has(r.id);
    const rec = clash ? cloneRoster(r, copyName(r.name)) : r;
    if (clash) present++;
    await saveRosterWithVersion(rec);
    existing.add(rec.id);
    saved.push(rec);
  }
  return { saved, present };
}
