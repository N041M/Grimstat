import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { MOUSE, OrthographicCamera, PerspectiveCamera, TOUCH, Vector3 } from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { Aabb2, BoardSize } from "@grimstat/board";

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
    const tanV = Math.tan(((perspective.fov * Math.PI) / 180) / 2);
    const tanH = tanV * aspect;

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
  }, [halfX, halfY, aspect, perspective.fov]);

  useEffect(() => {
    perspective.aspect = aspect;
    perspective.updateProjectionMatrix();

    // The orthographic frustum holds the scene exactly, then grows on the axis the pane has to spare.
    let halfWidth = halfX * 1.06;
    let halfDepth = halfY * 1.06;
    if (halfWidth / halfDepth < aspect) halfWidth = halfDepth * aspect;
    else halfDepth = halfWidth / aspect;
    orthographic.left = -halfWidth;
    orthographic.right = halfWidth;
    orthographic.top = halfDepth;
    orthographic.bottom = -halfDepth;
    orthographic.updateProjectionMatrix();
  }, [perspective, orthographic, aspect, halfX, halfY]);

  // Swap the active camera, put it somewhere sensible, and rebuild the controls around it.
  useEffect(() => {
    const camera = mode === "top" ? orthographic : perspective;
    if (mode === "top") {
      // Straight down, with board +y as screen up. Without redefining `up`, looking along −y is
      // degenerate against the default +y and the table arrives at an arbitrary rotation.
      camera.up.set(0, 0, -1);
      camera.position.set(centre.x, 150, centre.z);
      camera.zoom = 1;
    } else {
      camera.up.set(0, 1, 0);
      const elevation = (ELEVATION * Math.PI) / 180;
      camera.position.set(centre.x, distance * Math.sin(elevation), centre.z + distance * Math.cos(elevation));
    }
    camera.lookAt(centre);
    camera.updateProjectionMatrix();
    set({ camera });

    const next = new OrbitControls(camera, gl.domElement);
    next.target.copy(centre);
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
    // The framing the view opens on, kept so `recentre` can return to it.
    next.saveState();
    controls.current = next;
    // Publish the controls so the rest of the scene can suspend them — dragging a unit and orbiting
    // the camera are the same gesture, and only one of them can have it.
    set({ controls: next as unknown as never });
    invalidate();
    return () => {
      next.removeEventListener("change", onChange);
      set({ controls: null as unknown as never });
      next.dispose();
    };
  }, [mode, perspective, orthographic, centre, distance, gl, set, invalidate]);

  /**
   * Two fingers can carry the board off the screen, and nothing on a table of dark ground says
   * which way it went. Bumping `recentre` puts the camera back where the view opened.
   */
  useEffect(() => {
    if (!recentre) return;
    controls.current?.reset();
    invalidate();
  }, [recentre, invalidate]);

  useFrame(() => controls.current?.update());
  return null;
}
