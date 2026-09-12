import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Scenario, Snapshot } from "@grimstat/schema";
import { db, getSetting, listOverrides, listSnapshotMeta, setSetting, SETTING_ACTIVE_SNAPSHOT, type OverrideRecord, type SnapshotMeta } from "../db";
import { newScenario } from "../lib/scenario";
import { effectiveSnapshot } from "../lib/overrides";
import { t } from "../i18n";

export type NoticeKind = "info" | "success" | "error";
/** One follow-up the user can take from a notice, e.g. undo a removal. */
export interface NoticeAction {
  label: string;
  run(): void;
}
export interface Notice {
  id: number;
  kind: NoticeKind;
  text: string;
  details?: string[];
  action?: NoticeAction;
}

/** Whether the result on screen matches the current inputs. Drives the dot on the brand mark. */
export type SolveState = "current" | "pending";

export interface AppContextValue {
  ready: boolean;
  /** The active snapshot with every stored override applied — what the calculator, armies and analyses read. */
  snapshot: Snapshot | undefined;
  /** The active snapshot exactly as stored (Data page, ability text in the override editor). */
  rawSnapshot: Snapshot | undefined;
  snapshotList: SnapshotMeta[];
  activeSnapshotId: string | undefined;
  /** Every stored override, oldest first. */
  overrides: OverrideRecord[];
  /** How many overrides hit / missed an entity in the active snapshot. */
  overrideStatus: { applied: number; missing: number };
  /** Apply the current overrides to any stored snapshot (rosters built against another snapshot). Memoised per input. */
  withOverrides(s: Snapshot): Snapshot;
  refreshOverrides(): Promise<void>;
  scenario: Scenario;
  /** Increments whenever a whole scenario is loaded (permalink, storage) so pickers re-sync. */
  scenarioLoadKey: number;
  /** Open notices, oldest first. Several may be on screen at once. */
  notices: Notice[];
  updateScenario(fn: (s: Scenario) => Scenario): void;
  replaceScenario(s: Scenario, snapshotId?: string): Promise<void>;
  setActiveSnapshot(id: string | undefined): Promise<void>;
  refreshSnapshots(): Promise<void>;
  /** Show a notice; returns its id. Errors and notices with details stay until closed. */
  notify(text: string, kind?: NoticeKind, details?: string[], action?: NoticeAction): number;
  /** Close one notice by id, or every notice when no id is given. */
  dismissNotice(id?: number): void;
  /** Solve state reported by whichever screen is running the worker (see `useReportSolveState`). */
  solveState: SolveState;
  setSolveState(s: SolveState): void;
  /** Command palette: any screen may open it (brand mark, ⌘K, the Scenarios filter field). */
  paletteOpen: boolean;
  openPalette(): void;
  closePalette(): void;
}

export const NOTICE_AUTO_DISMISS_MS = 4000;
/** A notice that offers an action (undo) stays long enough to use it. */
export const NOTICE_ACTION_DISMISS_MS = 9000;
/** Older notices drop off the stack beyond this many. */
export const NOTICE_STACK_MAX = 4;

const Ctx = createContext<AppContextValue | undefined>(undefined);

