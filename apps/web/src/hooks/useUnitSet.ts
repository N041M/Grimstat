import { useCallback, useEffect, useMemo, useRef, useState, type SetStateAction } from "react";
import type { Scenario, Snapshot } from "@grimstat/schema";
import { db, getSetting, setSetting } from "../db";
import { useApp } from "../state/AppContext";
import { isStoredEntry, resolveStored, toStored, type StoredUnitEntry, type UnitEntry, type UnitSetDescriptor } from "../lib/unitSet";
import { pendingWrite } from "./usePersistedSetting";
import { t } from "../i18n";

/**
 * Every hook on the same key mirrors the same set, so editing the Matrix's attackers also updates
 * the copy the context column renders. Instances broadcast by reference and ignore their own echo.
 */
type SetListener = (entries: UnitEntry[], from: number) => void;
const mirrors = new Map<string, Set<SetListener>>();
let nextInstanceId = 1;

function broadcast(key: string, entries: UnitEntry[], from: number): void {
  for (const l of mirrors.get(key) ?? []) l(entries, from);
}

/** What resolving persisted sources needs from the app state. */
export interface UnitSetEnv {
  snapshot: Snapshot | undefined;
  scenario: Scenario;
  withOverrides: (s: Snapshot) => Snapshot;
}

/** The persisted sources under `key`; malformed entries are dropped. */
export async function readStoredSet(key: string): Promise<StoredUnitEntry[]> {
  const raw = await getSetting<unknown>(key);
  return Array.isArray(raw) ? raw.filter(isStoredEntry) : [];
}

/** Rebuild entries from persisted sources against the current rosters, snapshots and calculator scenario. */
export async function resolveSet(stored: StoredUnitEntry[], { withOverrides, ...rest }: UnitSetEnv): Promise<UnitEntry[]> {
  const env = {
    ...rest,
    getRoster: (id: string) => db.rosters.get(id),
    getSnapshot: async (id: string) => {
      const s = await db.snapshots.get(id);
      return s ? withOverrides(s) : undefined;
    },
    getPreset: (id: string) => db.unitPresets.get(id),
  };
  const labels = { archetype: t("analyses.picker.originArchetype"), calculator: t("analyses.picker.originCalculator"), preset: t("analyses.picker.originPreset") };
  const resolved = await Promise.all(stored.map((s) => resolveStored(s, env, labels)));
  return resolved.filter((e): e is UnitEntry => !!e);
}

/** Read and resolve the set stored under `key` (what `useUnitSet` does on mount). */
export async function loadUnitSet(key: string, env: UnitSetEnv): Promise<UnitEntry[]> {
  return resolveSet(await readStoredSet(key), env);
}

/** "Matrix · Attackers (3)" */
export function unitSetLabel(d: UnitSetDescriptor, n: number): string {
  return t("analyses.picker.setLabel", { tab: t(d.tab), role: t(d.role), n });
}

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
  const { snapshot, scenario, withOverrides } = useApp();
  const [entries, setEntriesState] = useState<UnitEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const writer = useMemo(() => pendingWrite<UnitEntry[]>((k, v) => setSetting(k, toStored(v))), []);
  const instance = useRef(0);
  if (!instance.current) instance.current = nextInstanceId++;
  const envRef = useRef<UnitSetEnv>({ snapshot, scenario, withOverrides });
  envRef.current = { snapshot, scenario, withOverrides };

  useEffect(() => {
    let alive = true;
    setLoaded(false);
    setEntriesState([]);
    void (async () => {
      try {
        const resolved = await loadUnitSet(key, envRef.current);
        if (!alive) return;
        setEntriesState(resolved);
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
    const mine = instance.current;
    // Adopting never re-broadcasts (only `setEntries` does), so mirrors cannot ping-pong.
    const listener: SetListener = (next, from) => {
      if (from === mine) return;
      setEntriesState(next);
    };
    const set = mirrors.get(key) ?? new Set<SetListener>();
    set.add(listener);
    mirrors.set(key, set);
    return () => {
      set.delete(listener);
      if (!set.size) mirrors.delete(key);
    };
  }, [key]);

  // No cleanup here: the next change restarts the wait by itself, and a set still waiting has to
  // survive an unmount for the effect below to write it. Each Analyses tab is a component of its
  // own, so switching tab unmounts the set that was just edited.
  useEffect(() => {
    if (!loaded) {
      writer.cancel();
      return;
    }
    writer.schedule(key, entries);
  }, [entries, loaded, key, writer]);

  // Save on unmount / page hide so a quick navigation never loses the last edit.
  useEffect(() => {
    const onHide = () => void writer.flush();
    window.addEventListener("pagehide", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      void writer.flush();
    };
  }, [writer]);

  const setEntries = useCallback(
    (next: SetStateAction<UnitEntry[]>) =>
      setEntriesState((cur) => {
        const value = typeof next === "function" ? next(cur) : next;
        // After the commit, so a mirror never re-renders another component mid-render.
        queueMicrotask(() => broadcast(key, value, instance.current));
        return value;
      }),
    [key],
  );
  return { entries, setEntries, loaded };
}
