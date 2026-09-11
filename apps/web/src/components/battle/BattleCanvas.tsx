import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Plane, Raycaster, Vector2, Vector3 } from "three";
import type { ReachNode, Vec2, Vec3 } from "@grimstat/board";
import type { BattleState, BattleUnit, Tape } from "../../lib/battle";
import { anchorOf, findModel, findUnit, indexOf, modelMoveVerdict, translateUnit, unitHulls } from "../../lib/battle";
import { centre } from "../../lib/layoutEdit";
import { Cameras, type CameraMode } from "./Cameras";
import { Lighting, Objectives, Table, Terrain, Zones } from "./TableScene";
import { Ghost, UnitTokens } from "./UnitTokens";
import { MeasureLine, MeasureMarker, PathLine, Protractor, ReachOverlay, SightRays, TapeObject } from "./Overlays";

export type { CameraMode };

export interface DragState {
  readonly unitId: string;
  /** The model being moved, or undefined when the whole unit is being repositioned. */
  readonly modelId?: string;
  /** Where the pointer is. */
  readonly to: Vec2;
  /** Where it would actually land — the position the cost was measured to, storey included. */
  readonly at?: Vec3;
  readonly legal: boolean;
  readonly cost?: number;
  readonly problems: readonly string[];
}

/**
 * What the terrain tool needs from the table: which things are selected, and where they were taken.
 *
 * Moves arrive with the piece's new *centre* (or the objective's new position), already corrected for
 * where on the piece it was grabbed. Snapping is the page's decision, not the canvas's.
 */
export interface TerrainEditing {
  readonly pieceId?: string;
  readonly objectiveId?: string;
  onPickPiece(id: string): void;
  onPickObjective(id: string): void;
  onMovePiece(id: string, centre: Vec2): void;
  onMoveObjective(id: string, at: Vec2): void;
  /** The pointer was released after moving something. */
  onDrop(): void;
}

export interface BattleCanvasProps {
  state: BattleState;
  cameraMode: CameraMode;
  selectedId?: string;
  /** The model the reach overlay and the next table click belong to. */
  activeModelId?: string;
  incoherent?: ReadonlySet<string>;
  reach?: readonly ReachNode[];
  rays?: readonly { from: Vec3; to: Vec3; blockedBy?: string }[];
  path?: readonly Vec3[];
  /** Tapes left on the table. Each stays until its line is double-clicked. */
  tapes?: readonly Tape[];
  onTapeRemove?(id: string): void;
  /** One child per tape, in the same order; the projector keeps each over its tape's middle. */
  tapesRef?: RefObject<HTMLDivElement>;
  /** A measurement in progress: the first mark is set and the tape runs to the pointer. */
  measureFrom?: Vec3;
  /** Where the tape's free end is, as the pointer moves over the table; undefined when it leaves. */
  onMeasureHover?(at: Vec2 | undefined): void;
  /** Whether pressing a unit picks it up. Off under the tools where moving is not the point. */
  canDrag?: boolean;
  /** Present while the terrain tool is active; absent, terrain and objectives are scenery. */
  editing?: TerrainEditing;
  /** One child per unit, in the same order; the projector moves them to follow the table. */
  labelsRef?: RefObject<HTMLDivElement>;
  /** An element the canvas keeps beside the pointer during a drag; the page decides what it says. */
  readoutRef?: RefObject<HTMLDivElement>;
  onSelect(unitId: string | undefined, modelId?: string): void;
  /** Commit a move. `modelId` moves one model; without it the whole unit travels as a body. */
  onMove(unitId: string, to: Vec3, cost: number, modelId?: string): void;
  onDrag?(drag: DragState | undefined): void;
  /** A press on the table itself. What it means is the page's business, not the canvas's. */
  onTableDown?(at: Vec2): void;
}

/**
 * The table.
 *
 * The frame loop runs continuously rather than on demand. On-demand drawing is the cheaper default,
 * but it leaves the canvas holding whatever it drew last whenever a redraw is missed — and a request
 * made while the tab is hidden is missed, so returning to the page could show a stale table or an
 * empty one. A scene this size is nothing to draw, and a table that is always right is worth more
 * than the frames saved.
 *
 * Everything the scene draws comes from the geometry kernel — the reach overlay is the search's own
 * output, the rays are the ones line of sight actually tested. The canvas adds no rules of its own;
 * if it draws something, the kernel said it.
 */
