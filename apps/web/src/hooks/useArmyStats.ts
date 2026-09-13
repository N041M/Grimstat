import { useEffect, useMemo, useRef, useState } from "react";
import type { Roster, ScenarioUnit, Snapshot } from "@grimstat/schema";
import { archetypes, unitFromRosterUnit } from "@grimstat/game-40k-11e";
import { simClient } from "../worker/client";
import type { TurnPlanInput, TurnPlanResult, TurnPlanStep } from "../lib/turn";
import { JOINT_THRESHOLD, SOLO_THRESHOLD, summariseSaturation, type ArmyUnitRow, type SaturationSummary } from "../lib/armyStats";

/**
 * The simulated half of Armies → Statistics.
 *
 * Three passes over the same worker, in this order, so the page paints first and fills in behind the
 * pending counts:
 *
 *  1. **The whole army against one target** — a turn plan that sends every unit at the same copy of
 *     each target archetype, all six archetypes in one call. The plan resolves the units in order
 *     and carries the damaged target from one to the next, so a unit firing late in the round sees
 *     what the ones before it left standing. Output, the points destroyed tile and the army's trade
 *     ratio read this. Summing a separate duel per unit instead let six units take 23 wounds off a
 *     10-wound squad and destroy it 2.2 times over.
 *  2. **Per unit** — two calls each, and nothing else:
 *     - `efficiency([unit], { targetIds: STAT_TARGET_IDS })` → expected damage *and* expected enemy
 *       points destroyed against all six target archetypes in one run, each against a fresh target.
 *       The details table's own damage and trade columns read this one result.
 *     - `incoming([unit])` → the four attacker archetypes fired at the unit until it is gone: the
 *       points needed to remove it (Durability), the wounds/models removed per 100 attacker points
 *       (the casualty curve's slope) and its effective wounds. Exactly the runs `durabilityIndex`
 *       used to make, reported in full instead of collapsed to the endpoint. The curve's slope and
 *       the Durability figure come from the same average, so the curve strips a unit at the points
 *       its Durability names.
 *  3. **Per target archetype** — one `reverse` search each, over the whole army as candidates. The
 *     rows it returns cover every single unit and every combination, so one search answers both
 *     "who can do this alone" and "what is the cheapest group that makes it near-certain".
 *
 * All three passes run in one cancellable effect, one call at a time with a yield between, and all
 * are cached by unit *content* rather than by roster revision — a revision key would throw the whole
 * army away on every keystroke — so leaving and re-entering the tab, or editing one unit, never
 * re-solves anything whose inputs did not change.
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

/**
 * Largest group the saturation search will try. Three is the useful answer ("two units and a
 * third to finish it"), but the search is C(n,1)+C(n,2)+C(n,3) chained runs per archetype, so a
 * large list drops to pairs rather than making the tab crawl.
 */
const MAX_COMBO_SMALL = 3;
const MAX_COMBO_LARGE = 2;
const SMALL_ARMY = 8;

/** Wounds across a unit's model profiles. */
const woundsOf = (u: ScenarioUnit) => u.models.reduce((s, m) => s + m.count * m.W, 0);

/** The target archetypes as turn-plan targets, in the order the Output section lists them. */
function statTargets(): Array<{ id: StatTargetId; unit: ScenarioUnit }> {
  return STAT_TARGET_IDS.flatMap((id) => {
    const unit = archetypes.find((a) => a.id === id)?.unit;
    return unit ? [{ id, unit }] : [];
  });
}

/** A unit with nothing but melee weapons switched on. It is measured in the fight phase after a charge. */
export function isMeleeOnly(unit: ScenarioUnit): boolean {
  const enabled = unit.weapons.filter((w) => w.enabled && w.count > 0);
  return enabled.length > 0 && enabled.every((w) => w.kind === "melee");
}

/** What the whole army takes off one target archetype in a round. */
export interface ArmyOutput {
  /** Wounds removed. Never more than the target carries. */
  damage: number;
  /** Share of the target's wounds removed, 0..1. */
  removed: number;
  /** Points of the target destroyed. Undefined when the target has no points value. */
  pointsSlain: number | undefined;
}

/** One turn plan ready for the worker: what to send and who fires at what, in order. */
export interface JointRequest {
  input: Omit<TurnPlanInput, "snapshot">;
  plan: TurnPlanStep[];
}

/**
 * The army firing at one copy of every target archetype, a unit at a time.
 *
 * A plan holds one phase for all of it, so the shooting units and the melee-only ones are asked for
 * in separate plans and `jointOutput` adds the two rounds up.
 */
