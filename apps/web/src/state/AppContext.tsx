import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Scenario, Snapshot } from "@grimstat/schema";
import { db, getSetting, listOverrides, listSnapshotMeta, setSetting, SETTING_ACTIVE_SNAPSHOT, type OverrideRecord, type SnapshotMeta } from "../db";
import { newScenario } from "../lib/scenario";
import { effectiveSnapshot } from "../lib/overrides";
import { t } from "../i18n";

export type NoticeKind = "info" | "success" | "error";
export interface Notice {
  kind: NoticeKind;
  text: string;
  details?: string[];
}

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
  notice: Notice | undefined;
  updateScenario(fn: (s: Scenario) => Scenario): void;
  replaceScenario(s: Scenario, snapshotId?: string): Promise<void>;
  setActiveSnapshot(id: string | undefined): Promise<void>;
  refreshSnapshots(): Promise<void>;
  notify(text: string, kind?: NoticeKind, details?: string[]): void;
  dismissNotice(): void;
}

export const NOTICE_AUTO_DISMISS_MS = 4000;

const Ctx = createContext<AppContextValue | undefined>(undefined);

export function AppProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [rawSnapshot, setSnapshot] = useState<Snapshot | undefined>(undefined);
  const [overrides, setOverrides] = useState<OverrideRecord[]>([]);
  const [snapshotList, setSnapshotList] = useState<SnapshotMeta[]>([]);
  const [activeSnapshotId, setActiveId] = useState<string | undefined>(undefined);
  const [scenario, setScenario] = useState<Scenario>(() => newScenario());
  const [scenarioLoadKey, setLoadKey] = useState(0);
  const [notice, setNotice] = useState<Notice | undefined>(undefined);
  const noticeTimer = useRef<number | undefined>(undefined);

  const notify = useCallback((text: string, kind: NoticeKind = "info", details?: string[]) => {
    setNotice(details ? { kind, text, details } : { kind, text });
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    // Info/success notices dismiss themselves; errors stay until closed.
    if (kind !== "error") noticeTimer.current = window.setTimeout(() => setNotice(undefined), NOTICE_AUTO_DISMISS_MS);
  }, []);
  const dismissNotice = useCallback(() => setNotice(undefined), []);

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
    () => ({ ready, snapshot, rawSnapshot, snapshotList, activeSnapshotId, overrides, overrideStatus, withOverrides, refreshOverrides, scenario, scenarioLoadKey, notice, updateScenario, replaceScenario, setActiveSnapshot, refreshSnapshots, notify, dismissNotice }),
    [ready, snapshot, rawSnapshot, snapshotList, activeSnapshotId, overrides, overrideStatus, withOverrides, refreshOverrides, scenario, scenarioLoadKey, notice, updateScenario, replaceScenario, setActiveSnapshot, refreshSnapshots, notify, dismissNotice],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useApp must be used inside AppProvider");
  return v;
}