export function BattleCanvas(props: BattleCanvasProps) {
  return (
    <Canvas className="battle-canvas" dpr={[1, 2]} gl={{ antialias: true }}>
      <color attach="background" args={["#15161a"]} />
      <Scene {...props} />
    </Canvas>
  );
}

/** Whatever the pointer is holding: a model, a terrain piece or an objective, and where on it. */
type Held =
  | { readonly kind: "model"; readonly unitId: string; readonly modelId: string; readonly offset: Vec2 }
  | { readonly kind: "piece"; readonly id: string; readonly offset: Vec2 }
  | { readonly kind: "objective"; readonly id: string; readonly offset: Vec2 };

/**
 * Everything inside the canvas, including the drag.
 *
 * The drag lives in here rather than around the canvas because it has to reach the orbit controls.
 * Orbiting and moving a unit are the same gesture — press and drag — and the controls listen on the
 * canvas element, underneath R3F's object picking, so the controls have to be switched off in the
 * same tick the unit is grabbed. A React state change is a tick too late: the camera has already
 * started to swing.
 */
function Scene({ state, cameraMode, selectedId, activeModelId, incoherent, reach, rays, path, tapes, onTapeRemove, tapesRef, measureFrom, onMeasureHover, canDrag = true, editing, labelsRef, readoutRef, onSelect, onMove, onDrag, onTableDown }: BattleCanvasProps) {
  const controls = useThree((s) => s.controls) as { enabled: boolean } | null;
  const camera = useThree((s) => s.camera);
  const canvas = useThree((s) => s.gl.domElement);
  const raycaster = useThree((s) => s.raycaster);
  // A tape is a line; a line is a pixel wide. Give the picker half an inch of slack either side.
  useEffect(() => {
    raycaster.params.Line = { threshold: 0.5 };
  }, [raycaster]);
  const [drag, setDrag] = useState<DragState | undefined>();
  /** The tape's free end while a measurement is in progress. */
  const [aim, setAim] = useState<Vec2 | undefined>();
  const index = useMemo(() => indexOf(state), [state]);

  // The window listeners are registered once and read the latest of everything through this ref,
  // rather than being torn down and re-added on every render — which, during a drag, is every frame.
  const latest = useRef({ state, index, editing, measureFrom, onMeasureHover, onMove, onDrag });
  latest.current = { state, index, editing, measureFrom, onMeasureHover, onMove, onDrag };

  // A tape with no first mark has no free end.
  useEffect(() => {
    if (!measureFrom) setAim(undefined);
  }, [measureFrom]);

  const held = useRef<Held | undefined>();
  const pending = useRef<DragState | undefined>();

  const hold = useCallback(
    (what: Held) => {
      held.current = what;
      if (controls) controls.enabled = false;
      document.body.style.cursor = "grabbing";
    },
    [controls],
  );

  /**
   * Pick a model up where it was pressed. The offset between the press and the model's centre is kept
   * for the whole drag, so a tank grabbed by its corner stays under the pointer by its corner instead
   * of jumping two inches to centre itself.
   */
  const grabModel = useCallback(
    (unitId: string, modelId: string, at: Vec2) => {
      if (!canDrag) return;
      const unit = findUnit(latest.current.state, unitId);
      const model = unit && findModel(unit, modelId);
      if (!model) return;
      hold({ kind: "model", unitId, modelId, offset: { x: model.hull.pos.x - at.x, y: model.hull.pos.y - at.y } });
    },
    [canDrag, hold],
  );

  const pickPiece = useCallback(
    (id: string, at: Vec2) => {
      const piece = latest.current.state.layout.pieces.find((p) => p.id === id);
      if (!piece || !editing) return;
      editing.onPickPiece(id);
      const c = centre(piece);
      hold({ kind: "piece", id, offset: { x: c.x - at.x, y: c.y - at.y } });
    },
    [editing, hold],
  );

  const pickObjective = useCallback(
    (id: string, at: Vec2) => {
      const objective = latest.current.state.layout.objectives.find((o) => o.id === id);
      if (!objective || !editing) return;
      editing.onPickObjective(id);
      hold({ kind: "objective", id, offset: { x: objective.at.x - at.x, y: objective.at.y - at.y } });
    },
    [editing, hold],
  );

  const ghost = useMemo(() => {
    if (!drag) return undefined;
    const unit = findUnit(state, drag.unitId);
    if (!unit) return undefined;
    // The ghost stands where it would land. Only when the move is refused does it follow the pointer
    // instead, so the player can see what they are pointing at and why it will not do.
    const spot = drag.at ?? drag.to;
    if (drag.modelId) {
      const model = findModel(unit, drag.modelId);
      return model ? [{ ...model.hull, pos: { x: spot.x, y: spot.y, z: drag.at?.z ?? model.hull.pos.z } }] : undefined;
    }
    const anchor = anchorOf(unit);
    return unitHulls(translateUnit(unit, { x: spot.x - anchor.pos.x, y: spot.y - anchor.pos.y }));
  }, [drag, state]);

  /**
   * A drag follows the window, not the table mesh.
   *
   * Asking three.js which object is under the pointer answers "the ruin" or "another unit" as often
   * as "the table", and nothing at all once the pointer leaves the canvas — so a drag wired to the
   * table's own hover events stops updating exactly when the player moves somewhere interesting.
   * Casting against a mathematical plane at the unit's own height has no such gaps, and it is the
   * right plane anyway: a unit being dragged along a gantry should track the gantry, not the floor.
   *
   * The same reasoning applies to the release. It happens over the side panel as often as not.
   *
   * One verdict per animation frame, not per event: a pointer reports far faster than the movement
   * search finishes, and every event judged is a frame not drawn.
   */
  useEffect(() => {
    const ray = new Raycaster();
    const ndc = new Vector2();
    const hit = new Vector3();
    const plane = new Plane(new Vector3(0, 1, 0), 0);
    let frame = 0;
    let last: PointerEvent | undefined;

    const pointAt = (e: PointerEvent, height: number): Vec2 | undefined => {
      const rect = canvas.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return undefined;
      ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -(((e.clientY - rect.top) / rect.height) * 2 - 1));
      ray.setFromCamera(ndc, camera);
      plane.constant = -height;
      return ray.ray.intersectPlane(plane, hit) ? { x: hit.x, y: -hit.z } : undefined;
    };

    const place = (e: PointerEvent) => {
      const readout = readoutRef?.current;
      if (!readout) return;
      const rect = canvas.getBoundingClientRect();
      readout.style.transform = `translate(${e.clientX - rect.left + 14}px, ${e.clientY - rect.top + 18}px)`;
    };

    /** The tape's free end: only while the pointer is over the table, and only once a mark is set. */
    const aimAt = (e: PointerEvent) => {
      const { measureFrom: mark, onMeasureHover: report } = latest.current;
      if (!mark) return;
      const over = e.target instanceof Node && canvas.contains(e.target);
      const at = over ? pointAt(e, mark.z) : undefined;
      setAim(at);
      report?.(at);
      if (at) place(e);
    };

    const follow = (e: PointerEvent) => {
      const what = held.current;
      if (!what) {
        aimAt(e);
        return;
      }
      const { state: now, index: idx, editing: edit, onDrag: report } = latest.current;

      if (what.kind !== "model") {
        const at = pointAt(e, 0);
        if (!at) return;
        const to = { x: at.x + what.offset.x, y: at.y + what.offset.y };
        if (what.kind === "piece") edit?.onMovePiece(what.id, to);
        else edit?.onMoveObjective(what.id, to);
        return;
      }

      const unit = findUnit(now, what.unitId);
      const model = unit && findModel(unit, what.modelId);
      if (!unit || !model) return;
      const at = pointAt(e, model.hull.pos.z);
      if (!at) return;
      const to = { x: at.x + what.offset.x, y: at.y + what.offset.y };
      const verdict = modelMoveVerdict(now, unit, model, to, idx);
      const next: DragState = { unitId: what.unitId, modelId: what.modelId, to, at: verdict.at, legal: verdict.ok, cost: verdict.cost, problems: verdict.problems };
      pending.current = next;
      setDrag(next);
      report?.(next);
      place(e);
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!held.current && !latest.current.measureFrom) return;
      last = e;
      if (!frame) {
        frame = requestAnimationFrame(() => {
          frame = 0;
          if (last) follow(last);
        });
      }
    };

    const drop = () => {
      const what = held.current;
      if (!what) return;
      if (frame) {
        cancelAnimationFrame(frame);
        frame = 0;
      }
      // Land where the pointer let go, not where the last drawn frame had it.
      if (last) follow(last);
      held.current = undefined;
      last = undefined;
      if (controls) controls.enabled = true;
      document.body.style.cursor = "";

      if (what.kind !== "model") {
        latest.current.editing?.onDrop();
        return;
      }
      const result = pending.current;
      if (result?.legal && result.at && result.cost !== undefined) latest.current.onMove(result.unitId, result.at, result.cost, result.modelId);
      pending.current = undefined;
      setDrag(undefined);
      latest.current.onDrag?.(undefined);
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", drop);
    window.addEventListener("pointercancel", drop);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", drop);
      window.removeEventListener("pointercancel", drop);
    };
  }, [camera, canvas, controls, readoutRef]);

  const onDown = useCallback((at: Vec2) => (held.current ? undefined : onTableDown?.(at)), [onTableDown]);

  return (
    <>
      <Cameras mode={cameraMode} size={state.layout.size} />
      <Lighting size={state.layout.size} />
      <Table size={state.layout.size} onDown={onDown} />
      <Zones zones={state.zones} />
      <Terrain pieces={state.layout.pieces} selectedId={editing?.pieceId} onPick={editing ? pickPiece : undefined} />
      <Objectives objectives={state.layout.objectives} selectedId={editing?.objectiveId} onPick={editing ? pickObjective : undefined} />
      {reach?.length ? <ReachOverlay nodes={reach} /> : null}
      {rays?.length ? <SightRays rays={rays} /> : null}
      {path?.length ? <PathLine path={path} /> : null}
      {tapes?.map((tape) => (
        <TapeObject key={tape.id} from={tape.from} to={tape.to} onRemove={() => onTapeRemove?.(tape.id)} />
      ))}
      {measureFrom ? (
        <>
          <MeasureMarker at={measureFrom} />
          <Protractor at={measureFrom} />
          {aim ? <MeasureLine from={measureFrom} to={{ x: aim.x, y: aim.y, z: measureFrom.z }} /> : null}
        </>
      ) : null}
      <UnitTokens units={state.units} selectedId={selectedId} activeModelId={activeModelId} incoherent={incoherent} draggable={canDrag} onSelect={onSelect} onGrab={grabModel} />
      {ghost && drag ? <Ghost hulls={ghost} legal={drag.legal} /> : null}
      {labelsRef ? <LabelProjector labelsRef={labelsRef} units={state.units} /> : null}
      {tapesRef && tapes?.length ? <TapeLabelProjector tapesRef={tapesRef} tapes={tapes} /> : null}
    </>
  );
}

