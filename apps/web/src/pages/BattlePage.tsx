import { Suspense, lazy, useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { ModelHull, ReachNode, TerrainLayout, Vec2, Vec3 } from "@grimstat/board";
import { reachable } from "@grimstat/board";
import { PageHeader } from "../components/shell";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { TerrainPanel } from "../components/battle/TerrainPanel";
import { LayoutLibrary } from "../components/battle/LayoutLibrary";
import { LayoutPicker } from "../components/battle/LayoutPicker";
import { useApp } from "../state/AppContext";
import { useStoreVersion } from "../hooks/useStoreVersion";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { usePersistedSetting } from "../hooks/usePersistedSetting";
import { db } from "../db";
import { EDIT_STEP, copyLayout, isBuiltIn, moveObjective, movePiece, placePiece, placePieceSnapped, removeObjective, removePiece, rotatePiece, snapPoint } from "../lib/layoutEdit";
import { BUILT_IN, listLayouts, saveLayout, type StoredLayout } from "../lib/layoutStore";
import { canRedo, canUndo, canUndoUnits, editorReducer, initialEditor } from "../lib/battleEditor";
import { Badge, Tabs, useConfirm } from "../components/ui";
import { UnitArt } from "../components/UnitArt";
import { silhouetteFor, type SilhouetteId } from "../lib/silhouettes";
import {
  anchorOf,
  applyGroupMove,
  applyModelMove,
  applyUnitMove,
  autoDeploy,
  battleWith,
  chargeBetween,
  clearDeployment,
  deployUnit,
  deployVerdict,
  dragVerdict,
  enemyHulls,
  endMove,
  findModel,
  findUnit,
  freshDeployment,
  hasMoved,
  incoherentModels,
  indexOf,
  modelMoveVerdict,
  modelReach,
  moveOf,
  otherHulls,
  groupMoveVerdict,
  type GroupMember,
  type GroupMove,
  remainingMove,
  replaceUnit,
  resetMove,
  rotateVerdict,
  sampleBattle,
  sampleForce,
  dropMark,
  sightBetween,
  tapeDistance,
  translateUnit,
  unitCoherency,
  unitHulls,
  unitsFromRoster,
  unitsOf,
  withForce,
  withdrawUnit,
  type BattleModel,
  type BattleState,
  type BattleTool,
  type BattleUnit,
  type ChargeReadout,
  type SightReadout,
  type Side,
  type Tape,
} from "../lib/battle";
import type { CameraMode, DragState, TerrainEditing } from "../components/battle/BattleCanvas";
import { t, type I18nKey } from "../i18n";
import { newId } from "../lib/ids";

/** three.js and the whole scene live behind this boundary: nobody who never opens Battle downloads it. */
const BattleCanvas = lazy(() => import("../components/battle/BattleCanvas").then((m) => ({ default: m.BattleCanvas })));

/**
 * WebGL can be missing (old hardware, a blocked context, a headless browser). Ask before drawing.
 *
 * The probe context is released immediately: a browser allows only a handful of live contexts, and
 * one leaked per page load is enough to eventually starve the table of the one it needs.
 */
function webglAvailable(): boolean {
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    if (!gl) return false;
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return true;
  } catch {
    return false;
  }
}

const TOOLS: { id: BattleTool; label: I18nKey }[] = [
  { id: "deploy", label: "battle.tool.deploy" },
  { id: "select", label: "battle.tool.select" },
  { id: "measure", label: "battle.tool.measure" },
  { id: "sight", label: "battle.tool.sight" },
  { id: "terrain", label: "battle.tool.terrain" },
];

/** Arrow keys as board directions: +y is the far edge, which is up on the screen in both views. */
const ARROWS: Record<string, Vec2> = { ArrowUp: { x: 0, y: 1 }, ArrowDown: { x: 0, y: -1 }, ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 } };

/** A move worked out but not yet made: the ghost stands here until the player approves it. */
interface Plan {
  readonly unitId: string;
  readonly modelId?: string;
  readonly at: Vec3;
  readonly cost: number;
  readonly path?: readonly Vec3[];
  /** Every member's move, when the plan is a group's; `unitId`, `modelId` and `at` are then the lead's. */
  readonly moves?: readonly GroupMove[];
}

/** A turn of the selection per press: fifteen degrees. */
const ROTATE_STEP = Math.PI / 12;

/** The two sides, in the order the panels list them. */
const SIDES = ["attacker", "defender"] as const;

/** What the army select calls the sample force. Every other option is a stored army's id. */
const SAMPLE_FORCE = "sample";
const parseForceId = (raw: unknown): string | undefined => (typeof raw === "string" && raw ? raw : undefined);

/** A refusal the table reported, shown over the table until the next thing happens. */
interface Refusal {
  readonly text: string;
  /** Bumped on every refusal, so the same message twice restarts the timer. */
  readonly n: number;
}

/** How long a refusal stays over the table. */
const REFUSAL_MS = 4000;

/** Keys typed into a field belong to the field. */
const inField = (target: EventTarget | null): boolean => {
  const el = target as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
};

/**
 * The battle table: plan a matchup on a real-sized board in three dimensions.
 *
 * Planning mode — drag units, measure, check what can see what, see what a charge needs. Nothing is
 * resolved and nothing is enforced: the table explains what it thinks and lets the player decide.
 */
