import { useEffect, useMemo, useRef, useState } from "react";
import type { Roster, Snapshot } from "@grimstat/schema";
import { archetypes, unitFromRosterUnit } from "@grimstat/game-40k-11e";
import { simClient } from "../worker/client";
import type { ArmyUnitRow } from "../lib/armyStats";

/**
 * The simulated half of Armies → Statistics.
 *
 * Every number the Output, Durability and details sections show comes from **two worker calls per
 * unit** and nothing else:
 *   - `efficiency([unit], { targetIds: STAT_TARGET_IDS })` → expected damage against all six target
 *     archetypes in one run, which the Output totals and the details table's damage column share;
 *   - `durabilityIndex([unit])` → the points of shooting needed to remove it, shared by the
 *     Durability section and the details table's last column.
 *
 * The units are walked one at a time with a yield between them, so the page paints first and the
 * rows fill in behind it. Results are cached by unit *content* rather than by roster revision —
 * a revision key would throw the whole army away on every keystroke — so leaving and re-entering
 * the tab, or editing one unit, never re-solves a unit whose inputs did not change.
 */

/** The six target archetypes the army is measured against, in the order the Output section lists them. */
export const STAT_TARGET_IDS = ["guardsman-like", "horde-like", "marine-like", "terminator-like", "light-vehicle", "heavy-tank"] as const;
export type StatTargetId = (typeof STAT_TARGET_IDS)[number];

/** `efficiency` keys `byTarget` by the archetype unit's name, so map back to the stable ids. */
const TARGET_NAME = Object.fromEntries(STAT_TARGET_IDS.map((id) => [id, archetypes.find((a) => a.id === id)?.unit.name ?? id])) as Record<StatTargetId, string>;

/** Full archetype label (generic profile numbers), shown as the `title` behind the short name. */
export const TARGET_DETAIL = Object.fromEntries(STAT_TARGET_IDS.map((id) => [id, archetypes.find((a) => a.id === id)?.name ?? id])) as Record<StatTargetId, string>;

/** What the army is assumed to be doing: one round, half range, no cover. */
const CONTEXT = { rangeBand: "half", inCover: false } as const;

export interface UnitSolve {
  /** Expected damage in one round against each target archetype. */
  damage: Record<StatTargetId, number>;
  /** Expected points of shooting needed to remove the unit; Infinity when nothing can. */
  pointsToRemove: number;
}

export interface ArmySolveState {
  get(unitId: string): UnitSolve | undefined;
  /** Units still waiting for the worker. */
  pending: number;
  /** Units the worker could not solve. */
  failed: number;
}

/** Give the page a frame to paint before the first solve starts. */
const START_DELAY_MS = 60;
/** The cache outlives the tab so switching back is free; capped so a long session cannot grow forever. */
const CACHE_LIMIT = 600;
const cache = new Map<string, UnitSolve | null>();

function remember(key: string, value: UnitSolve | null): void {
  if (cache.size >= CACHE_LIMIT) {
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  cache.set(key, value);
}

/**
 * Cache key: everything that can change a unit's numbers — the snapshot it resolves against, the
 * faction, the detachments (enhancements and rules) and the roster entries folded into the row.
 */
function signatureOf(roster: Roster, snapshotId: string, row: ArmyUnitRow): string {
  const members = row.memberIds.map((id) => roster.units.find((u) => u.id === id));
  return JSON.stringify([snapshotId, roster.factionId, roster.detachments, members]);
}

export function useArmyStats(roster: Roster | undefined, snapshot: Snapshot | undefined, rows: ArmyUnitRow[], enabled: boolean): ArmySolveState {
  const [version, bump] = useState(0);
  const [pending, setPending] = useState(0);
  const keys = useRef(new Map<string, string>());

  const signatures = useMemo(() => {
    const map = new Map<string, string>();
    if (!roster || !snapshot) return map;
    for (const row of rows) map.set(row.id, signatureOf(roster, snapshot.id, row));
    return map;
  }, [roster, snapshot, rows]);
  keys.current = signatures;

  useEffect(() => {
    if (!enabled || !roster || !snapshot || rows.length === 0) {
      setPending(0);
      return;
    }
    const todo = rows.filter((r) => !cache.has(signatures.get(r.id) ?? ""));
    setPending(todo.length);
    if (todo.length === 0) return;

    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        for (const row of todo) {
          if (cancelled) return;
          const key = signatures.get(row.id);
          const host = roster.units.find((u) => u.id === row.id);
          if (!key || !host) continue;
          try {
            const su = unitFromRosterUnit(host, roster, snapshot);
            // One efficiency run covers every target archetype; all three sections read from it.
            const eff = await simClient().efficiency([su], { targetIds: [...STAT_TARGET_IDS], context: CONTEXT }, snapshot);
            if (cancelled) return;
            const dur = await simClient().durabilityIndex([su], { context: CONTEXT }, snapshot);
            if (cancelled) return;
            const effRow = eff.outcome?.result[0];
            const durRow = dur.outcome?.result[0];
            if (!effRow || !durRow) {
              // Superseded by a newer worker request elsewhere; leave it uncached so it is retried.
              setPending((n) => Math.max(0, n - 1));
              continue;
            }
            const damage = Object.fromEntries(STAT_TARGET_IDS.map((id) => [id, effRow.byTarget[TARGET_NAME[id]] ?? 0])) as Record<StatTargetId, number>;
            remember(key, { damage, pointsToRemove: durRow.pointsToRemove });
          } catch {
            if (cancelled) return;
            remember(key, null);
          }
          setPending((n) => Math.max(0, n - 1));
          bump((n) => n + 1);
          // Yield so typing and scrolling stay responsive between units.
          await new Promise((r) => window.setTimeout(r, 0));
        }
      })();
    }, START_DELAY_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [enabled, roster, snapshot, rows, signatures]);

  // Identity only changes when a result lands, so the table's sort memo can depend on it.
  return useMemo(() => {
    const failed = [...signatures.values()].filter((k) => cache.get(k) === null).length;
    return {
      get: (unitId: string) => {
        const key = keys.current.get(unitId);
        return key ? (cache.get(key) ?? undefined) : undefined;
      },
      pending,
      failed,
    };
    // `version` is the "a result landed" ticker; the cache itself is not reactive.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, pending, signatures]);
}
