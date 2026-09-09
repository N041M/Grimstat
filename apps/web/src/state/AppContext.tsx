import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Scenario, Snapshot } from "@grimstat/schema";
import { db, getSetting, listSnapshotMeta, setSetting, SETTING_ACTIVE_SNAPSHOT, type SnapshotMeta } from "../db";
import { newScenario } from "../lib/scenario";
import { t } from "../i18n";

export type NoticeKind = "info" | "success" | "error";
export interface Notice {
  kind: NoticeKind;
  text: string;
  details?: string[];
}

export interface AppContextValue {
  ready: boolean;
  snapshot: Snapshot | undefined;
  snapshotList: SnapshotMeta[];
  activeSnapshotId: string | undefined;
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

const Ctx = createContext<AppContextValue | undefined>(undefined);

export function AppProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [snapshot, setSnapshot] = useState<Snapshot | undefined>(undefined);
  const [snapshotList, setSnapshotList] = useState<SnapshotMeta[]>([]);
  const [activeSnapshotId, setActiveId] = useState<string | undefined>(undefined);
  const [scenario, setScenario] = useState<Scenario>(() => newScenario());
  const [scenarioLoadKey, setLoadKey] = useState(0);
  const [notice, setNotice] = useState<Notice | undefined>(undefined);
  const noticeTimer = useRef<number | undefined>(undefined);

  const notify = useCallback((text: string, kind: NoticeKind = "info", details?: string[]) => {
    setNotice(details ? { kind, text, details } : { kind, text });
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    if (kind !== "error") noticeTimer.current = window.setTimeout(() => setNotice(undefined), 6000);
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

  useEffect(() => {
    let alive = true;
    refreshSnapshots()
      .catch((e: unknown) => notify(t("data.dbError", { msg: e instanceof Error ? e.message : String(e) }), "error"))
      .finally(() => {
        if (alive) setReady(true);
      });
    return () => {
      alive = false;
    };
  }, [refreshSnapshots, notify]);

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
    () => ({ ready, snapshot, snapshotList, activeSnapshotId, scenario, scenarioLoadKey, notice, updateScenario, replaceScenario, setActiveSnapshot, refreshSnapshots, notify, dismissNotice }),
    [ready, snapshot, snapshotList, activeSnapshotId, scenario, scenarioLoadKey, notice, updateScenario, replaceScenario, setActiveSnapshot, refreshSnapshots, notify, dismissNotice],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useApp must be used inside AppProvider");
  return v;
}
