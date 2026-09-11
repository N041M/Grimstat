import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Plane, Raycaster, Vector2, Vector3 } from "three";
import type { ReachNode, Vec2, Vec3 } from "@grimstat/board";
import type { BattleState, BattleUnit, MoveVerdict } from "../../lib/battle";
import { anchorOf, findModel, findUnit, indexOf, modelMoveVerdict, translateUnit, unitHulls } from "../../lib/battle";
import { Cameras, type CameraMode } from "./Cameras";
import { Lighting, Objectives, Table, Terrain, Zones } from "./TableScene";
import { Ghost, UnitTokens } from "./UnitTokens";
import { MeasureLine, PathLine, ReachOverlay, SightRays } from "./Overlays";

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
  measure?: readonly [Vec3, Vec3];
  /** Whether pressing a unit picks it up. Off under the tools where moving is not the point. */
  canDrag?: boolean;
  /** One child per unit, in the same order; the projector moves them to follow the table. */
  labelsRef?: RefObject<HTMLDivElement>;
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

/**
 * Everything inside the canvas, including the drag.
 *
 * The drag lives in here rather than around the canvas because it has to reach the orbit controls.
 * Orbiting and moving a unit are the same gesture — press and drag — and the controls listen on the
 * canvas element, underneath R3F's object picking, so the controls have to be switched off in the
 * same tick the unit is grabbed. A React state change is a tick too late: the camera has already
 * started to swing.
 */
function Scene({ state, cameraMode, selectedId, activeModelId, incoherent, reach, rays, path, measure, canDrag = true, labelsRef, onSelect, onMove, onDrag, onTableDown }: BattleCanvasProps) {
  const controls = useThree((s) => s.controls) as { enabled: boolean } | null;
  const camera = useThree((s) => s.camera);
  const canvas = useThree((s) => s.gl.domElement);
  const [drag, setDrag] = useState<DragState | undefined>();
  const index = useMemo(() => indexOf(state), [state]);
  const grabbed = useRef<{ unitId: string; modelId: string } | undefined>();
  const dragRef = useRef<DragState | undefined>();

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

  const grab = useCallback(
    (unitId: string, modelId: string) => {
      if (!canDrag) return;
      grabbed.current = { unitId, modelId };
      if (controls) controls.enabled = false;
      document.body.style.cursor = "grabbing";
    },
    [controls, canDrag],
  );

  const drop = useCallback(() => {
    if (!grabbed.current) return;
    const pending = dragRef.current;
    if (pending?.legal && pending.at && pending.cost !== undefined) onMove(pending.unitId, pending.at, pending.cost, pending.modelId);
    grabbed.current = undefined;
    dragRef.current = undefined;
    if (controls) controls.enabled = true;
    document.body.style.cursor = "";
    setDrag(undefined);
    onDrag?.(undefined);
  }, [controls, onMove, onDrag]);

  /** Following the pointer while a model is held: re-judge the move and move the ghost. */
  const onHover = useCallback(
    (at: Vec2) => {
      const held = grabbed.current;
      if (!held) return;
      const unit = findUnit(state, held.unitId);
      const model = unit && findModel(unit, held.modelId);
      if (!unit || !model) return;
      const verdict: MoveVerdict = modelMoveVerdict(state, unit, model, at, index);
      const next: DragState = { unitId: held.unitId, modelId: held.modelId, to: at, at: verdict.at, legal: verdict.ok, cost: verdict.cost, problems: verdict.problems };
      dragRef.current = next;
      setDrag(next);
      onDrag?.(next);
    },
    [state, index, onDrag],
  );

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
   */
  useEffect(() => {
    const ray = new Raycaster();
    const ndc = new Vector2();
    const hit = new Vector3();
    const plane = new Plane(new Vector3(0, 1, 0), 0);

    const onPointerMove = (e: PointerEvent) => {
      if (!grabbed.current) return;
      const unit = findUnit(state, grabbed.current.unitId);
      if (!unit) return;
      const rect = canvas.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -(((e.clientY - rect.top) / rect.height) * 2 - 1));
      ray.setFromCamera(ndc, camera);
      plane.constant = -(findModel(unit, grabbed.current.modelId)?.hull.pos.z ?? 0);
      if (!ray.ray.intersectPlane(plane, hit)) return;
      onHover({ x: hit.x, y: -hit.z });
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", drop);
    window.addEventListener("pointercancel", drop);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", drop);
      window.removeEventListener("pointercancel", drop);
    };
  }, [drop, onHover, state, camera, canvas]);

  const onDown = useCallback((at: Vec2) => (grabbed.current ? undefined : onTableDown?.(at)), [onTableDown]);

  return (
    <>
      <Cameras mode={cameraMode} size={state.layout.size} />
      <Lighting size={state.layout.size} />
      <Table size={state.layout.size} onDown={onDown} />
      <Zones zones={state.zones} />
      <Terrain pieces={state.layout.pieces} />
      <Objectives objectives={state.layout.objectives} />
      {reach?.length ? <ReachOverlay nodes={reach} /> : null}
      {rays?.length ? <SightRays rays={rays} /> : null}
      {path?.length ? <PathLine path={path} /> : null}
      {measure ? <MeasureLine from={measure[0]} to={measure[1]} /> : null}
      <UnitTokens units={state.units} selectedId={selectedId} activeModelId={activeModelId} incoherent={incoherent} draggable={canDrag} onSelect={onSelect} onGrab={grab} />
      {ghost && drag ? <Ghost hulls={ghost} legal={drag.legal} /> : null}
      {labelsRef ? <LabelProjector labelsRef={labelsRef} units={state.units} /> : null}
    </>
  );
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
