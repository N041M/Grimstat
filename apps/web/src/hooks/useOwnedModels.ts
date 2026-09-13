import { useEffect, useState } from "react";
import { db } from "../db";
import { useStoreVersion } from "./useStoreVersion";

/**
 * How many models of each datasheet the player owns, by datasheet id.
 *
 * The collection is the answer to "how many of these have I got?", and that question follows the
 * player around: it is asked again while they browse the codex and again while they write a list.
 * Asking the shelf from wherever it is asked, rather than only on the collection page, is what makes
 * the two pages agree.
 *
 * A map rather than the records themselves, because every reader of this wants one number for one
 * datasheet and none of them wants to know how it is stored. Empty until the read finishes, so a
 * card renders without an owned mark for a moment rather than not at all — the mark is a note beside
 * the unit, and a page that waits for it would be waiting on something nobody asked to see.
 */
export function useOwnedModels(): ReadonlyMap<string, number> {
  const version = useStoreVersion("collection");
  const [owned, setOwned] = useState<ReadonlyMap<string, number>>(new Map());
  useEffect(() => {
    let alive = true;
    void db.collection
      .toArray()
      .then((all) => {
        if (!alive) return;
        setOwned(new Map(all.filter((e) => e.owned > 0).map((e) => [e.id, e.owned] as const)));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [version]);
  return owned;
}
