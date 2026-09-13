/**
 * A press on something on the table, as the rest of the scene wants it.
 *
 * three.js answers a press with the point on the surface that was hit, which is as high above the
 * table as whatever was pressed. A drag does not follow surfaces. It casts the pointer against a
 * horizontal plane at the height of the thing being moved, because a surface is not under the
 * pointer once the pointer has left it. The two only agree when the grab is taken on the same plane
 * the drag will use, so a press hands over the ray it was made along and the point is taken at
 * whatever height is asked for. Pressing a ruin's roof and taking the point there instead puts the
 * hand's offset out by nine inches for the whole drag.
 */

import { Plane, Vector3, type Ray } from "three";
import type { ThreeEvent } from "@react-three/fiber";
import type { Vec2 } from "@grimstat/board";
import { fromScene } from "../../lib/battleScene";

export interface Press {
  /** The pointer that made the press, so a drag can follow that one and ignore every other. */
  readonly event: PointerEvent;
  /** The board point the press lands on at this height above the table. */
  at(height: number): Vec2;
}

const PLANE = new Plane(new Vector3(0, 1, 0), 0);
const HIT = new Vector3();

/** Where a ray crosses the board at a height above the table, or nothing if it runs parallel to it. */
export function boardPointOn(ray: Ray, height: number): Vec2 | undefined {
  PLANE.constant = -height;
  return ray.intersectPlane(PLANE, HIT) ? { x: HIT.x, y: -HIT.z } : undefined;
}

/**
 * A press along `ray`, falling back to `surface` for the ray that never crosses the table at all.
 *
 * The ray is copied because three.js reuses one raycaster for every event, and the press outlives
 * the event that made it by the length of a drag.
 */
export function press(event: PointerEvent, ray: Ray, surface: Vec2): Press {
  const along = ray.clone();
  return { event, at: (height) => boardPointOn(along, height) ?? surface };
}

/** The press a scene object was given, ready to be read at any height. */
export const pressOf = (e: ThreeEvent<PointerEvent>): Press => {
  const p = fromScene(e.point.x, e.point.y, e.point.z);
  return press(e.nativeEvent, e.ray, { x: p.x, y: p.y });
};