export function jointRequests(units: Array<{ id: string; unit: ScenarioUnit }>): JointRequest[] {
  const targets = statTargets();
  if (targets.length === 0) return [];
  if (units.length === 0) return [];
  // One plan for the whole list. The plugin resolves each attacker in the phase it can fight in, so a
  // melee-only unit is measured after a charge without being split into a second plan, and the target
  // carries its damage from one unit to the next across the whole round rather than starting again
  // halfway through.
  return [
    {
      input: { attackers: units.map(({ id, unit }) => ({ id, unit })), targets, context: { ...CONTEXT, phase: "shooting" as const } },
      // The plan is read in order against each target, so the units line up the way the list does.
      plan: targets.flatMap((t) => units.map((m) => ({ attackerId: m.id, targetId: t.id }))),
    },
  ];
}

/**
 * Fold the plans back into one figure per target archetype.
 *
 * A target cannot lose more wounds than it carries or more points than it costs, so both totals are
 * held to what it has. Within one plan the target is carried from unit to unit and stops taking
 * damage once it is down. The limit therefore only has work to do between the shooting round and
 * the fight, and for a unit the plugin had to sample rather than resolve exactly.
 */
export function jointOutput(results: TurnPlanResult[]): Partial<Record<StatTargetId, ArmyOutput>> {
  const out: Partial<Record<StatTargetId, ArmyOutput>> = {};
  for (const { id, unit } of statTargets()) {
    const wounds = woundsOf(unit);
    let damage = 0;
    let slain = 0;
    for (const r of results) {
      const row = r.targets.find((t) => t.targetId === id);
      if (!row) continue;
      damage += row.expectedDamage;
      slain += row.expectedPointsSlain;
    }
    damage = Math.min(wounds, damage);
    out[id] = { damage, removed: wounds > 0 ? damage / wounds : 0, pointsSlain: unit.points === undefined ? undefined : Math.min(unit.points, slain) };
  }
  return out;
}

export interface UnitSolve {
  /** Expected damage in one round against each target archetype. */
  damage: Record<StatTargetId, number>;
  /** Expected *points* of the target archetype destroyed in one round. Undefined when the target has no points value. */
  pointsSlain: Partial<Record<StatTargetId, number>>;
  /** Expected points of shooting needed to remove the unit; Infinity when nothing can. */
  pointsToRemove: number;
  /** Wounds removed per 100 attacker points — the casualty curve's slope for this unit. */
  woundsPer100: number;
  /** Models removed per 100 attacker points. */
  slainPer100: number;
  /** Reference attacks expected to remove the unit (see the plugin's `REFERENCE_ATTACK`). */
  effectiveWounds: number;
  /** False when nothing is switched on: the unit has no output to report, so the screen dashes it. */
  armed: boolean;
}

/** One target archetype's saturation summary, plus how many of the army's units were candidates. */
export interface SaturationSolve extends SaturationSummary {
  considered: number;
}

export interface ArmySolveState {
  get(unitId: string): UnitSolve | undefined;
  /** What the whole army does to one target archetype; undefined until the joint run lands. */
  output(targetId: StatTargetId): ArmyOutput | undefined;
  /** The saturation summary for one target archetype; undefined until its search lands. */
  saturation(targetId: StatTargetId): SaturationSolve | undefined;
  /** Units still waiting for the worker. */
  pending: number;
  /** True while the army's joint run is still going. */
  pendingOutput: boolean;
  /** Target archetypes whose saturation search has not landed yet. */
  pendingTargets: number;
  /** Units the worker could not solve. */
  failed: number;
}

/** Give the page a frame to paint before the first solve starts. */
const START_DELAY_MS = 60;
/** The cache outlives the tab so switching back is free; capped so a long session cannot grow forever. */
const CACHE_LIMIT = 600;
const cache = new Map<string, UnitSolve | null>();
/** Army-level results, keyed by every unit signature at once (any edit anywhere invalidates them). */
const armyCache = new Map<string, SaturationSolve | null>();
/** The joint run, under the same army key. One entry covers every target archetype. */
const outputCache = new Map<string, Partial<Record<StatTargetId, ArmyOutput>> | null>();

function remember<T>(store: Map<string, T | null>, key: string, value: T | null): void {
  if (store.size >= CACHE_LIMIT) {
    const oldest = store.keys().next();
    if (!oldest.done) store.delete(oldest.value);
  }
  store.set(key, value);
}

/**
 * Cache key: everything that can change a unit's numbers — the snapshot it resolves against, the
 * faction, the detachments (enhancements and rules) and the roster entries folded into the row.
 */
function signatureOf(roster: Roster, snapshotId: string, row: ArmyUnitRow): string {
  const members = row.memberIds.map((id) => roster.units.find((u) => u.id === id));
  return JSON.stringify([snapshotId, roster.factionId, roster.detachments, members]);
}

