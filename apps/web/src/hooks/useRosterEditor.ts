import { useCallback, useEffect, useRef, useState } from "react";
import type { Roster, Snapshot } from "@grimstat/schema";
import { db, saveRosterWithVersion } from "../db";
import { touchRoster } from "../lib/roster";
import { useApp } from "../state/AppContext";

export type SaveStatus = "loading" | "missing" | "saved" | "dirty" | "saving" | "error";

export const AUTOSAVE_MS = 300;

export interface RosterEditorState {
  roster: Roster | undefined;
  status: SaveStatus;
  /** ISO time of the last successful save. */
  savedAt: string | undefined;
  /** Apply a change; autosaves (debounced), bumps `revision` and `updatedAt`, records a version. */
  update(fn: (r: Roster) => Roster): void;
  /** Replace the roster wholesale (restore from history); saved like any other edit. */
  replace(r: Roster): void;
  /** Force a pending save now. */
  flush(): Promise<void>;
}

/**
 * Loads a roster by id and owns its edit/autosave cycle. Edits are applied to a ref so rapid
 * successive updates compose in order; the 300 ms debounce collapses them into one revision.
 */
export function useRosterEditor(id: string): RosterEditorState {
  const [roster, setRosterState] = useState<Roster | undefined>(undefined);
  const [status, setStatus] = useState<SaveStatus>("loading");
  const [savedAt, setSavedAt] = useState<string | undefined>(undefined);
  const rosterRef = useRef<Roster | undefined>(undefined);
  const dirtyRef = useRef(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    rosterRef.current = undefined;
    dirtyRef.current = false;
    setRosterState(undefined);
    setStatus("loading");
    void db.rosters.get(id).then((r) => {
      if (!alive) return;
      rosterRef.current = r;
      setRosterState(r);
      setSavedAt(r?.updatedAt);
      setStatus(r ? "saved" : "missing");
    });
    return () => {
      alive = false;
    };
  }, [id]);

  const flush = useCallback(async () => {
    window.clearTimeout(timer.current);
    const cur = rosterRef.current;
    if (!cur || !dirtyRef.current) return;
    dirtyRef.current = false;
    const saved = touchRoster(cur);
    rosterRef.current = saved;
    setRosterState(saved);
    setStatus("saving");
    try {
      await saveRosterWithVersion(saved);
      setSavedAt(saved.updatedAt);
      if (!dirtyRef.current) setStatus("saved");
    } catch {
      dirtyRef.current = true;
      setStatus("error");
    }
  }, []);

  const schedule = useCallback(() => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void flush(), AUTOSAVE_MS);
  }, [flush]);

  const update = useCallback(
    (fn: (r: Roster) => Roster) => {
      const cur = rosterRef.current;
      if (!cur) return;
      const next = fn(cur);
      if (next === cur) return;
      rosterRef.current = next;
      dirtyRef.current = true;
      setRosterState(next);
      setStatus("dirty");
      schedule();
    },
    [schedule],
  );

  const replace = useCallback(
    (r: Roster) => {
      const cur = rosterRef.current;
      if (!cur) return;
      update(() => ({ ...r, id: cur.id, createdAt: cur.createdAt, revision: cur.revision, updatedAt: cur.updatedAt }));
    },
    [update],
  );

  // Save on unmount / page hide so a quick navigation never loses the last edit.
  useEffect(() => {
    const onHide = () => void flush();
    window.addEventListener("pagehide", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      void flush();
    };
  }, [flush]);

  return { roster, status, savedAt, update, replace, flush };
}

/**
 * The snapshot a roster was built against: the active one when ids match, otherwise loaded from
 * the local database; falls back to the active snapshot (with `fallback: true`) when it is gone.
 */
export function useRosterSnapshot(roster: Roster | undefined): { snapshot: Snapshot | undefined; fallback: boolean; loading: boolean } {
  const { snapshot: active, activeSnapshotId, withOverrides } = useApp();
  const wanted = roster?.snapshotId;
  const [state, setState] = useState<{ id: string; snapshot: Snapshot | undefined } | undefined>(undefined);

  useEffect(() => {
    if (!wanted || wanted === activeSnapshotId) return;
    let alive = true;
    void db.snapshots.get(wanted).then((s) => {
      if (alive) setState({ id: wanted, snapshot: s ? withOverrides(s) : undefined });
    });
    return () => {
      alive = false;
    };
  }, [wanted, activeSnapshotId, withOverrides]);

  if (!wanted) return { snapshot: active, fallback: false, loading: false };
  if (wanted === activeSnapshotId) return { snapshot: active, fallback: false, loading: false };
  if (!state || state.id !== wanted) return { snapshot: undefined, fallback: false, loading: true };
  if (state.snapshot) return { snapshot: state.snapshot, fallback: false, loading: false };
  return { snapshot: active, fallback: !!active, loading: false };
}
