import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { MOUSE, OrthographicCamera, PerspectiveCamera, TOUCH, Vector3 } from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { Aabb2, BoardSize } from "@grimstat/board";
import { PAN_KEYS, panStep, tableForward } from "../../lib/cameraPan";

/**
 * `orbit` is the immersive view; `top` is a true orthographic camera looking straight down.
 *
 * The orthographic one matters: a perspective camera pointed at the table still shows parallax at
 * the edges, so a model near a table corner does not sit where it looks like it sits. Since this
 * view is the one people will measure and plan on, it has to be a projection with no parallax at
 * all — which is exactly the old 2D planning view, for free.
 */
export type CameraMode = "orbit" | "top";

/** How high above the table the orbit camera sits, in degrees. */
const ELEVATION = 36;
/** Headroom the fit allows above the table, so a three-storey ruin is not clipped. */
const TABLE_HEADROOM = 14;

/** How long the camera takes to travel back to the framing the view opened on. */
const RECENTRE_MS = 420;

/**
 * What the toolbars along the head and the foot of the table cover, in CSS pixels each.
 *
 * The fit holds the whole scene in the canvas, and the muster tables are at its top and bottom
 * edges, which is where the tool strip and the action row are drawn. Without this allowance the
 * top-down view opened with both muster tables under the toolbars.
 */
const HUD_PX = 56;

/**
 * How large the table is on screen: CSS pixels per inch of table at the point the camera is turning
 * about, written every frame.
 *
 * The unit labels read it, so that a name over a model grows as the model does when the table is
 * zoomed in. It is measured against the screen rather than against the opening view, since a
 * label has to keep its proportion to the model under it whatever size the canvas is.
 */
export const viewScale = { pxPerInch: 0 };

/**
 * The canvas height the orbit was tuned at, in CSS pixels.
 *
 * OrbitControls turns the view by the fraction of the canvas height a drag covers, so one
 * full-height drag is always a full turn however tall the canvas is. A phone gives the table about
 * 480px where a desktop gives it 820, which turned the same finger travel almost twice as far. The
 * speed is scaled by the height against this figure, so a given drag turns the table by the same
 * amount on every screen. It only ever slows the turn down: a canvas taller than this keeps 1.
 */
const ROTATE_REFERENCE = 800;

/** Is the key meant for a field rather than the table? */
const inField = (target: EventTarget | null): boolean => {
  const el = target as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
};

/** Is something open over the table? Keys typed under it belong to it. */
const underOverlay = (target: EventTarget | null): boolean => {
  if (document.querySelector("dialog[open], [role='dialog'][aria-modal='true']")) return true;
  return target instanceof Element && !!target.closest("[role='dialog']");
};

/** Where a camera is, what it is pointed at, and how far it is zoomed in. */
interface View {
  readonly position: Vector3;
  readonly target: Vector3;
  readonly zoom: number;
}

