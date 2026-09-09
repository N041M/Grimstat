import { useCallback, useEffect, useRef, useState, type SetStateAction } from "react";
import { db, getSetting, setSetting } from "../db";
import { useApp } from "../state/AppContext";
import { isStoredEntry, resolveStored, toStored, type UnitEntry } from "../lib/unitSet";
import { t } from "../i18n";

const WRITE_DEBOUNCE_MS = 250;

export interface UnitSetState {
  entries: UnitEntry[];
  setEntries: (next: SetStateAction<UnitEntry[]>) => void;
  /** False until the persisted selection has been read and resolved. */
  loaded: boolean;
}

/**
 * A unit set (attackers, defenders, targets…) whose sources persist in Dexie `settings` under `key`.
 * On mount the stored sources are resolved against the current rosters / snapshots / calculator
 * scenario; entries whose source vanished are dropped silently.
 */
export function useUnitSet(key: string): UnitSetState {
  const { snapshot, scenario } = useApp();
  const [entries, setEntriesState] = useState<UnitEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const envRef = useRef({ snapshot, scenario });
  envRef.current = { snapshot, scenario };

  useEffect(() => {
    let alive = true;
    setLoaded(false);
    setEntriesState([]);
    void (async () => {
      try {
        const raw = await getSetting<unknown>(key);
        const stored = Array.isArray(raw) ? raw.filter(isStoredEntry) : [];
        const env = {
          ...envRef.current,
          getRoster: (id: string) => db.rosters.get(id),
          getSnapshot: (id: string) => db.snapshots.get(id),
        };
        const labels = { archetype: t("analyses.picker.originArchetype"), calculator: t("analyses.picker.originCalculator") };
        const resolved = await Promise.all(stored.map((s) => resolveStored(s, env, labels)));
        if (!alive) return;
        setEntriesState(resolved.filter((e): e is UnitEntry => !!e));
      } catch {
        // storage unavailable: start empty
      } finally {
        if (alive) setLoaded(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [key]);

  useEffect(() => {
    if (!loaded) return;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void setSetting(key, toStored(entries)).catch(() => undefined), WRITE_DEBOUNCE_MS);
    return () => window.clearTimeout(timer.current);
  }, [entries, loaded, key]);

  const setEntries = useCallback((next: SetStateAction<UnitEntry[]>) => setEntriesState(next), []);
  return { entries, setEntries, loaded };
}