export function BattlePage() {
  const { notify, snapshot, activeSnapshotId, withOverrides } = useApp();
  const { confirm, dialog } = useConfirm();
  /** A finger has no Shift, no ⌘ and no arrow keys, so the table offers those as buttons instead. */
  const coarse = useMediaQuery("(pointer: coarse)");
  const [editor, dispatch] = useReducer(editorReducer, undefined, () => initialEditor(sampleBattle()));
  const state = editor.battle;
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [activeModelId, setActiveModelId] = useState<string | undefined>();
  const [targetId, setTargetId] = useState<string | undefined>();
  const [tool, setTool] = useState<BattleTool>("select");
  const [view, setView] = useState<CameraMode>("orbit");
  const [drag, setDrag] = useState<DragState | undefined>();
  /** Whether `drag` is a live gesture (the readout follows the pointer) or a refused click. */
  const [dragging, setDragging] = useState(false);
  /** The move being planned for the selection, shown as a ghost until approved. */
  const [plan, setPlan] = useState<Plan | undefined>();
  /** Models selected together, by id: Shift-clicked one by one or boxed on the table. */
  const [groupIds, setGroupIds] = useState<ReadonlySet<string>>(() => new Set());
  /**
   * The tapes on the table and the mark of one being laid. One state, because a mark either starts
   * a tape or finishes one, and the two halves have to change together — and never inside another
   * update's function, which StrictMode runs twice.
   */
  const [measuring, setMeasuring] = useState<{ pending?: Vec3; tapes: Tape[] }>({ tapes: [] });
  const { pending: pendingMark, tapes } = measuring;
  const setPendingMark = useCallback((pending: Vec3 | undefined) => setMeasuring((m) => ({ ...m, pending })), []);
  const setTapes = useCallback((tapes: Tape[]) => setMeasuring((m) => ({ ...m, tapes })), []);
  /** The tape's free end while one mark is set, from the canvas. */
  const [aim, setAim] = useState<Vec2 | undefined>();
  const [terrainId, setTerrainId] = useState<string | undefined>();
  const [objectiveId, setObjectiveId] = useState<string | undefined>();
  const [snapOn, setSnapOn] = useState(true);
  /** Box mode and add mode, the toolbar's standing stand-ins for holding Shift and ⌘. */
  const [boxSelect, setBoxSelect] = useState(false);
  const [addSelect, setAddSelect] = useState(false);
  /** What the table last refused, reported over the table rather than in the app's notice slot. */
  const [refusal, setRefusal] = useState<Refusal | undefined>();
  const [library, setLibrary] = useState<StoredLayout[]>(() => [...BUILT_IN]);
  const labelsRef = useRef<HTMLDivElement>(null);
  const tapesRef = useRef<HTMLDivElement>(null);
  const readoutRef = useRef<HTMLDivElement>(null);
  const marqueeRef = useRef<HTMLDivElement>(null);
  const [webgl] = useState(webglAvailable);
  const layoutsVersion = useStoreVersion("terrainLayouts");
  const rostersVersion = useStoreVersion("rosters");
  /** The armies the force select offers. Names only; the roster itself is read when one is picked. */
  const [armies, setArmies] = useState<{ id: string; name: string }[]>([]);
  const [attackerForce, setAttackerForce, attackerForceLoaded] = usePersistedSetting("battle.force.attacker", SAMPLE_FORCE, parseForceId);
  const [defenderForce, setDefenderForce, defenderForceLoaded] = usePersistedSetting("battle.force.defender", SAMPLE_FORCE, parseForceId);
  const forceOf = (side: Side) => (side === "attacker" ? attackerForce : defenderForce);

  const { layout, units } = state;
  const index = useMemo(() => indexOf(state), [state]);
  const editable = !isBuiltIn(layout.id);
  const selected = findUnit(state, selectedId);
  const activeModel = selected && findModel(selected, activeModelId);
  const target = findUnit(state, targetId);
  /** The models selected together, in table order, skipping any that have left the table. */
  const group: GroupMember[] = useMemo(() => state.units.flatMap((u) => (u.reserve ? [] : u.models.filter((m) => groupIds.has(m.id)).map((m) => ({ unitId: u.id, modelId: m.id })))), [state, groupIds]);
  const grouped = group.length >= 2;
  const incoherent = useMemo(() => new Set(selected ? incoherentModels(selected) : []), [selected]);

  /**
   * The picker's options.
   *
   * Editing a shipped layout forks it, and the fork is not in the library until it is saved — so
   * without this the picker would show some other layout's name while you were standing on the one
   * you just made.
   */
  const options = useMemo(() => (library.some((l) => l.layout.id === layout.id) ? library : [...library, { layout, builtIn: false }]), [library, layout]);
  const stored = useMemo(() => library.find((l) => l.layout.id === layout.id), [library, layout.id]);
  /** Does the table differ from what the library holds under this id? A shipped layout is never dirty: touching it forks it. */
  const dirty = useMemo(() => editable && (!stored || JSON.stringify(stored.layout) !== JSON.stringify(layout)), [editable, stored, layout]);

  // Changing tool or unit invalidates whatever the previous tool was showing — including a refusal,
  // which is about one attempted destination and reads as a live warning once it outlives it.
  useEffect(() => {
    setPendingMark(undefined);
    setDrag(undefined);
    setDragging(false);
    setPlan(undefined);
    setRefusal(undefined);
  }, [tool, selectedId, activeModelId, setPendingMark]);
  useEffect(() => setTargetId(undefined), [selectedId]);
  // Box and add mode belong to the Move tool. Neither means anything under the others, and a toggle
  // left on under a tool that ignores it is a trap on the way back.
  useEffect(() => {
    if (tool === "select") return;
    setBoxSelect(false);
    setAddSelect(false);
  }, [tool]);

  // A refusal is about one attempt. It says its piece and goes, rather than sitting there until
  // something else happens to clear it.
  useEffect(() => {
    if (!refusal) return;
    const timer = window.setTimeout(() => setRefusal(undefined), REFUSAL_MS);
    return () => window.clearTimeout(timer);
  }, [refusal]);
  const refuse = useCallback((text: string) => setRefusal((r) => ({ text, n: (r?.n ?? 0) + 1 })), []);
  const refreshLibrary = useCallback(async () => setLibrary(await listLayouts()), []);
  useEffect(() => {
    void refreshLibrary();
  }, [refreshLibrary, layoutsVersion]);

  const editLayout = useCallback((change: (layout: TerrainLayout) => TerrainLayout, record = true) => dispatch({ type: "layout", change, record }), []);
  /**
   * Change one unit. `record` puts the positions as they stand on the unit history, for the things a
   * player would expect to be able to take back: a deployment, a withdrawal, an approved move. A turn
   * of the ring is not one of them, since one drag of it is hundreds of these.
   */
  const editUnit = useCallback((unitId: string, change: (u: BattleUnit) => BattleUnit, record = false) => {
    dispatch({
      type: "units",
      record,
      change: (b) => {
        const unit = findUnit(b, unitId);
        return unit ? replaceUnit(b, change(unit)) : b;
      },
    });
  }, []);
  /** Take back the last recorded unit action. Whatever was being planned was planned against the new positions. */
  const undoUnits = useCallback(() => {
    dispatch({ type: "undoUnits" });
    setPlan(undefined);
    setDrag(undefined);
    setDragging(false);
  }, []);

  /**
   * Put another layout on the table. The forces stay as they are and are set down again in the new
   * table's zones, so changing the table does not throw away the armies chosen for it. Tapes and the
   * terrain history belonged to the old table and go with it.
   */
  const loadBattle = useCallback(
    (next: TerrainLayout) => {
      dispatch({ type: "replace", battle: freshDeployment(battleWith(next, units)) });
      setSelectedId(undefined);
      setActiveModelId(undefined);
      setTerrainId(undefined);
      setObjectiveId(undefined);
      setTapes([]);
      setPendingMark(undefined);
    },
    [units, setTapes, setPendingMark],
  );

  /** Run something that would discard unsaved terrain edits, after asking. */
  const guard = useCallback(
    async (run: () => void) => {
      if (dirty && !(await confirm({ title: t("battle.library.discard", { name: layout.name }), confirmLabel: t("battle.library.discardConfirm"), danger: true }))) return;
      run();
    },
    [dirty, layout.name, confirm],
  );

  /**
   * Set every unit down again in its own zone. The layout and its history are not touched, and
   * anything measured or planned against the old positions goes, since it was about them.
   */
  const resetDeployment = useCallback(async () => {
    if (!(await confirm({ title: t("battle.reset.title"), body: t("battle.reset.body"), confirmLabel: t("battle.reset"), danger: true }))) return;
    setPlan(undefined);
    setDrag(undefined);
    setDragging(false);
    setTapes([]);
    setPendingMark(undefined);
    setRefusal(undefined);
    dispatch({ type: "units", change: freshDeployment, record: true });
  }, [confirm, setTapes, setPendingMark]);

  /**
   * Put a force on one side: the sample one, or a stored army.
   *
   * The army is read against the snapshot it was built with, falling back to the active one when
   * that snapshot is gone, which is what the army editor does. The other side is left alone and the
   * new units arrive in reserve, to be deployed.
   */
  const applyForce = useCallback(
    async (side: Side, id: string, quiet = false) => {
      // A force put back from the settings on the way in is not something the player just did, so it
      // does not go on the undo stack; a force they picked does.
      const record = !quiet;
      if (id === SAMPLE_FORCE) {
        dispatch({ type: "units", change: (b) => withForce(b, side, sampleForce(side)), record });
        return;
      }
      const roster = await db.rosters.get(id);
      if (!roster) {
        notify(t("battle.force.missing"), "error");
        return;
      }
      const own = roster.snapshotId === activeSnapshotId ? undefined : await db.snapshots.get(roster.snapshotId);
      const snap = own ? withOverrides(own) : snapshot;
      if (!snap) {
        notify(t("battle.force.noSnapshot"), "error");
        return;
      }
      const force = unitsFromRoster(roster, snap, side);
      if (!force.length) {
        notify(t("battle.force.empty", { name: roster.name }), "error");
        return;
      }
      dispatch({ type: "units", change: (b) => withForce(b, side, force), record });
      if (!quiet) notify(t("battle.force.loaded", { name: roster.name, n: force.length }), "success");
    },
    [notify, snapshot, activeSnapshotId, withOverrides],
  );

  const chooseForce = useCallback(
    (side: Side, id: string) => {
      (side === "attacker" ? setAttackerForce : setDefenderForce)(id);
      setSelectedId(undefined);
      setActiveModelId(undefined);
      setGroupIds(new Set());
      void applyForce(side, id);
    },
    [applyForce, setAttackerForce, setDefenderForce],
  );

  useEffect(() => {
    let alive = true;
    void db.rosters
      .toArray()
      .then((all) => {
        if (!alive) return;
        setArmies(all.map((r) => ({ id: r.id, name: r.name })).sort((a, b) => a.name.localeCompare(b.name)));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [rostersVersion]);

  // The army each side was last given, put back on the table once the setting and the data are in.
  const restoredForces = useRef(false);
  useEffect(() => {
    if (restoredForces.current || !attackerForceLoaded || !defenderForceLoaded) return;
    const wanted = [attackerForce, defenderForce].filter((id) => id !== SAMPLE_FORCE);
    if (wanted.length && !snapshot) return;
    restoredForces.current = true;
    for (const side of SIDES) {
      const id = side === "attacker" ? attackerForce : defenderForce;
      if (id !== SAMPLE_FORCE) void applyForce(side, id, true);
    }
  }, [attackerForceLoaded, defenderForceLoaded, attackerForce, defenderForce, snapshot, applyForce]);

  const storeLayout = useCallback(
    (next: TerrainLayout, asNew = false) => {
      const record = asNew ? copyLayout(next, next.name) : next;
      void saveLayout(record)
        .then(async () => {
          await refreshLibrary();
          // The saved record is now the table, so the next save goes to it rather than to another copy.
          dispatch({ type: "adopt", layout: record });
          notify(t("battle.library.saved", { name: record.name }), "success");
        })
        .catch((e: unknown) => notify(t("battle.library.saveFailed"), "error", [e instanceof Error ? e.message : String(e)]));
    },
    [notify, refreshLibrary],
  );

  /**
   * Where the selection can go: one model's own reach when a model is active, otherwise the whole
   * unit's, measured from the model that leads it. Recomputed when something moves, not while the
   * pointer moves.
   */
  const reach: readonly ReachNode[] = useMemo(() => {
    if (!selected || selected.reserve || tool !== "select") return [];
    if (activeModel) return modelReach(state, selected, activeModel, index);
    return reachable(anchorOf(selected), selected.move, index, {
      keywords: selected.keywords,
      enemies: enemyHulls(state, selected.side),
      blockers: otherHulls(state, selected.id),
      board: state.layout.size,
    }).nodes;
  }, [selected, activeModel, tool, index, state]);

  const upperFloor = useMemo(() => reach.filter((n) => n.at.z > 0.5).length, [reach]);
  /** The movement the reach was searched with: the region is drawn out to exactly that. */
  const reachBudget = selected ? (activeModel ? remainingMove(selected, activeModel) : selected.move) : 0;

  const shot: SightReadout | undefined = useMemo(() => (selected && target && tool === "sight" ? sightBetween(selected, target, index) : undefined), [selected, target, tool, index]);
  const charge: ChargeReadout | undefined = useMemo(() => (selected && target && tool === "sight" ? chargeBetween(selected, target, state, index) : undefined), [selected, target, tool, state, index]);

  /** Make a move. The unit travels along the route the search found and pays for it. */
  const applyMove = useCallback(
    (unitId: string, to: Vec3, cost: number, modelId?: string, path?: readonly Vec3[]) => editUnit(unitId, (unit) => (modelId ? applyModelMove(unit, modelId, to, cost, path) : applyUnitMove(unit, to, cost, path)), true),
    [editUnit],
  );
  /**
   * Plan a move: the ghost goes where the unit would, and nothing else changes. Planning is what a
   * player does with a tape and a finger before committing; the unit itself moves on approval.
   */
  const proposeMove = useCallback((unitId: string, to: Vec3, cost: number, modelId?: string, path?: readonly Vec3[]) => setPlan({ unitId, modelId, at: to, cost, path }), []);
  /** Plan a group's move; the model in hand leads, and the cost shown is the dearest member's. */
  const proposeGroupMove = useCallback(
    (moves: readonly GroupMove[]) => {
      const lead = moves.find((m) => m.modelId === activeModelId) ?? moves[0];
      if (!lead) return;
      setPlan({ unitId: lead.unitId, modelId: lead.modelId, at: lead.at, cost: Math.max(...moves.map((m) => m.cost)), path: lead.path, moves });
    },
    [activeModelId],
  );
  const approvePlan = useCallback(() => {
    if (!plan) return;
    const moves = plan.moves;
    if (moves) dispatch({ type: "units", change: (b) => applyGroupMove(b, moves), record: true });
    else applyMove(plan.unitId, plan.at, plan.cost, plan.modelId, plan.path);
    setPlan(undefined);
  }, [plan, applyMove]);
  const onDeploy = useCallback((unitId: string, at: Vec2) => editUnit(unitId, (unit) => deployUnit(unit, at), true), [editUnit]);
  const onWithdraw = useCallback((unitId: string) => editUnit(unitId, withdrawUnit, true), [editUnit]);

  /**
   * Turn the active model, or the whole unit, in place. A turn the table refuses is reported over the
   * table, where the turn was asked for, rather than in the app's notice slot: it is about this one
   * attempt and stops being true the moment the model moves.
   */
  const rotateSelection = useCallback(
    (by: number, quiet = false) => {
      if (grouped) {
        // Every unit with a member turns its members; one refusal stops the lot, so the group stays consistent.
        const byUnit = new Map<string, Set<string>>();
        for (const m of group) (byUnit.get(m.unitId) ?? byUnit.set(m.unitId, new Set()).get(m.unitId)!).add(m.modelId);
        const turned = new Map<string, BattleUnit>();
        for (const [unitId, ids] of byUnit) {
          const unit = findUnit(state, unitId);
          if (!unit) continue;
          const verdict = rotateVerdict(state, unit, by, ids, index);
          if (!verdict.ok) {
            if (!quiet) refuse(t((verdict.problems[0] ?? "battle.problem.blocked") as I18nKey));
            return;
          }
          turned.set(unitId, verdict.unit);
        }
        dispatch({ type: "units", change: (b) => ({ ...b, units: b.units.map((u) => turned.get(u.id) ?? u) }) });
        return;
      }
      if (!selected || selected.reserve) return;
      const verdict = rotateVerdict(state, selected, by, activeModel?.id, index);
      if (verdict.ok) editUnit(selected.id, () => verdict.unit);
      else if (!quiet) refuse(t((verdict.problems[0] ?? "battle.problem.blocked") as I18nKey));
    },
    [selected, activeModel, state, index, editUnit, refuse, grouped, group],
  );
  /** The ring is dragged: the same turn as R, applied as the hand goes round, with refusals kept quiet. */
  const turnSelection = useCallback((by: number) => rotateSelection(by, true), [rotateSelection]);
  /** The model whose ring turns the selection: the active model, or a unit's leading model. */
  const turnRing = useMemo(() => {
    if (!selected || selected.reserve || (tool !== "select" && tool !== "deploy")) return undefined;
    const model = activeModel ?? selected.models[0];
    return model ? { unitId: selected.id, modelId: model.id, hull: model.hull } : undefined;
  }, [selected, activeModel, tool]);
  const deployAll = useCallback(() => dispatch({ type: "units", change: (b) => autoDeploy(autoDeploy(b, "attacker"), "defender"), record: true }), []);

  /** The planned move's ghost: the model, or the whole formation, standing where it would land. */
  const planned = useMemo(() => {
    if (!plan || tool !== "select") return undefined;
    if (plan.moves) {
      const hulls: ModelHull[] = [];
      const kinds: SilhouetteId[] = [];
      for (const move of plan.moves) {
        const u = findUnit(state, move.unitId);
        const m = u && findModel(u, move.modelId);
        if (!u || !m) continue;
        hulls.push({ ...m.hull, pos: move.at });
        kinds.push(silhouetteFor(u.keywords));
      }
      return { unitId: plan.unitId, modelId: plan.modelId, hulls, kind: kinds[0] ?? "infantry", kinds, moves: plan.moves, legal: true };
    }
    const unit = findUnit(state, plan.unitId);
    if (!unit) return undefined;
    // The picture's rule names the silhouette too; the canvas, loaded later, draws it.
    const kind = silhouetteFor(unit.keywords);
    if (plan.modelId) {
      const model = findModel(unit, plan.modelId);
      return model ? { unitId: plan.unitId, modelId: plan.modelId, hulls: [{ ...model.hull, pos: plan.at }], kind, legal: true } : undefined;
    }
    const anchor = anchorOf(unit);
    return { unitId: plan.unitId, hulls: unitHulls(translateUnit(unit, { x: plan.at.x - anchor.pos.x, y: plan.at.y - anchor.pos.y }, plan.at.z)), kind, legal: true };
  }, [plan, state, tool]);

  /**
   * One rule for clicking a unit, wherever it is clicked: under the sight tool an enemy of the
   * selected unit becomes the target; everything else becomes the selection. Under the terrain tool
   * units are scenery.
   *
   * Both halves matter. Without the side check the sight tool measures a unit's line of sight to its
   * own side, which nobody is asking about; without the tool check, clicking an enemy under the Move
   * tool silently does nothing, because Move has nothing to show a target with.
   */
  /** A mark starts a tape or finishes the one in progress; a finished tape stays on the table. */
  const mark = useCallback((at: Vec2) => {
    const point = { x: at.x, y: at.y, z: 0 };
    setMeasuring((m) => {
      const next = dropMark(m.pending, point, newId("tape"));
      return next.tape ? { tapes: [...m.tapes, next.tape] } : { ...m, pending: next.pending };
    });
  }, []);
  const removeTape = useCallback((id: string) => setMeasuring((m) => ({ ...m, tapes: m.tapes.filter((tape) => tape.id !== id) })), []);

  const pickUnit = useCallback(
    (id: string | undefined, modelId?: string, additive?: boolean) => {
      if (tool === "terrain") return;
      // Under the tape a model is something to measure to rather than something to select. The mark goes
      // on its base, which is where a player would hold the end of a real one.
      if (tool === "measure") {
        const unit = findUnit(state, id);
        const model = unit && findModel(unit, modelId);
        if (model) mark({ x: model.hull.pos.x, y: model.hull.pos.y });
        return;
      }
      if (!id) {
        setGroupIds(new Set());
        setSelectedId(undefined);
        setActiveModelId(undefined);
        return;
      }
      const unit = findUnit(state, id);
      // Deploying works on units rather than models, and a unit still in reserve has nothing to do under
      // any other tool, so picking one takes the player to the deploy tool with it in hand.
      if (tool === "deploy" || unit?.reserve) {
        if (tool !== "deploy") setTool("deploy");
        setSelectedId(id);
        setActiveModelId(undefined);
        return;
      }
      if (tool === "sight" && selected && unit && unit.side !== selected.side) {
        setTargetId(id);
        return;
      }
      if (additive && modelId && tool === "select") {
        // A Shift-press toggles the model in the selection, which starts from what is selected already:
        // the active model, or every model of a unit selected as a whole.
        const next = new Set(groupIds);
        if (!next.size) {
          if (activeModelId) next.add(activeModelId);
          else if (selected && !selected.reserve) for (const m of selected.models) next.add(m.id);
        }
        if (next.has(modelId)) next.delete(modelId);
        else next.add(modelId);
        setGroupIds(next);
        if (next.has(modelId)) {
          setSelectedId(id);
          setActiveModelId(modelId);
        } else if (activeModelId === modelId) {
          const lead = [...next].pop();
          setActiveModelId(lead);
          setSelectedId(lead ? state.units.find((u) => u.models.some((m) => m.id === lead))?.id : id);
        }
        return;
      }
      setGroupIds(new Set());
      setSelectedId(id);
      setActiveModelId(modelId);
    },
    [state, selected, tool, mark, groupIds, activeModelId],
  );

  /** A box drawn on the table: the models inside become the selection, or join it, the last boxed leading. */
  const onBoxSelect = useCallback(
    (ids: string[], additive: boolean) => {
      if (tool !== "select") return;
      const next = new Set(additive ? [...groupIds, ...(activeModelId ? [activeModelId] : []), ...ids] : ids);
      setGroupIds(next);
      const lead = ids[ids.length - 1] ?? (activeModelId && next.has(activeModelId) ? activeModelId : [...next][0]);
      if (!lead) {
        if (!additive) {
          setSelectedId(undefined);
          setActiveModelId(undefined);
        }
        return;
      }
      setSelectedId(state.units.find((u) => u.models.some((m) => m.id === lead))?.id);
      setActiveModelId(lead);
    },
    [tool, groupIds, activeModelId, state],
  );

  /**
   * What a press on the table means, by tool.
   *
   * Under Move, a selected unit goes where you click. Dragging shows the cost as you go and is the
   * nicer gesture, but click-to-move is the one that works with a finger, with a trackpad, and for
   * anyone who would rather not hold a button down while aiming — so both exist and they share the
   * same verdict.
   *
   * The measuring tape takes two points; a third starts a new measurement.
   */
  const onTableDown = useCallback(
    (at: Vec2) => {
      if (tool === "measure") {
        mark(at);
        return;
      }
      if (!selected) return;
      if (tool === "deploy") {
        const verdict = deployVerdict(state, selected, at, index);
        if (verdict.ok) onDeploy(selected.id, at);
        setDragging(false);
        setDrag(verdict.ok ? undefined : { unitId: selected.id, to: at, legal: false, problems: verdict.problems });
        return;
      }
      if (tool !== "select") return;
      // A model is active: the click plans that model's move. Otherwise the whole unit travels as a body.
      const verdict = activeModel ? modelMoveVerdict(state, selected, activeModel, at, index) : dragVerdict(state, selected, at, index);
      if (verdict.ok && verdict.at && verdict.cost !== undefined) proposeMove(selected.id, verdict.at, verdict.cost, activeModel?.id, verdict.path);
      setDragging(false);
      setDrag(verdict.ok ? undefined : { unitId: selected.id, modelId: activeModel?.id, to: at, legal: false, problems: verdict.problems });
    },
    [tool, selected, activeModel, state, index, proposeMove, onDeploy, mark],
  );

  const onDrag = useCallback((next: DragState | undefined) => {
    setDrag(next);
    setDragging(next !== undefined);
  }, []);

  /**
   * The terrain tool's half of the canvas. A drag records its first move as the undoable step and
   * the rest as refinements of it, so one gesture is one step back.
   */
  const dragRecorded = useRef(false);
  const editing: TerrainEditing | undefined = useMemo(() => {
    if (tool !== "terrain") return undefined;
    const record = () => {
      const first = !dragRecorded.current;
      dragRecorded.current = true;
      return first;
    };
    return {
      pieceId: terrainId,
      objectiveId,
      onPickPiece: (id) => {
        setTerrainId(id);
        setObjectiveId(undefined);
      },
      onPickObjective: (id) => {
        setObjectiveId(id);
        setTerrainId(undefined);
      },
      onMovePiece: (id, at) => editLayout((l) => (snapOn ? placePieceSnapped(l, id, at) : placePiece(l, id, at)), record()),
      onMoveObjective: (id, at) => editLayout((l) => moveObjective(l, id, snapOn ? snapPoint(at) : at), record()),
      onDrop: () => {
        dragRecorded.current = false;
      },
    };
  }, [tool, terrainId, objectiveId, snapOn, editLayout]);

  /**
   * Keys. Arrows nudge whatever is selected — a terrain piece or objective by half an inch (two with
   * Shift), the active model by half an inch along a route the movement search approves. Delete
   * removes, R rotates, Escape clears, and undo is the platform's own chord. Nothing fires while a
   * field has focus: those keys belong to the field.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (inField(e.target)) return;
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;

      if ((e.metaKey || e.ctrlKey) && key === "z") {
        e.preventDefault();
        // The terrain tool undoes terrain edits; everywhere else the chord takes back the last thing
        // that happened to the units, which is what the player was doing when they pressed it.
        if (tool === "terrain") dispatch({ type: e.shiftKey ? "redo" : "undo" });
        else undoUnits();
        return;
      }
      if (key === "Escape") {
        if (tool === "terrain") {
          setTerrainId(undefined);
          setObjectiveId(undefined);
        } else if (tool === "measure") setPendingMark(undefined);
        else if (plan) setPlan(undefined);
        else if (grouped) setGroupIds(new Set());
        else pickUnit(undefined);
        return;
      }
      if ((key === "Enter" || key === "Return") && tool === "select" && plan) {
        e.preventDefault();
        approvePlan();
        return;
      }
      if (tool === "deploy" && (key === "Delete" || key === "Backspace") && selected && !selected.reserve) {
        e.preventDefault();
        onWithdraw(selected.id);
        return;
      }

      if ((tool === "select" || tool === "deploy") && key === "r" && selected && !selected.reserve) {
        e.preventDefault();
        rotateSelection(e.shiftKey ? ROTATE_STEP : -ROTATE_STEP);
        return;
      }

      const arrow = ARROWS[key];
      if (tool === "terrain") {
        const step = e.shiftKey ? 4 * EDIT_STEP : EDIT_STEP;
        if (arrow && terrainId) {
          e.preventDefault();
          editLayout((l) => movePiece(l, terrainId, { x: arrow.x * step, y: arrow.y * step }));
        } else if (arrow && objectiveId) {
          e.preventDefault();
          editLayout((l) => {
            const o = l.objectives.find((x) => x.id === objectiveId);
            return o ? moveObjective(l, objectiveId, { x: o.at.x + arrow.x * step, y: o.at.y + arrow.y * step }) : l;
          });
        } else if ((key === "Delete" || key === "Backspace") && (terrainId || objectiveId)) {
          e.preventDefault();
          if (terrainId) editLayout((l) => removePiece(l, terrainId));
          if (objectiveId) editLayout((l) => removeObjective(l, objectiveId));
          setTerrainId(undefined);
          setObjectiveId(undefined);
        } else if (key === "r" && terrainId) {
          editLayout((l) => rotatePiece(l, terrainId, Math.PI / 2));
        }
        return;
      }

      // Arrows nudge a group's ghosts together, judged from each model's real spot.
      if (tool === "select" && arrow && grouped && selected && activeModel) {
        e.preventDefault();
        const leadNow = plan?.moves?.find((m) => m.modelId === activeModel.id)?.at ?? activeModel.hull.pos;
        const by = { x: leadNow.x - activeModel.hull.pos.x + arrow.x * EDIT_STEP, y: leadNow.y - activeModel.hull.pos.y + arrow.y * EDIT_STEP };
        const verdict = groupMoveVerdict(state, group, by, index);
        if (verdict.ok) proposeGroupMove(verdict.moves);
        setDragging(false);
        setDrag(verdict.ok ? undefined : { unitId: selected.id, modelId: activeModel.id, to: { x: activeModel.hull.pos.x + by.x, y: activeModel.hull.pos.y + by.y }, legal: false, problems: verdict.problems });
        return;
      }
      // Arrows nudge the ghost, from wherever it stands; the move is judged from the model's real spot.
      if (tool === "select" && arrow && selected && activeModel) {
        e.preventDefault();
        const from = plan?.modelId === activeModel.id ? plan.at : activeModel.hull.pos;
        const to = { x: from.x + arrow.x * EDIT_STEP, y: from.y + arrow.y * EDIT_STEP };
        const verdict = modelMoveVerdict(state, selected, activeModel, to, index);
        if (verdict.ok && verdict.at && verdict.cost !== undefined) proposeMove(selected.id, verdict.at, verdict.cost, activeModel.id, verdict.path);
        setDragging(false);
        setDrag(verdict.ok ? undefined : { unitId: selected.id, modelId: activeModel.id, to, legal: false, problems: verdict.problems });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tool, terrainId, objectiveId, selected, activeModel, state, index, editLayout, proposeMove, proposeGroupMove, approvePlan, rotateSelection, plan, onWithdraw, undoUnits, pickUnit, setPendingMark, grouped, group]);

  const measureFrom = tool === "measure" ? pendingMark : undefined;
  const live = measureFrom && aim ? tapeDistance(measureFrom, aim) : undefined;
  /** Is there anything on the table for the toolbar's two turn buttons to turn? */
  const canTurn = !!selected && !selected.reserve;
  const clearSelection = useCallback(() => {
    setGroupIds(new Set());
    setSelectedId(undefined);
    setActiveModelId(undefined);
    setPlan(undefined);
  }, []);

  /**
   * What sits beside the pointer: a drag's verdict, or the tape's live reading. The canvas moves
   * the element; the page says what it says.
   */
  const readout =
    dragging && drag && selected
      ? { bad: !drag.legal, text: drag.legal ? (tool === "deploy" ? t("battle.dragDeploy") : t("battle.dragCost", { cost: (drag.cost ?? 0).toFixed(1), move: activeModel ? moveOf(selected, activeModel) : selected.move })) : t((drag.problems[0] ?? "battle.problem.tooFar") as I18nKey) }
      : live !== undefined
        ? { bad: false, text: t("battle.measureLive", { d: live.toFixed(1) }) }
        : undefined;

  return (
    <div className="battle-page">
      <PageHeader
        title={t("battle.title")}
        subtitle={t("battle.subtitle", { layout: layout.name, w: layout.size.width, d: layout.size.depth, units: state.units.length })}
        actions={
          <>
            <Tabs tabs={TOOLS.map((x) => ({ id: x.id, label: t(x.label) }))} value={tool} onChange={setTool} label={t("battle.tool")} />
            <Tabs
              tabs={[
                { id: "orbit" as const, label: t("battle.view.orbit") },
                { id: "top" as const, label: t("battle.view.top") },
              ]}
              value={view}
              onChange={setView}
              label={t("battle.view")}
            />
            <button type="button" className="ghost sm" onClick={() => void resetDeployment()}>
              {t("battle.reset")}
            </button>
          </>
        }
      />

      <div className="battle-body">
        <div className="battle-stage">
          {/* Everything the keys do to the table, as buttons over it: a finger has no ⌘ and no arrows,
              and a mouse user should not have to learn a chord to approve a move. */}
          <div className="battle-toolbar" role="group" aria-label={t("battle.table.actions")} hidden={!webgl}>
            {tool === "terrain" ? (
              <div className="battle-hist" role="group" aria-label={t("battle.terrain.history")}>
                <button type="button" className="ghost sm" disabled={!canUndo(editor)} onClick={() => dispatch({ type: "undo" })} title={t("battle.terrain.undo")} aria-label={t("battle.terrain.undo")}>
                  ↶
                </button>
                <button type="button" className="ghost sm" disabled={!canRedo(editor)} onClick={() => dispatch({ type: "redo" })} title={t("battle.terrain.redo")} aria-label={t("battle.terrain.redo")}>
                  ↷
                </button>
              </div>
            ) : (
              <button type="button" className="ghost sm" disabled={!canUndoUnits(editor)} onClick={undoUnits} title={t("battle.undoMove.title")}>
                {t("battle.undoMove")}
              </button>
            )}
            {tool === "select" ? (
              <>
                <button type="button" className="sm" disabled={!plan} onClick={approvePlan}>
                  {t("battle.plan.approve")}
                </button>
                <button type="button" className="ghost sm" disabled={!plan} onClick={() => setPlan(undefined)}>
                  {t("battle.plan.discard")}
                </button>
              </>
            ) : null}
            {tool === "select" || tool === "deploy" ? (
              <>
                <button type="button" className="ghost sm" disabled={!canTurn} onClick={() => rotateSelection(ROTATE_STEP)} title={t("battle.rotate.left")} aria-label={t("battle.rotate.left")}>
                  ⟲
                </button>
                <button type="button" className="ghost sm" disabled={!canTurn} onClick={() => rotateSelection(-ROTATE_STEP)} title={t("battle.rotate.right")} aria-label={t("battle.rotate.right")}>
                  ⟳
                </button>
              </>
            ) : null}
            {tool === "select" ? (
              <>
                <button type="button" className={`sm ${boxSelect ? "" : "ghost"}`.trim()} aria-pressed={boxSelect} onClick={() => setBoxSelect((on) => !on)} title={t("battle.boxSelect.title")}>
                  {t("battle.boxSelect")}
                </button>
                <button type="button" className={`sm ${addSelect ? "" : "ghost"}`.trim()} aria-pressed={addSelect} onClick={() => setAddSelect((on) => !on)} title={t("battle.addToSelection.title")}>
                  {t("battle.addToSelection")}
                </button>
              </>
            ) : null}
            <button type="button" className="ghost sm" disabled={!selectedId && !grouped} onClick={clearSelection}>
              {t("battle.group.clear")}
            </button>
          </div>
          {webgl ? (
            <ErrorBoundary compact resetKey={layout.id}>
              <Suspense fallback={<p className="muted battle-loading">{t("battle.loading")}</p>}>
                <BattleCanvas
                  state={state}
                  cameraMode={view}
                  selectedId={selectedId}
                  activeModelId={activeModelId}
                  incoherent={incoherent}
                  reach={tool === "select" ? reach : []}
                  reachBudget={reachBudget}
                  rays={shot?.rays ?? []}
                  path={tool === "sight" ? (charge?.path ?? []) : (plan?.path ?? [])}
                  planned={planned}
                  tapes={tapes}
                  onTapeRemove={removeTape}
                  tapesRef={tapesRef}
                  measureFrom={measureFrom}
                  onMeasureHover={setAim}
                  canDrag={tool === "select" || tool === "deploy"}
                  dragMode={tool === "deploy" ? "deploy" : "move"}
                  onDeploy={onDeploy}
                  highlightZone={tool === "deploy" ? selected?.side : undefined}
                  editing={editing}
                  labelsRef={labelsRef}
                  readoutRef={readoutRef}
                  onSelect={pickUnit}
                  groupIds={groupIds}
                  onBoxSelect={onBoxSelect}
                  boxSelect={boxSelect}
                  addToSelection={addSelect}
                  onMoveGroup={proposeGroupMove}
                  marqueeRef={marqueeRef}
                  turnRing={turnRing}
                  onTurn={turnSelection}
                  onMove={proposeMove}
                  onDrag={onDrag}
                  onTableDown={onTableDown}
                />
              </Suspense>
            </ErrorBoundary>
          ) : (
            <p className="muted battle-loading">{t("battle.noWebgl")}</p>
          )}
          <div className="battle-labels" ref={labelsRef} aria-hidden="true">
            {state.units.map((u) => (
              <div key={u.id} className={`battle-label ${u.side}`}>
                <UnitArt of={u} />
                {t(u.name as I18nKey)}
              </div>
            ))}
          </div>
          <div className="battle-labels" ref={tapesRef} aria-hidden="true">
            {tapes.map((tape) => (
              <div key={tape.id} className="battle-label battle-tape-label">
                {t("battle.measureLive", { d: tapeDistance(tape.from, tape.to).toFixed(1) })}
              </div>
            ))}
          </div>
          <div ref={marqueeRef} aria-hidden="true" style={{ position: "absolute", display: "none", border: "1px dashed #f2f4f7", background: "rgba(77, 143, 224, 0.18)", pointerEvents: "none", zIndex: 3 }} />
          <div ref={readoutRef} className={`battle-drag-readout ${readout ? "is-on" : ""} ${readout?.bad ? "bad" : ""}`.trim()} aria-hidden="true">
            {readout?.text}
          </div>
          {refusal ? (
            <p key={refusal.n} className="battle-refusal" role="status">
              {refusal.text}
            </p>
          ) : null}
        </div>

        <aside className="battle-panel">
          <LayoutPicker options={options} current={layout} dirty={dirty} onPick={(next) => void guard(() => loadBattle(next))} />
          {tool === "terrain" ? (
            <>
              <LayoutLibrary
                key={layout.id}
                layout={layout}
                library={library}
                editable={editable}
                dirty={dirty}
                onStore={storeLayout}
                onLoad={(next, force) => {
                  if (force) loadBattle(next);
                  else void guard(() => loadBattle(next));
                }}
                onRefresh={refreshLibrary}
                notify={notify}
              />
              <TerrainPanel
                layout={layout}
                pieceId={terrainId}
                objectiveId={objectiveId}
                canUndo={canUndo(editor)}
                canRedo={canRedo(editor)}
                snap={snapOn}
                coarse={coarse}
                onSnap={setSnapOn}
                onChange={editLayout}
                onSelectPiece={(id) => {
                  setTerrainId(id);
                  if (id) setObjectiveId(undefined);
                }}
                onSelectObjective={(id) => {
                  setObjectiveId(id);
                  if (id) setTerrainId(undefined);
                }}
                onUndo={() => dispatch({ type: "undo" })}
                onRedo={() => dispatch({ type: "redo" })}
              />
            </>
          ) : (
            <BattlePanel
              state={state}
              selected={selected}
              activeModel={activeModel}
              target={target}
              tool={tool}
              drag={drag}
              plan={plan}
              reach={reach}
              upperFloor={upperFloor}
              shot={shot}
              charge={charge}
              tapes={tapes}
              live={live}
              coarse={coarse}
              armies={armies}
              forceOf={forceOf}
              onChooseForce={chooseForce}
              onPick={pickUnit}
              onEdit={editUnit}
              onWithdraw={onWithdraw}
              onApprove={approvePlan}
              onRotate={rotateSelection}
              group={group}
              onClearGroup={() => setGroupIds(new Set())}
              onDiscard={() => setPlan(undefined)}
              onDeployAll={deployAll}
              onAutoDeploy={(side) => dispatch({ type: "units", change: (b) => autoDeploy(b, side), record: true })}
              onClearDeployment={() => dispatch({ type: "units", change: clearDeployment, record: true })}
              onRemoveTape={removeTape}
              onClearTapes={() => setTapes([])}
            />
          )}
        </aside>
      </div>
      {dialog}
    </div>
  );
}

/**
 * What the selection can do, and what state its move is in.
 *
 * Coherency gets its own line because the per-model move makes breaking it easy and momentary: the
 * unit is out of coherency for most of the time it takes to move, and the player needs to see when
 * it is back rather than be stopped from getting there.
 */
/** A model's facing as a compass-style bearing, 0–359°, counter-clockwise from the table's +x. */
const facingDegrees = (model: BattleModel | undefined): number => ((Math.round(((model?.hull.facing ?? 0) * 180) / Math.PI) % 360) + 360) % 360;

function MovePanel({
  selected,
  activeModel,
  drag,
  plan,
  reach,
  upperFloor,
  coarse,
  onPick,
  onEdit,
  onApprove,
  onDiscard,
  onRotate,
  group,
  onClearGroup,
}: {
  selected?: BattleUnit;
  activeModel?: BattleModel;
  drag?: DragState;
  plan?: Plan;
  reach: readonly ReachNode[];
  upperFloor: number;
  /** A touch screen: the lines about arrow keys, Shift and R have nothing to say there. */
  coarse?: boolean;
  onPick: (id: string | undefined, modelId?: string) => void;
  onEdit: (unitId: string, change: (u: BattleUnit) => BattleUnit) => void;
  onApprove: () => void;
  onDiscard: () => void;
  onRotate: (by: number) => void;
  group: readonly GroupMember[];
  onClearGroup: () => void;
}) {
  if (!selected) {
    return (
      <section className="battle-section">
        <h2>{t("battle.selected")}</h2>
        <p className="muted small">{t("battle.selectPrompt")}</p>
      </section>
    );
  }

  const report = unitCoherency(selected);
  const index = activeModel ? selected.models.indexOf(activeModel) : -1;
  const moved = hasMoved(selected);

  return (
    <section className="battle-section">
      <h2>{t("battle.selected")}</h2>
      <div className="battle-scope">
        <button type="button" className={`battle-scope-btn ${activeModel ? "" : "is-on"}`.trim()} onClick={() => onPick(selected.id)}>
          {t("battle.wholeUnit")}
        </button>
        <span className="battle-scope-sep">/</span>
        <span className={`battle-scope-btn ${activeModel ? "is-on" : "muted"}`.trim()}>{activeModel ? t("battle.modelOf", { n: index + 1, total: selected.models.length }) : t("battle.model")}</span>
      </div>
      {group.length >= 2 ? (
        <div className="battle-actions">
          <span className="muted small">{t("battle.group.count", { n: group.length, units: new Set(group.map((m) => m.unitId)).size })}</span>
          <button type="button" className="ghost sm" onClick={onClearGroup}>
            {t("battle.group.clear")}
          </button>
        </div>
      ) : null}

      <dl className="battle-readout">
        <dt>{t("battle.move")}</dt>
        <dd>{activeModel ? moveOf(selected, activeModel) : selected.move}"</dd>
        {activeModel ? (
          <>
            <dt>{t("battle.remaining")}</dt>
            <dd>{remainingMove(selected, activeModel).toFixed(1)}"</dd>
            <dt>{t("battle.spentSoFar")}</dt>
            <dd>{(activeModel.spent ?? 0).toFixed(1)}"</dd>
          </>
        ) : null}
        <dt>{t("battle.reach")}</dt>
        <dd>{reach.length}</dd>
        <dt>{t("battle.reachUpper")}</dt>
        <dd>{upperFloor || "—"}</dd>
      </dl>

      {/* Its own row, not a value in the two-column list: the badge is wider than any number and
          squeezes every label in the list onto three lines when it shares the grid with them. */}
      <div className="battle-coherency">
        {report.ok ? <Badge tone="ok">{t("battle.coherent")}</Badge> : <Badge tone="danger">{report.split ? t("battle.split") : t("battle.incoherentN", { n: report.lonely.length })}</Badge>}
      </div>

      {drag ? (
        <div className="battle-verdict">
          {drag.legal ? (
            <Badge tone="ok">{t("battle.dragCost", { cost: (drag.cost ?? 0).toFixed(1), move: activeModel ? moveOf(selected, activeModel) : selected.move })}</Badge>
          ) : (
            <ul className="battle-problems">
              {drag.problems.map((p) => (
                <li key={p}>{t(p as I18nKey)}</li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      {plan && plan.unitId === selected.id ? (
        <div className="battle-plan">
          <div className="battle-section-head">
            <span className="battle-plan-title">{t("battle.plan.title")}</span>
            <Badge tone="ok">{t("battle.dragCost", { cost: plan.cost.toFixed(1), move: activeModel ? moveOf(selected, activeModel) : selected.move })}</Badge>
          </div>
          <div className="battle-actions">
            <button type="button" className="primary sm" onClick={onApprove}>
              {t("battle.plan.approve")}
            </button>
            <button type="button" className="ghost sm" onClick={onDiscard}>
              {t("battle.plan.discard")}
            </button>
          </div>
          {coarse ? null : <p className="muted small">{t("battle.plan.hint")}</p>}
        </div>
      ) : (
        <>
          <p className="muted small">{activeModel ? t("battle.moveHint") : t("battle.unitHint")}</p>
          {activeModel && coarse ? null : <p className="muted small">{activeModel ? t("battle.nudgeHint") : t("battle.pickModel")}</p>}
          <div className="battle-actions">
            <button type="button" className="ghost sm" onClick={() => onRotate(ROTATE_STEP)} title={t("battle.rotate.left")} aria-label={t("battle.rotate.left")}>
              ⟲
            </button>
            <span className="muted small">{t("battle.rotate.facing", { deg: facingDegrees(activeModel ?? selected.models[0]) })}</span>
            <button type="button" className="ghost sm" onClick={() => onRotate(-ROTATE_STEP)} title={t("battle.rotate.right")} aria-label={t("battle.rotate.right")}>
              ⟳
            </button>
          </div>
          {coarse ? null : (
            <>
              <p className="muted small">{t("battle.rotate.hint")}</p>
              <p className="muted small">{t("battle.group.hint")}</p>
            </>
          )}
        </>
      )}

      {moved ? (
        <div className="battle-actions">
          <button type="button" className="ghost sm" onClick={() => onEdit(selected.id, resetMove)}>
            {t("battle.resetMove")}
          </button>
          <button type="button" className="ghost sm" onClick={() => onEdit(selected.id, endMove)}>
            {t("battle.endMove")}
          </button>
        </div>
      ) : null}
    </section>
  );
}

function BattlePanel({
  state,
  selected,
  activeModel,
  target,
  tool,
  drag,
  plan,
  reach,
  upperFloor,
  shot,
  charge,
  tapes,
  live,
  coarse,
  armies,
  forceOf,
  onChooseForce,
  onPick,
  onEdit,
  onWithdraw,
  onApprove,
  onDiscard,
  onRotate,
  group,
  onClearGroup,
  onDeployAll,
  onAutoDeploy,
  onClearDeployment,
  onRemoveTape,
  onClearTapes,
}: {
  state: BattleState;
  selected?: BattleUnit;
  activeModel?: BattleModel;
  target?: BattleUnit;
  tool: BattleTool;
  drag?: DragState;
  plan?: Plan;
  reach: readonly ReachNode[];
  upperFloor: number;
  shot?: SightReadout;
  charge?: ChargeReadout;
  tapes: readonly Tape[];
  /** The tape's reading to the pointer while its second mark is not yet set. */
  live?: number;
  /** A touch screen: the lines about keys have nothing to say there. */
  coarse?: boolean;
  /** The stored armies a side's force can be taken from. */
  armies: readonly { id: string; name: string }[];
  /** Which force a side is showing: an army's id, or the sample force. */
  forceOf: (side: Side) => string;
  onChooseForce: (side: Side, id: string) => void;
  onPick: (id: string | undefined, modelId?: string) => void;
  onEdit: (unitId: string, change: (u: BattleUnit) => BattleUnit) => void;
  onWithdraw: (unitId: string) => void;
  onApprove: () => void;
  onDiscard: () => void;
  onRotate: (by: number) => void;
  group: readonly GroupMember[];
  onClearGroup: () => void;
  onDeployAll: () => void;
  onAutoDeploy: (side: Side) => void;
  onClearDeployment: () => void;
  onRemoveTape: (id: string) => void;
  onClearTapes: () => void;
}) {
  const sides = ["attacker", "defender"] as const;

  return (
    <>
      {tool === "deploy" ? (
        <section className="battle-section">
          <h2>{t("battle.deploy.title")}</h2>
          <p className="muted small">{t("battle.deploy.hint")}</p>
          <div className="battle-actions wrap">
            <button type="button" className="sm" onClick={onDeployAll}>
              {t("battle.deploy.everything")}
            </button>
            <button type="button" className="ghost sm" onClick={onClearDeployment}>
              {t("battle.deploy.clear")}
            </button>
          </div>
          {sides.map((side) => (
            <div key={side} className="battle-deploy-side">
              <div className="battle-section-head">
                <h3 className="battle-deploy-h">{t(`side.${side}` as I18nKey)}</h3>
                <button type="button" className="ghost sm" onClick={() => onAutoDeploy(side)}>
                  {t("battle.deploy.auto")}
                </button>
              </div>
              <label className="battle-force">
                <span>{t("battle.force.label")}</span>
                <select className="sm" value={forceOf(side)} onChange={(e) => onChooseForce(side, e.target.value)}>
                  <option value={SAMPLE_FORCE}>{t("battle.force.sample")}</option>
                  {armies.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </label>
              <ul className={`battle-unit-list ${side}`}>
                {unitsOf(state, side).map((u) => (
                  <li key={u.id} className="battle-unit-row">
                    <button type="button" className={`battle-unit ${u.id === selected?.id ? "is-selected" : ""} ${u.reserve ? "is-reserve" : ""}`.trim()} onClick={() => onPick(u.id)}>
                      <UnitArt of={u} className={`battle-swatch ${side}`} />
                      <span className="battle-unit-name">{t(u.name as I18nKey)}</span>
                      <span className="battle-unit-meta">{u.reserve ? t("battle.deploy.reserve") : t("battle.deploy.deployed")}</span>
                    </button>
                    {u.reserve ? null : (
                      <button type="button" className="ghost sm battle-unit-x" title={t("battle.deploy.withdraw")} aria-label={t("battle.deploy.withdraw")} onClick={() => onWithdraw(u.id)}>
                        ×
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {selected ? <p className="muted small">{selected.reserve ? t("battle.deploy.armed", { name: t(selected.name as I18nKey) }) : t(coarse ? "battle.deploy.selectedDeployedTouch" : "battle.deploy.selectedDeployed")}</p> : null}
          {drag && !drag.legal ? (
            <ul className="battle-problems left">
              {drag.problems.map((p) => (
                <li key={p}>{t(p as I18nKey)}</li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : (
        <section className="battle-section">
          <h2>{t("battle.units")}</h2>
          {sides.map((side) => (
            <ul key={side} className={`battle-unit-list ${side}`}>
              {unitsOf(state, side).map((u) => (
                <li key={u.id}>
                  <button
                    type="button"
                    className={`battle-unit ${u.id === selected?.id ? "is-selected" : ""} ${u.id === target?.id ? "is-target" : ""} ${u.reserve ? "is-reserve" : ""}`.trim()}
                    onClick={() => onPick(u.id)}
                    title={u.reserve ? t("battle.deploy.reserveHint") : undefined}
                  >
                    <UnitArt of={u} className={`battle-swatch ${side}`} />
                    <span className="battle-unit-name">{t(u.name as I18nKey)}</span>
                    <span className="battle-unit-meta">{u.reserve ? t("battle.deploy.reserve") : `${u.models.length}× · M${u.move}"`}</span>
                  </button>
                </li>
              ))}
            </ul>
          ))}
          <p className="muted small">{t("battle.samplePlaceholder")}</p>
        </section>
      )}

      {tool === "select" ? <MovePanel selected={selected} activeModel={activeModel} drag={drag} plan={plan} reach={reach} upperFloor={upperFloor} coarse={coarse} onPick={onPick} onEdit={onEdit} onApprove={onApprove} onDiscard={onDiscard} onRotate={onRotate} group={group} onClearGroup={onClearGroup} /> : null}

      {tool === "sight" ? (
        <section className="battle-section">
          <h2>{t("battle.target")}</h2>
          {!selected || !target || !shot ? (
            <p className="muted small">{t("battle.pickTarget")}</p>
          ) : (
            <dl className="battle-readout">
              <dt>{t("battle.distance")}</dt>
              <dd>{shot.distance.toFixed(1)}"</dd>
              <dt>{shot.visible ? t("battle.visible") : t("battle.hidden")}</dt>
              <dd>{shot.visible ? t("battle.exposure", { pct: Math.round(shot.exposure * 100) }) : t("battle.blockedBy", { ids: shot.blockers.join(", ") })}</dd>
              <dt>{t("battle.cover")}</dt>
              <dd>{t(`battle.cover.${shot.cover}` as I18nKey)}</dd>
              <dt>{t("battle.charge")}</dt>
              <dd>{charge && Number.isFinite(charge.distance) ? t("battle.chargeNeeds", { roll: charge.minimumRoll, pct: Math.round(charge.probability * 100) }) : t("battle.chargeImpossible")}</dd>
            </dl>
          )}
          <p className="muted small">{t("battle.assumedHeight")}</p>
        </section>
      ) : null}

      {tool === "measure" ? (
        <section className="battle-section">
          <h2>{t("battle.tool.measure")}</h2>
          <p className="muted small">{t("battle.measureHint")}</p>
          {live === undefined ? null : <p className="battle-measure is-live">{t("battle.measureResult", { d: live.toFixed(1) })}</p>}
          {tapes.length ? (
            <ul className="battle-piece-list battle-tape-list" aria-label={t("battle.measureTapes")}>
              {tapes.map((tape, i) => (
                <li key={tape.id}>
                  <button type="button" className="battle-piece-row" title={t("battle.measureRemove")} onClick={() => onRemoveTape(tape.id)}>
                    <span className="id">{t("battle.measureTape", { n: i + 1 })}</span>
                    <span className="meta">{t("battle.measureLive", { d: tapeDistance(tape.from, tape.to).toFixed(1) })} ×</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {tapes.length > 1 ? (
            <div className="battle-actions">
              <button type="button" className="ghost sm" onClick={onClearTapes}>
                {t("battle.measureClear")}
              </button>
            </div>
          ) : null}
        </section>
      ) : null}
    </>
  );
}