/** Small stable hash so the army key stays short however many units the list holds. */
function hash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

export function useArmyStats(roster: Roster | undefined, snapshot: Snapshot | undefined, rows: ArmyUnitRow[], enabled: boolean): ArmySolveState {
  const [version, bump] = useState(0);
  const [pending, setPending] = useState(0);
  const [pendingOutput, setPendingOutput] = useState(false);
  const [pendingTargets, setPendingTargets] = useState(0);
  const keys = useRef(new Map<string, string>());
  const armyKeys = useRef(new Map<string, string>());
  const outputKey = useRef("");

  const signatures = useMemo(() => {
    const map = new Map<string, string>();
    if (!roster || !snapshot) return map;
    for (const row of rows) map.set(row.id, signatureOf(roster, snapshot.id, row));
    return map;
  }, [roster, snapshot, rows]);
  keys.current = signatures;

  /** Every unit signature folded into one short key, which any edit anywhere changes. */
  const armyBase = useMemo(() => (signatures.size === 0 ? "" : hash([...signatures.values()].join("|"))), [signatures]);

  /** One key per target archetype, folding in the army key and the search's own settings. */
  const armySignatures = useMemo(() => {
    const map = new Map<string, string>();
    if (armyBase === "") return map;
    const combo = signatures.size <= SMALL_ARMY ? MAX_COMBO_SMALL : MAX_COMBO_LARGE;
    for (const id of STAT_TARGET_IDS) map.set(id, `${armyBase}|${id}|${combo}|${SOLO_THRESHOLD}|${JOINT_THRESHOLD}`);
    return map;
  }, [armyBase, signatures]);
  armyKeys.current = armySignatures;
  outputKey.current = armyBase === "" ? "" : `${armyBase}|output`;

  useEffect(() => {
    if (!enabled || !roster || !snapshot || rows.length === 0) {
      setPending(0);
      setPendingOutput(false);
      setPendingTargets(0);
      return;
    }
    const todo = rows.filter((r) => !cache.has(signatures.get(r.id) ?? ""));
    const targetsTodo = STAT_TARGET_IDS.filter((id) => !armyCache.has(armySignatures.get(id) ?? ""));
    const jointKey = outputKey.current;
    const outputTodo = jointKey !== "" && !outputCache.has(jointKey);
    setPending(todo.length);
    setPendingOutput(outputTodo);
    setPendingTargets(targetsTodo.length);
    if (todo.length === 0 && targetsTodo.length === 0 && !outputTodo) return;

    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        // The two army-wide passes fire every unit that has something switched on, so they share
        // one build of the scenario units.
        let candidates: Array<{ id: string; unit: ScenarioUnit }> = [];
        if (outputTodo || targetsTodo.length > 0) {
          try {
            candidates = rows.flatMap((r) => {
              const host = roster.units.find((u) => u.id === r.id);
              if (!host) return [];
              const unit = unitFromRosterUnit(host, roster, snapshot);
              // A unit with nothing switched on has no output, so it takes part in neither.
              return unit.weapons.some((w) => w.enabled && w.count > 0) ? [{ id: r.id, unit }] : [];
            });
          } catch {
            candidates = [];
          }
        }

        // ---- pass 1: the whole army at one copy of each target archetype ----
        if (outputTodo) {
          try {
            const requests = jointRequests(candidates);
            const results: TurnPlanResult[] = [];
            let answered = true;
            for (const req of requests) {
              const res = await simClient().evaluateTurnPlan(req.input, req.plan, snapshot);
              if (cancelled) return;
              // Superseded by a newer worker request elsewhere. Leaving it uncached means it is retried.
              if (!res.outcome) {
                answered = false;
                break;
              }
              results.push(res.outcome.result);
            }
            // An army with nothing switched on has nothing to report, so every target stays empty.
            if (answered) remember(outputCache, jointKey, requests.length > 0 ? jointOutput(results) : {});
          } catch {
            if (cancelled) return;
            remember(outputCache, jointKey, null);
          }
          setPendingOutput(false);
          bump((n) => n + 1);
          await new Promise((r) => window.setTimeout(r, 0));
        }

        // ---- pass 2: one efficiency run and one incoming run per unit ----
        for (const row of todo) {
          if (cancelled) return;
          const key = signatures.get(row.id);
          const host = roster.units.find((u) => u.id === row.id);
          if (!key || !host) continue;
          try {
            const su = unitFromRosterUnit(host, roster, snapshot);
            // One efficiency run covers every target archetype, each against a fresh copy of it. The
            // details table's own damage and trade columns read it.
            const eff = await simClient().efficiency([su], { targetIds: [...STAT_TARGET_IDS], context: CONTEXT }, snapshot);
            if (cancelled) return;
            // One incoming run covers every attacker archetype: durability, curve slope, effective wounds.
            const inc = await simClient().incoming([su], { context: CONTEXT }, snapshot);
            if (cancelled) return;
            const effRow = eff.outcome?.result[0];
            const incRow = inc.outcome?.result[0];
            if (!effRow || !incRow) {
              // Superseded by a newer worker request elsewhere. Leaving it uncached means it is retried.
              setPending((n) => Math.max(0, n - 1));
              continue;
            }
            const damage = Object.fromEntries(STAT_TARGET_IDS.map((id) => [id, effRow.byTarget[TARGET_NAME[id]] ?? 0])) as Record<StatTargetId, number>;
            // A target archetype with no points value has no entry, and the cell stays empty rather
            // than reading 0.00, which would look like an attack that destroyed nothing.
            const pointsSlain = Object.fromEntries(STAT_TARGET_IDS.map((id) => [id, effRow.pointsByTarget[TARGET_NAME[id]]])) as Partial<Record<StatTargetId, number>>;
            remember(cache, key, {
              damage,
              pointsSlain,
              pointsToRemove: incRow.pointsToRemove,
              woundsPer100: incRow.woundsPer100,
              slainPer100: incRow.slainPer100,
              effectiveWounds: incRow.effectiveWounds,
              armed: su.weapons.some((w) => w.enabled && w.count > 0),
            });
          } catch {
            if (cancelled) return;
            remember(cache, key, null);
          }
          setPending((n) => Math.max(0, n - 1));
          bump((n) => n + 1);
          // Yield so typing and scrolling stay responsive between units.
          await new Promise((r) => window.setTimeout(r, 0));
        }

        // ---- pass 3: one reverse search per target archetype, over the whole army ----
        if (targetsTodo.length === 0) return;
        const nameById = new Map(rows.map((r) => [r.id, r.name] as const));
        const maxCombo = rows.length <= SMALL_ARMY ? MAX_COMBO_SMALL : MAX_COMBO_LARGE;

        for (const id of targetsTodo) {
          if (cancelled) return;
          const key = armySignatures.get(id);
          const target = archetypes.find((a) => a.id === id)?.unit;
          if (!key) continue;
          if (!target || candidates.length === 0) {
            remember(armyCache, key, { soloNames: [], needed: undefined, cheapestNames: [], cheapestPoints: undefined, cheapestPKill: undefined, considered: candidates.length });
            setPendingTargets((n) => Math.max(0, n - 1));
            bump((n) => n + 1);
            continue;
          }
          try {
            const res = await simClient().reverse({ target, candidates, metric: "pKill", threshold: JOINT_THRESHOLD, maxCombo, context: CONTEXT }, snapshot);
            if (cancelled) return;
            const result = res.outcome?.result;
            if (!result) {
              setPendingTargets((n) => Math.max(0, n - 1));
              continue;
            }
            // Re-label with the names the units table shows, then apply both thresholds locally.
            // A group holding a unit with no points value has no cost to compare, so it goes in at
            // Infinity and lands behind every priced group instead of reading as the cheapest.
            const summary = summariseSaturation(result.rows.map((r) => ({ ...r, points: r.priced ? r.points : Number.POSITIVE_INFINITY, names: r.candidateIds.map((c) => nameById.get(c) ?? c) })));
            remember(armyCache, key, { ...summary, considered: candidates.length });
          } catch {
            if (cancelled) return;
            remember(armyCache, key, null);
          }
          setPendingTargets((n) => Math.max(0, n - 1));
          bump((n) => n + 1);
          await new Promise((r) => window.setTimeout(r, 0));
        }
      })();
    }, START_DELAY_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [enabled, roster, snapshot, rows, signatures, armyBase, armySignatures]);

  // Identity only changes when a result lands, so the table's sort memo can depend on it.
  return useMemo(() => {
    const failed = [...signatures.values()].filter((k) => cache.get(k) === null).length;
    return {
      get: (unitId: string) => {
        const key = keys.current.get(unitId);
        return key ? (cache.get(key) ?? undefined) : undefined;
      },
      output: (targetId: StatTargetId) => {
        const key = outputKey.current;
        return key ? outputCache.get(key)?.[targetId] : undefined;
      },
      saturation: (targetId: StatTargetId) => {
        const key = armyKeys.current.get(targetId);
        return key ? (armyCache.get(key) ?? undefined) : undefined;
      },
      pending,
      pendingOutput,
      pendingTargets,
      failed,
    };
    // `version` is the "a result landed" ticker; the cache itself is not reactive.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, pending, pendingOutput, pendingTargets, signatures]);
}