export function AppProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [rawSnapshot, setSnapshot] = useState<Snapshot | undefined>(undefined);
  const [overrides, setOverrides] = useState<OverrideRecord[]>([]);
  const [snapshotList, setSnapshotList] = useState<SnapshotMeta[]>([]);
  const [activeSnapshotId, setActiveId] = useState<string | undefined>(undefined);
  const [scenario, setScenario] = useState<Scenario>(() => newScenario());
  const [scenarioLoadKey, setLoadKey] = useState(0);
  const [notices, setNotices] = useState<Notice[]>([]);
  const noticeSeq = useRef(0);
  const noticeTimers = useRef(new Map<number, number>());
  const [solveState, setSolveStateRaw] = useState<SolveState>("current");
  const [paletteOpen, setPaletteOpen] = useState(false);

  const setSolveState = useCallback((s: SolveState) => setSolveStateRaw((prev) => (prev === s ? prev : s)), []);
  const openPalette = useCallback(() => setPaletteOpen(true), []);
  const closePalette = useCallback(() => setPaletteOpen(false), []);

  const dismissNotice = useCallback((id?: number) => {
    const timers = noticeTimers.current;
    if (id === undefined) {
      timers.forEach((tm) => window.clearTimeout(tm));
      timers.clear();
      setNotices([]);
      return;
    }
    const tm = timers.get(id);
    if (tm !== undefined) {
      window.clearTimeout(tm);
      timers.delete(id);
    }
    setNotices((list) => list.filter((n) => n.id !== id));
  }, []);
  const notify = useCallback(
    (text: string, kind: NoticeKind = "info", details?: string[], action?: NoticeAction) => {
      const id = ++noticeSeq.current;
      const n: Notice = { id, kind, text, ...(details ? { details } : {}), ...(action ? { action } : {}) };
      setNotices((list) => [...list, n].slice(-NOTICE_STACK_MAX));
      // Errors and notices that carry details stay until closed. A notice with an action stays
      // long enough to use it; plain info and success notices go by themselves.
      const ttl = kind === "error" || details?.length ? undefined : action ? NOTICE_ACTION_DISMISS_MS : NOTICE_AUTO_DISMISS_MS;
      if (ttl !== undefined) noticeTimers.current.set(id, window.setTimeout(() => dismissNotice(id), ttl));
      return id;
    },
    [dismissNotice],
  );

  const loadActive = useCallback(async (id: string | undefined) => {
    if (!id) {
      setSnapshot(undefined);
      setActiveId(undefined);
      return;
    }
    const s = await db.snapshots.get(id);
    setSnapshot(s);
    setActiveId(s ? id : undefined);
  }, []);

  const refreshSnapshots = useCallback(async () => {
    const list = await listSnapshotMeta();
    setSnapshotList(list);
    const stored = await getSetting<string>(SETTING_ACTIVE_SNAPSHOT);
    const stillThere = stored && list.some((m) => m.id === stored) ? stored : list[0]?.id;
    if (stillThere !== stored) await setSetting(SETTING_ACTIVE_SNAPSHOT, stillThere ?? null);
    await loadActive(stillThere);
  }, [loadActive]);

  const setActiveSnapshot = useCallback(
    async (id: string | undefined) => {
      await setSetting(SETTING_ACTIVE_SNAPSHOT, id ?? null);
      await loadActive(id);
    },
    [loadActive],
  );

  const refreshOverrides = useCallback(async () => {
    setOverrides(await listOverrides());
  }, []);

  useEffect(() => {
    let alive = true;
    Promise.all([refreshSnapshots(), refreshOverrides()])
      .catch((e: unknown) => notify(t("data.dbError", { msg: e instanceof Error ? e.message : String(e) }), "error"))
      .finally(() => {
        if (alive) setReady(true);
      });
    return () => {
      alive = false;
    };
  }, [refreshSnapshots, refreshOverrides, notify]);

  // Effective snapshot: recomputed only when the stored snapshot or the override set changes.
  const effective = useMemo(() => (rawSnapshot ? effectiveSnapshot(rawSnapshot, overrides) : undefined), [rawSnapshot, overrides]);
  const snapshot = effective?.snapshot;
  const overrideStatus = useMemo(() => ({ applied: effective?.applied ?? 0, missing: effective?.missing ?? 0 }), [effective]);

  // Other snapshots (rosters built against a non-active one) get the same treatment, memoised by object identity.
  const otherCache = useRef(new WeakMap<Snapshot, Snapshot>());
  useEffect(() => {
    otherCache.current = new WeakMap();
  }, [overrides]);
  const withOverrides = useCallback(
    (s: Snapshot): Snapshot => {
      if (rawSnapshot && s.id === rawSnapshot.id && s.checksum === rawSnapshot.checksum && snapshot) return snapshot;
      const hit = otherCache.current.get(s);
      if (hit) return hit;
      const out = effectiveSnapshot(s, overrides).snapshot;
      otherCache.current.set(s, out);
      return out;
    },
    [rawSnapshot, snapshot, overrides],
  );

  const updateScenario = useCallback((fn: (s: Scenario) => Scenario) => setScenario((s) => fn(s)), []);

  const replaceScenario = useCallback(
    async (s: Scenario, snapshotId?: string) => {
      const wanted = snapshotId ?? s.snapshotId;
      if (wanted) {
        const exists = await db.snapshots.get(wanted);
        if (exists) {
          await setActiveSnapshot(wanted);
        } else {
          const inline = s.attacker.models.length > 0 && s.defender.models.length > 0;
          notify(inline ? t("scenario.snapshotMissingInline", { id: wanted }) : t("scenario.snapshotMissing", { id: wanted }), inline ? "info" : "error");
        }
      }
      setScenario(s);
      setLoadKey((k) => k + 1);
    },
    [setActiveSnapshot, notify],
  );

  const value = useMemo<AppContextValue>(
    () => ({ ready, snapshot, rawSnapshot, snapshotList, activeSnapshotId, overrides, overrideStatus, withOverrides, refreshOverrides, scenario, scenarioLoadKey, notices, updateScenario, replaceScenario, setActiveSnapshot, refreshSnapshots, notify, dismissNotice, solveState, setSolveState, paletteOpen, openPalette, closePalette }),
    [ready, snapshot, rawSnapshot, snapshotList, activeSnapshotId, overrides, overrideStatus, withOverrides, refreshOverrides, scenario, scenarioLoadKey, notices, updateScenario, replaceScenario, setActiveSnapshot, refreshSnapshots, notify, dismissNotice, solveState, setSolveState, paletteOpen, openPalette, closePalette],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useApp must be used inside AppProvider");
  return v;
}

/**
 * Publish a screen's solve state to the shell (the dot on the brand mark). Call it from
 * whichever screen owns the worker run, e.g. `useReportSolveState(sim.running)`.
 * The state resets to "current" when that screen unmounts.
 */
export function useReportSolveState(pending: boolean): void {
  const { setSolveState } = useApp();
  useEffect(() => {
    setSolveState(pending ? "pending" : "current");
  }, [pending, setSolveState]);
  useEffect(
    () => () => setSolveState("current"),
    [setSolveState],
  );
}
