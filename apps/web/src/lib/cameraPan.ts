/**
 * Keyboard panning for the battle table's camera: which keys, which way, and how far per frame.
 *
 * The camera component holds the three.js objects; this is the arithmetic, kept apart so it can be
 * tested without a canvas.
 */

/** A direction or offset along the scene's axes: x across the table, y up, z towards the near edge. */
export interface Scene3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** The keys that carry the view across the table while held, and the way each one sends it. */
export const PAN_KEYS: Readonly<Record<string, { readonly forward: number; readonly right: number }>> = {
  w: { forward: 1, right: 0 },
  s: { forward: -1, right: 0 },
  a: { forward: 0, right: -1 },
  d: { forward: 0, right: 1 },
};

/** How far a held key carries the view each second, as a fraction of the height of the table in shot. */
export const PAN_RATE = 0.5;

/** The longest frame a pan is paid for, so a stalled tab does not fling the view on its next frame. */
const MAX_FRAME_S = 0.1;

/**
 * The way "forward" runs along the table for a camera looking along `direction` with `up` as its
 * up. It is the look direction flattened onto the table. Looking straight down leaves nothing to
 * flatten, and then the camera's own up is forward, which in the top-down view is up the screen.
 */
export function tableForward(direction: Scene3, up: Scene3): Scene3 {
  let x = direction.x;
  let z = direction.z;
  if (x * x + z * z < 1e-6) {
    x = up.x;
    z = up.z;
  }
  const length = Math.hypot(x, z) || 1;
  return { x: x / length, y: 0, z: z / length };
}

/**
 * How far the view slides this frame for the keys held: an offset along the table, or nothing.
 *
 * `inShot` is how many inches of table the view spans top to bottom, so the slide is a share of the
 * view whatever the zoom. Two keys at once move diagonally at the same speed as one.
 */
export function panStep(held: ReadonlySet<string>, forward: Scene3, inShot: number, deltaSeconds: number): Scene3 | undefined {
  let f = 0;
  let r = 0;
  for (const key of held) {
    const way = PAN_KEYS[key];
    if (!way) continue;
    f += way.forward;
    r += way.right;
  }
  if (!f && !r) return undefined;
  const by = (PAN_RATE * inShot * Math.min(Math.max(0, deltaSeconds), MAX_FRAME_S)) / Math.hypot(f, r);
  // Right is forward turned a quarter turn clockwise seen from above.
  const right = { x: -forward.z, z: forward.x };
  return { x: forward.x * f * by + right.x * r * by, y: 0, z: forward.z * f * by + right.z * r * by };
}