/** Each tape's reading as HTML over its middle, projected every frame like the unit names. */
function TapeLabelProjector({ tapesRef, tapes }: { tapesRef: RefObject<HTMLDivElement>; tapes: readonly Tape[] }) {
  const { camera, size } = useThree();
  const scratch = useMemo(() => new Vector3(), []);
  useFrame(() => {
    const host = tapesRef.current;
    if (!host) return;
    const children = host.children;
    for (let i = 0; i < tapes.length && i < children.length; i++) {
      const tape = tapes[i]!;
      scratch.set((tape.from.x + tape.to.x) / 2, (tape.from.z + tape.to.z) / 2 + 0.6, -(tape.from.y + tape.to.y) / 2).project(camera);
      const el = children[i] as HTMLElement;
      const behind = scratch.z > 1;
      el.style.visibility = behind ? "hidden" : "visible";
      if (behind) continue;
      el.style.transform = `translate(-50%, -50%) translate(${((scratch.x + 1) / 2) * size.width}px, ${((1 - scratch.y) / 2) * size.height}px)`;
    }
  });
  return null;
}

/**
 * Unit names as HTML, positioned by projecting each unit's anchor into screen space every frame.
 *
 * HTML rather than 3D text: it stays crisp at any zoom, it is selectable and readable by a screen
 * reader, and it costs no draw calls. The transforms are written straight to the DOM so following
 * the camera never re-renders React.
 */
function LabelProjector({ labelsRef, units }: { labelsRef: RefObject<HTMLDivElement>; units: readonly BattleUnit[] }) {
  const { camera, size } = useThree();
  const scratch = useMemo(() => new Vector3(), []);

  useFrame(() => {
    const host = labelsRef.current;
    if (!host) return;
    const children = host.children;
    for (let i = 0; i < units.length && i < children.length; i++) {
      const unit = units[i]!;
      const anchor = anchorOf(unit);
      scratch.set(anchor.pos.x, anchor.pos.z + anchor.height + 0.6, -anchor.pos.y).project(camera);
      const el = children[i] as HTMLElement;
      const behind = scratch.z > 1;
      el.style.visibility = behind ? "hidden" : "visible";
      if (behind) continue;
      el.style.transform = `translate(-50%, -100%) translate(${((scratch.x + 1) / 2) * size.width}px, ${((1 - scratch.y) / 2) * size.height}px)`;
    }
  });
  return null;
}