export function Cameras({ mode, size, frame, recentre }: { mode: CameraMode; size: BoardSize; frame?: Aabb2; recentre?: number }) {
  const { gl, set, size: viewport, invalidate } = useThree();
  const controls = useRef<OrbitControls>();
  const centre = useMemo(() => new Vector3(size.width / 2, 0, -size.depth / 2), [size.width, size.depth]);
  /**
   * What has to be in shot is more than the play area. A player's units start on the muster
   * table beside the board, and a view that cut those off would open on an army nobody can see.
   * The camera still turns about the middle of the board, since that is what is being played on.
   */
  const shot = frame ?? { minX: 0, maxX: size.width, minY: 0, maxY: size.depth };
  const halfX = Math.max(Math.abs(shot.minX - size.width / 2), Math.abs(shot.maxX - size.width / 2));
  const halfY = Math.max(Math.abs(shot.minY - size.depth / 2), Math.abs(shot.maxY - size.depth / 2));

  const perspective = useMemo(() => new PerspectiveCamera(42, 1, 0.5, 600), []);
  const orthographic = useMemo(() => new OrthographicCamera(-1, 1, 1, -1, 0.1, 600), []);

  const aspect = Math.max(viewport.width / Math.max(1, viewport.height), 0.2);
  const viewportHeight = Math.max(1, viewport.height);
  /** How much taller the canvas is than the part of it the toolbars leave clear. */
  const hudScale = viewportHeight / Math.max(1, viewportHeight - 2 * HUD_PX);

  /**
   * How far back the perspective camera has to sit to hold the whole scene.
   *
   * Fitting the bounding *sphere* is the easy answer and a bad one: a table is flat and wide, so the
   * sphere is mostly empty air above and below it and the view ends up half-used. This fits the
   * eight corners of the scene's box instead, measured about the middle of the board.
   *
   * For a camera on the view axis at distance `t` from the target, a corner `q` (relative to the
   * target) sits at depth `dot(q, forward) + t`, while its sideways and vertical offsets do not
   * depend on `t` at all. So each corner gives a minimum `t` directly, and the answer is the largest.
   */
  const distance = useMemo(() => {
    const elevation = (ELEVATION * Math.PI) / 180;
    const forward = new Vector3(0, -Math.sin(elevation), -Math.cos(elevation));
    const right = new Vector3(1, 0, 0);
    const up = new Vector3().crossVectors(right, forward).normalize();
    const tanH = Math.tan(((perspective.fov * Math.PI) / 180) / 2) * aspect;
    const tanV = Math.tan(((perspective.fov * Math.PI) / 180) / 2) / hudScale;

    let needed = 1;
    for (const qx of [-halfX, halfX]) {
      for (const qz of [-halfY, halfY]) {
        for (const cy of [0, TABLE_HEADROOM]) {
          const q = new Vector3(qx, cy, qz);
          const depth = q.dot(forward);
          needed = Math.max(needed, Math.abs(q.dot(right)) / tanH - depth, Math.abs(q.dot(up)) / tanV - depth);
        }
      }
    }
    return needed * 1.04;
  }, [halfX, halfY, aspect, hudScale, perspective.fov]);

  /**
   * The framing a view opens on, which is also where Recentre travels back to.
   *
   * It follows the canvas, since what fits in a wide pane is not what fits in a tall one. Changing
   * it moves nothing. The camera stays where the player put it until they press Recentre.
   */
  const home = useMemo<View>(() => {
    if (mode === "top") return { position: new Vector3(centre.x, 150, centre.z), target: centre.clone(), zoom: 1 };
    const elevation = (ELEVATION * Math.PI) / 180;
    return { position: new Vector3(centre.x, distance * Math.sin(elevation), centre.z + distance * Math.cos(elevation)), target: centre.clone(), zoom: 1 };
  }, [mode, centre, distance]);
  // Read inside effects that must not run again when the framing changes.
  const homeNow = useRef(home);
  homeNow.current = home;

  /**
   * The view each mode was left in, so a trip to the top-down camera and back returns to the table
   * as the player had it rather than to the opening shot. It is dropped when the table itself
   * changes, since a framing of one board says nothing about another.
   */
  const kept = useRef<{ table: string; views: Partial<Record<CameraMode, View>> }>({ table: "", views: {} });
  const table = `${size.width}×${size.depth}`;
  if (kept.current.table !== table) kept.current = { table, views: {} };

  useEffect(() => {
    perspective.aspect = aspect;
    perspective.updateProjectionMatrix();

    // The orthographic frustum holds the scene exactly, then grows on the axis the pane has to spare.
    let halfWidth = halfX * 1.06;
    let halfDepth = halfY * 1.06 * hudScale;
    if (halfWidth / halfDepth < aspect) halfWidth = halfDepth * aspect;
    else halfDepth = halfWidth / aspect;
    orthographic.left = -halfWidth;
    orthographic.right = halfWidth;
    orthographic.top = halfDepth;
    orthographic.bottom = -halfDepth;
    orthographic.updateProjectionMatrix();
  }, [perspective, orthographic, aspect, hudScale, halfX, halfY]);

  /*
   * Swap the active camera, put it where this mode was left, and rebuild the controls around it.
   *
   * It runs on a change of camera and on nothing else. A canvas resize changes the projection and
   * the turn rate, and both of those are set elsewhere. Rebuilding here on a resize would throw the
   * player's framing away, and the full-screen control resizes the table on purpose, mid-game.
   */
  useEffect(() => {
    const camera = mode === "top" ? orthographic : perspective;
    // The top-down camera looks straight down with board +y as screen up. Without redefining `up`,
    // looking along −y is degenerate against the default +y and the table arrives at an arbitrary
    // rotation.
    if (mode === "top") camera.up.set(0, 0, -1);
    else camera.up.set(0, 1, 0);
    const start = kept.current.views[mode] ?? homeNow.current;
    camera.position.copy(start.position);
    camera.zoom = start.zoom;
    camera.lookAt(start.target);
    camera.updateProjectionMatrix();
    set({ camera });

    const next = new OrbitControls(camera, gl.domElement);
    next.target.copy(start.target);
    // A drag has the pointer and has switched the controls off. A camera rebuilt under that drag
    // must not start steering the table with the finger that is moving a model.
    next.enabled = controls.current?.enabled ?? true;
    next.enableDamping = true;
    next.dampingFactor = 0.12;
    next.minDistance = 8;
    next.maxDistance = 260;
    // Never let the camera go under the table: from below, nothing on it can be read.
    next.maxPolarAngle = Math.PI / 2 - 0.02;
    next.enableRotate = mode === "orbit";
    // Straight down there is nothing to orbit, so the left button pans and a drag still moves the view.
    next.mouseButtons.LEFT = mode === "orbit" ? MOUSE.ROTATE : MOUSE.PAN;
    /*
     * The same decision for a finger. OrbitControls starts one finger on rotate, which does nothing
     * at all in the top-down view, where rotating is off — the view could only be panned with two
     * fingers. One finger pans there, exactly as the left button does.
     */
    next.touches.ONE = mode === "orbit" ? TOUCH.ROTATE : TOUCH.PAN;
    next.touches.TWO = TOUCH.DOLLY_PAN;
    const onChange = () => invalidate();
    next.addEventListener("change", onChange);
    next.update();
    controls.current = next;
    // Publish the controls so the rest of the scene can suspend them — dragging a unit and orbiting
    // the camera are the same gesture, and only one of them can have it.
    set({ controls: next as unknown as never });
    invalidate();
    return () => {
      // Remember how this mode was left, unless the table underneath it has changed.
      if (kept.current.table === table) kept.current.views[mode] = { position: camera.position.clone(), target: next.target.clone(), zoom: camera.zoom };
      next.removeEventListener("change", onChange);
      set({ controls: null as unknown as never });
      next.dispose();
    };
  }, [mode, table, perspective, orthographic, gl, set, invalidate]);

  /*
   * The turn rate is the one thing that does follow a resize, since OrbitControls measures a drag
   * against the canvas height. It is set on its own so that a resize does not take the camera with
   * it. Panning and pinching are left alone. A pan is measured so the table keeps up with the
   * finger dragging it and a pinch by the ratio between two fingers, and both are already the same
   * gesture at any size.
   */
  useEffect(() => {
    if (controls.current) controls.current.rotateSpeed = Math.min(1, viewportHeight / ROTATE_REFERENCE);
  }, [viewportHeight, mode, table]);

  /**
   * Two fingers can carry the board off the screen, and nothing on a table of dark ground says
   * which way it went. Bumping `recentre` travels the camera back to where the view opened.
   *
   * It flies rather than cuts. A cut leaves the player to work out what just happened to the view
   * they were looking at; watching it travel says where the board went and which way it came back.
   */
  useEffect(() => {
    if (!recentre) return;
    const next = controls.current;
    const to = homeNow.current;
    if (!next) return;
    // OrbitControls types its subject as an Object3D; here it is always one of the two cameras
    // above, and both carry a zoom and a projection matrix.
    const camera = next.object as PerspectiveCamera | OrthographicCamera;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      camera.position.copy(to.position);
      next.target.copy(to.target);
      camera.zoom = to.zoom;
      camera.updateProjectionMatrix();
      next.update();
      invalidate();
      return;
    }
    const from = { position: camera.position.clone(), target: next.target.clone(), zoom: camera.zoom };
    const start = performance.now();
    let frame = 0;
    const fly = () => {
      const k = Math.min(1, (performance.now() - start) / RECENTRE_MS);
      // Decelerating, so it arrives rather than stops.
      const e = 1 - Math.pow(1 - k, 3);
      camera.position.lerpVectors(from.position, to.position, e);
      next.target.lerpVectors(from.target, to.target, e);
      camera.zoom = from.zoom + (to.zoom - from.zoom) * e;
      camera.updateProjectionMatrix();
      next.update();
      invalidate();
      if (k < 1) frame = requestAnimationFrame(fly);
    };
    frame = requestAnimationFrame(fly);
    return () => cancelAnimationFrame(frame);
  }, [recentre, invalidate]);

  /**
   * W, A, S and D carry the view across the table while they are held.
   *
   * They move the camera and the point it turns about together, so the view slides without
   * tilting. "Forward" is the way the camera is looking, flattened onto the table, which in the
   * top-down view is up the screen. The speed is a share of the table in shot per second, so a key
   * crosses a zoomed-in view as quickly as a zoomed-out one. The keys are read on the window, since
   * the canvas never has focus, and left alone whenever a field or a dialog has them.
   */
  const held = useRef(new Set<string>());
  useEffect(() => {
    const keys = held.current;
    const down = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || inField(e.target) || underOverlay(e.target)) return;
      const key = e.key.toLowerCase();
      if (!(key in PAN_KEYS)) return;
      e.preventDefault();
      keys.add(key);
      invalidate();
    };
    const up = (e: KeyboardEvent) => {
      keys.delete(e.key.toLowerCase());
    };
    // A key released while the window is not listening would carry the view for ever.
    const release = () => keys.clear();
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", release);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", release);
      keys.clear();
    };
  }, [invalidate]);

  const look = useMemo(() => new Vector3(), []);
  useFrame((_, delta) => {
    const next = controls.current;
    if (!next) return;
    const camera = next.object as PerspectiveCamera | OrthographicCamera;
    if (held.current.size && next.enabled) {
      const inShot = camera instanceof OrthographicCamera ? (camera.top - camera.bottom) / camera.zoom : 2 * camera.position.distanceTo(next.target) * Math.tan(((camera.fov * Math.PI) / 180) / 2);
      const step = panStep(held.current, tableForward(camera.getWorldDirection(look), camera.up), inShot, delta);
      if (step) {
        camera.position.x += step.x;
        camera.position.z += step.z;
        next.target.x += step.x;
        next.target.z += step.z;
      }
      invalidate();
    }
    next.update();
    if (camera instanceof OrthographicCamera) viewScale.pxPerInch = (viewportHeight / Math.max(0.001, camera.top - camera.bottom)) * camera.zoom;
    else viewScale.pxPerInch = viewportHeight / 2 / (Math.max(0.001, camera.position.distanceTo(next.target)) * Math.tan(((camera.fov * Math.PI) / 180) / 2));
  });
  return null;
}
