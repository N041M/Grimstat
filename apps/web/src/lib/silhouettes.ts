/**
 * A model's shape on the table, built here from primitives rather than downloaded.
 *
 * This app ships no Games Workshop sculpts, and the "free" Warhammer models to be found online are
 * rips and fan works of them, so no model can look like *its* miniature. What every model has is a
 * class — trooper, tank, walker, monster, swarm — and one stylised figure per class is enough to
 * tell a table apart at a glance, with nothing to licence, credit, fetch or store. The class is the
 * same one that picks the unit's picture (a faction picture stands in only for plain infantry, and
 * only on the page), so the figure and the picture always agree on what a thing is.
 *
 * Every figure is designed in inches, in real proportions, for a *nominal* model of its class — a
 * trooper two inches tall on a 32 mm base, a tank on a 120 × 92 mm oval — with `x` forward along
 * the facing, `z` across, feet on `y = 0`. It is then normalised: `y` so the highest point is 1,
 * `x` and `z` by the nominal base, so that `figureScale` puts a nominal model back at true size and
 * merely stretches an unusual one. The height rule is not cosmetic. The kernel measures visibility
 * with the model's assumed height, and the figure is drawn to exactly that height so the player can
 * see why a wall does or does not hide it. Weapons and snouts may overhang the base a little, as a
 * miniature's do; the limit is enforced, not trusted.
 *
 * A figure is two merged geometries in one: *armour*, drawn in the side's colour, and *accent* —
 * tracks, weapons, visors, claws — drawn dark, which is what makes a tank read as a tank rather than
 * a coloured brick. Parts may overlap freely; the merge costs nothing at draw time.
 */

import { BoxGeometry, BufferGeometry, ConeGeometry, CylinderGeometry, ExtrudeGeometry, Quaternion, Shape, SphereGeometry, Vector3 } from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { ModelHull } from "@grimstat/board";
import { footReach, inches } from "@grimstat/board";
import { UNIT_CLASS_IDS, unitClassFor, type UnitClassId } from "./unitArt";

/** The classes a figure exists for — the same classes the unit pictures use. */
export type SilhouetteId = UnitClassId;
export const SILHOUETTE_IDS: readonly SilhouetteId[] = UNIT_CLASS_IDS;

/** Which figure stands for a unit, from its keywords: the picture's class rule, applied to the model. */
export const silhouetteFor = (keywords: readonly string[]): SilhouetteId => unitClassFor(keywords);

/** How much of the base disc's radius a figure fills; the rest is the rim of the base. */
export const SILHOUETTE_FIT = 0.92;

/** How far past the (fitted) base a figure may reach, as a fraction of it: a gun barrel, a snout. */
export const SILHOUETTE_OVERHANG = 1.2;

/** Material slots of a merged figure: `0` is armour (the side's colour), `1` is accent (dark). */
export const ARMOUR = 0;
export const ACCENT = 1;

/** The model each figure is drawn for: base radius and elongation in inches, and its assumed height. */
const NOMINAL: Readonly<Record<SilhouetteId, { readonly r: number; readonly stretch: number; readonly h: number }>> = {
  infantry: { r: inches(32) / 2, stretch: 1, h: 2 },
  character: { r: inches(40) / 2, stretch: 1, h: 2.5 },
  vehicle: { r: inches(92) / 2, stretch: 120 / 92, h: 3.5 },
  transport: { r: inches(92) / 2, stretch: 120 / 92, h: 3.5 },
  walker: { r: inches(60) / 2, stretch: 1, h: 4 },
  monster: { r: inches(70) / 2, stretch: 105 / 70, h: 4 },
  beast: { r: inches(50) / 2, stretch: 1, h: 2 },
  swarm: { r: inches(40) / 2, stretch: 1, h: 1 },
  aircraft: { r: inches(60) / 2, stretch: 1, h: 5 },
  bike: { r: inches(42) / 2, stretch: 75 / 42, h: 2 },
  mounted: { r: inches(35) / 2, stretch: 60 / 35, h: 3 },
  titanic: { r: inches(160) / 2, stretch: 1, h: 7 },
  fortification: { r: 3, stretch: 1, h: 6 },
};

/**
 * The scale that draws a class's figure for one model: base radius across, height up, and along
 * the facing the base's own elongation or the figure's, whichever is more — a tank on a round base
 * keeps its length and overhangs, rather than being squashed into a cube.
 */
export function figureScale(id: SilhouetteId, hull: ModelHull): [number, number, number] {
  const r = hull.foot.r * SILHOUETTE_FIT;
  const stretch = footReach(hull.foot) / hull.foot.r;
  return [r * Math.max(stretch, NOMINAL[id].stretch), hull.height, r];
}

/* ---- primitives, placed --------------------------------------------------------------------- */

type P3 = readonly [number, number, number];
const HALF = Math.PI / 2;
const UP = new Vector3(0, 1, 0);

/**
 * A box `w` along x, `h` along y, `d` along z, centred at `(x, y, z)`.
 * `tilt` leans its top forward (+x); `turn` spins it about y; `roll` leans its top across (+z).
 */
function box(w: number, h: number, d: number, x: number, y: number, z: number, tilt = 0, turn = 0, roll = 0): BufferGeometry {
  const g = new BoxGeometry(w, h, d);
  if (roll) g.rotateX(roll);
  if (tilt) g.rotateZ(-tilt);
  if (turn) g.rotateY(turn);
  return g.translate(x, y, z);
}

/** An upright cylinder, `rTop` at the top and `rBottom` at the foot, of height `h`, centred at `y`. */
function post(rTop: number, rBottom: number, h: number, x: number, y: number, z: number, segments = 10, tilt = 0): BufferGeometry {
  const g = new CylinderGeometry(rTop, rBottom, h, segments);
  if (tilt) g.rotateZ(-tilt);
  return g.translate(x, y, z);
}

/** A cylinder lying along x — a barrel, an engine — `length` long, centred at `(x, y, z)`. */
function barrel(r: number, length: number, x: number, y: number, z: number, segments = 8): BufferGeometry {
  return new CylinderGeometry(r, r, length, segments).rotateZ(HALF).translate(x, y, z);
}

/** A wheel: a cylinder with its axle along z. */
function wheel(r: number, width: number, x: number, y: number, z: number): BufferGeometry {
  return new CylinderGeometry(r, r, width, 16).rotateX(HALF).translate(x, y, z);
}

/** A sphere, optionally squashed into an ellipsoid by `(sx, sy, sz)`. Smooth-shaded. */
function blob(r: number, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1): BufferGeometry {
  return new SphereGeometry(r, 14, 10).scale(sx, sy, sz).translate(x, y, z);
}

/** A cone with its base at `(x, y, z)`; `tilt` leans its tip forward (`π/2` lays it along +x). */
function spike(r: number, h: number, x: number, y: number, z: number, tilt = 0): BufferGeometry {
  const g = new ConeGeometry(r, h, 7).translate(0, h / 2, 0);
  if (tilt) g.rotateZ(-tilt);
  return g.translate(x, y, z);
}

/**
 * A tapered cylinder from `a` to `b` — a limb, a neck, a tail segment, a lance — `rA` thick at `a`
 * and `rB` at `b`. Posing a figure is mostly a matter of choosing its joints.
 */
function limb(a: P3, b: P3, rA: number, rB: number, segments = 9): BufferGeometry {
  const dir = new Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const length = dir.length();
  return new CylinderGeometry(rB, rA, length, segments)
    .applyQuaternion(new Quaternion().setFromUnitVectors(UP, dir.normalize()))
    .translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
}

/** A ball joint. */
const joint = (r: number, at: P3): BufferGeometry => blob(r, at[0], at[1], at[2]);

/** A side-view profile (points in x–y) extruded `depth` wide across z, centred at `z`, edges chamfered `bevel`. */
function hull(profile: readonly (readonly [number, number])[], depth: number, z = 0, bevel = 0): BufferGeometry {
  const shape = new Shape();
  profile.forEach(([x, y], i) => (i ? shape.lineTo(x, y) : shape.moveTo(x, y)));
  shape.closePath();
  const g = new ExtrudeGeometry(shape, bevel ? { depth: depth - 2 * bevel, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1 } : { depth, bevelEnabled: false });
  return g.translate(0, 0, z - depth / 2 + bevel);
}

/** A plate seen from above: an outline in x–z, `thick` tall, centred at height `y`. */
function plate(outline: readonly (readonly [number, number])[], thick: number, y: number): BufferGeometry {
  const shape = new Shape();
  outline.forEach(([x, z], i) => (i ? shape.lineTo(x, -z) : shape.moveTo(x, -z)));
  shape.closePath();
  return new ExtrudeGeometry(shape, { depth: thick, bevelEnabled: false }).rotateX(-HALF).translate(0, y - thick / 2, 0);
}

/** A rounded-rectangle profile — a tank track seen from the side — `length` by `height`, corners `r`. */
function trackShape(length: number, height: number, r: number): (readonly [number, number])[] {
  const pts: [number, number][] = [];
  const cx = length / 2 - r;
  const cy = height / 2 - r;
  const corners: [number, number, number][] = [[cx, cy, 0], [-cx, cy, HALF], [-cx, -cy, Math.PI], [cx, -cy, 3 * HALF]];
  for (const [x, y, start] of corners) for (let i = 0; i <= 4; i++) pts.push([x + r * Math.cos(start + (i / 4) * HALF), y + r * Math.sin(start + (i / 4) * HALF)]);
  return pts;
}

/** A half-cylinder shell over a wheel — a mudguard — of radius `r`, `width` across, axle at `(x, y)`. */
function mudguard(r: number, width: number, x: number, y: number): BufferGeometry {
  return new CylinderGeometry(r, r, width, 14, 1, true, 0, Math.PI).rotateX(HALF).rotateZ(HALF).translate(x, y, 0);
}

/** The same part on the other side of the figure: flipped across z, with its faces turned right way out. */
function mirror(g: BufferGeometry): BufferGeometry {
  const m = (g.index ? g.toNonIndexed() : g.clone()).scale(1, 1, -1);
  for (const name of Object.keys(m.attributes)) {
    const attr = m.getAttribute(name);
    const arr = attr.array as Float32Array;
    const n = attr.itemSize;
    for (let t = 0; t + 2 < attr.count; t += 3) {
      for (let k = 0; k < n; k++) {
        const i1 = (t + 1) * n + k;
        const i2 = (t + 2) * n + k;
        const tmp = arr[i1]!;
        arr[i1] = arr[i2]!;
        arr[i2] = tmp;
      }
    }
    attr.needsUpdate = true;
  }
  return m;
}

/** `parts` and their mirror images: the two sides of a symmetric figure from one side's design. */
const both = (...parts: BufferGeometry[]): BufferGeometry[] => [...parts, ...parts.map(mirror)];

/** Every part scaled about the origin, turned about y, then shifted, together. */
function moved(parts: readonly BufferGeometry[], x: number, y: number, z: number, scale = 1, turn = 0): BufferGeometry[] {
  return parts.map((g) => {
    if (scale !== 1) g.scale(scale, scale, scale);
    if (turn) g.rotateY(turn);
    return g.translate(x, y, z);
  });
}

/* ---- the figures, in inches ----------------------------------------------------------------- */

interface Figure {
  readonly armour: BufferGeometry[];
  readonly accent: BufferGeometry[];
}

const merge = (...figures: Figure[]): Figure => ({ armour: figures.flatMap((f) => f.armour), accent: figures.flatMap((f) => f.accent) });

/**
 * A trooper's body from the waist up, two inches tall standing, in the heavy powered plate the
 * setting is known for: a barrel chest, oversized pauldrons with a trim ring, a snouted, visored
 * helm, a tabard from the belt, a power pack on the back with twin vents. No arms — they depend on
 * what the figure is doing with them.
 */
function torso(): Figure {
  return {
    armour: [
      post(0.2, 0.2, 0.2, 0, 0.98, 0),
      box(0.46, 0.55, 0.62, 0.02, 1.32, 0),
      blob(0.28, 0.2, 1.36, 0, 0.6, 0.9, 1.05),
      ...both(blob(0.25, 0.02, 1.6, 0.4, 1, 0.75, 1)),
      post(0.08, 0.08, 0.12, 0.02, 1.64, 0),
      blob(0.17, 0.03, 1.83, 0),
      box(0.26, 0.5, 0.5, -0.34, 1.32, 0),
      blob(0.24, -0.34, 1.57, 0, 0.55, 0.6, 1),
    ],
    accent: [
      post(0.21, 0.21, 0.08, 0, 1.02, 0),
      box(0.06, 0.45, 0.24, 0.06, 0.75, 0),
      ...both(post(0.255, 0.255, 0.05, 0.02, 1.58, 0.4, 14), post(0.06, 0.06, 0.24, -0.36, 1.68, 0.17, 6)),
      box(0.12, 0.12, 0.16, 0.17, 1.78, 0),
      box(0.06, 0.06, 0.24, 0.17, 1.9, 0),
    ],
  };
}

/** Striding legs in greaves, the left forward. */
function legs(): Figure {
  return {
    armour: [
      limb([0, 0.95, 0.15], [0.12, 0.5, 0.18], 0.13, 0.11),
      limb([0.12, 0.5, 0.18], [0.18, 0.1, 0.19], 0.12, 0.1),
      joint(0.11, [0.12, 0.5, 0.18]),
      box(0.36, 0.12, 0.22, 0.22, 0.06, 0.2),
      limb([0, 0.95, -0.15], [-0.08, 0.5, -0.18], 0.13, 0.11),
      limb([-0.08, 0.5, -0.18], [-0.12, 0.1, -0.19], 0.12, 0.1),
      joint(0.11, [-0.08, 0.5, -0.18]),
      box(0.36, 0.12, 0.22, -0.08, 0.06, -0.2),
    ],
    accent: [],
  };
}

/** An arm from `shoulder` through `elbow` to `hand`. */
function arm(shoulder: P3, elbow: P3, hand: P3): BufferGeometry[] {
  return [limb(shoulder, elbow, 0.1, 0.085), limb(elbow, hand, 0.085, 0.075), joint(0.09, elbow), joint(0.075, hand)];
}

/** A trooper: striding, a boxy bolt-gun held across the body, right hand at the fore grip. */
function trooper(): Figure {
  return merge(torso(), legs(), {
    armour: [...arm([0.02, 1.52, 0.4], [0.2, 1.18, 0.4], [0.41, 1.28, 0.1]), ...arm([0.02, 1.52, -0.4], [0.12, 1.16, -0.36], [0.15, 1.27, -0.06])],
    accent: [box(0.5, 0.16, 0.14, 0.28, 1.31, 0.02, 0, -0.5), box(0.1, 0.18, 0.1, 0.2, 1.18, -0.03, 0, -0.5), barrel(0.03, 0.16, 0.56, 1.34, 0.18, 6)],
  });
}

const FIGURES: Readonly<Record<SilhouetteId, () => Figure>> = {
  infantry: trooper,

  /** The trooper made a hero: a little larger, caped, a crest on the helm, a blade raised high. */
  character: () => {
    const t = trooper();
    const f = merge({ armour: moved(t.armour, 0, 0, 0, 1.1), accent: moved(t.accent, 0, 0, 0, 1.1) });
    return merge(f, {
      armour: [new CylinderGeometry(0.16, 0.46, 0.95, 14, 1, true, HALF, Math.PI).rotateY(-HALF).translate(-0.3, 1.25, 0)],
      accent: [limb([0.17, 1.4, -0.07], [0.05, 2.5, -0.2], 0.04, 0.008, 6), box(0.05, 0.05, 0.26, 0.15, 1.44, -0.08), box(0.26, 0.1, 0.05, 0.03, 2.22, 0)],
    });
  },

  /** A battle tank of the setting's boxy pattern: tall tracks, a hull gun in the glacis, the turret set back, sponsons. */
  vehicle: () => ({
    armour: [
      ...both(box(4, 0.2, 0.58, 0, 1.7, 0.95), box(1.1, 0.55, 0.4, 0.3, 2.05, 1.2)),
      hull([[-1.85, 0.7], [1.4, 0.7], [2, 1.5], [1.6, 2.4], [-1.6, 2.4], [-1.85, 1.9]], 1.45, 0, 0.05),
      box(1.2, 0.25, 1.35, -1.2, 2.5, 0),
      post(0.6, 0.75, 0.8, -0.45, 2.8, 0, 12),
      post(0.24, 0.24, 0.3, -0.7, 3.35, 0.3, 10),
    ],
    accent: [
      ...both(
        hull(trackShape(3.9, 1.6, 0.6), 0.5, 0.95).translate(0, 0.85, 0),
        barrel(0.06, 0.5, 1.1, 2.05, 1.2, 6),
        post(0.08, 0.08, 0.35, -1.75, 2.6, 0.5, 6, -0.4),
        box(0.08, 0.12, 0.18, 1.92, 1.9, 0.35),
      ),
      box(0.9, 0.05, 1, -1.2, 2.65, 0),
      box(0.35, 0.5, 0.55, 0.2, 2.8, 0),
      barrel(0.09, 1.7, 1.25, 2.85, 0),
      barrel(0.13, 0.18, 2.05, 2.85, 0),
      barrel(0.06, 0.5, 2, 1.95, -0.5, 6),
      post(0.2, 0.2, 0.05, -0.7, 3.475, 0.3, 10),
      barrel(0.04, 0.5, -0.25, 3.42, 0.3, 6),
      post(0.02, 0.02, 0.7, -1.5, 3.05, -0.6, 4),
    ],
  }),

  /** A carrier: the tank's tracks under a tall hull with a rear ramp, side doors, roof hatches, a small turret. */
  transport: () => ({
    armour: [
      ...both(box(4, 0.2, 0.58, 0, 1.3, 0.95), box(0.6, 0.12, 0.55, -0.6, 2.9, 0.4)),
      hull([[-1.85, 0.7], [1.35, 0.7], [2, 1.55], [1.85, 2.85], [-1.6, 2.85], [-1.85, 2.1]], 1.5, 0, 0.05),
      post(0.35, 0.42, 0.4, 0.7, 3.05, 0, 12),
    ],
    accent: [
      ...both(
        hull(trackShape(3.9, 1.15, 0.5), 0.5, 0.95).translate(0, 0.625, 0),
        box(0.9, 1.1, 0.04, 0, 1.7, 0.76),
        box(0.08, 0.12, 0.18, 1.9, 1.75, 0.5),
        barrel(0.045, 0.6, 1.25, 3.15, 0.08, 6),
      ),
      box(0.08, 1.7, 1.1, -1.87, 1.55, 0),
      box(0.15, 0.25, 0.15, 0.5, 3.375, 0),
    ],
  }),

  /** A walker: long reverse-jointed legs under a narrow sarcophagus torso, a gun pod one side and a fist the other. */
  walker: () => ({
    armour: [
      ...both(
        box(0.75, 0.2, 0.45, 0.1, 0.1, 0.55),
        limb([0.05, 0.18, 0.55], [0.3, 0.95, 0.52], 0.12, 0.14),
        joint(0.16, [0.3, 0.95, 0.52]),
        limb([0.3, 0.95, 0.52], [-0.05, 1.7, 0.4], 0.15, 0.15),
        blob(0.24, 0.05, 3.3, 0.68, 1, 0.8, 1),
      ),
      box(0.6, 0.35, 0.95, -0.05, 1.8, 0),
      hull([[-0.55, 2], [0.4, 2], [0.62, 2.35], [0.55, 3.45], [-0.55, 3.45], [-0.65, 2.7]], 1.1, 0, 0.05),
      box(0.42, 0.28, 0.42, 0.32, 3.59, 0),
      box(0.75, 0.38, 0.32, 0.3, 3.05, 0.68),
      box(0.6, 0.38, 0.34, 0.25, 3, -0.68),
    ],
    accent: [
      ...both(box(0.2, 0.16, 0.15, 0.55, 0.08, 0.45), box(0.2, 0.16, 0.15, 0.55, 0.08, 0.65), limb([0.2, 1.5, 0.45], [0.35, 0.95, 0.52], 0.05, 0.05, 6), post(0.08, 0.08, 0.55, -0.45, 3.72, 0.28, 6)),
      box(0.06, 0.18, 0.5, 0.6, 3.05, 0),
      box(0.06, 0.1, 0.3, 0.53, 3.59, 0),
      barrel(0.05, 0.3, 0.8, 3.13, 0.68, 6),
      barrel(0.05, 0.3, 0.8, 2.97, 0.6, 6),
      barrel(0.05, 0.3, 0.8, 2.97, 0.76, 6),
      box(0.4, 0.09, 0.09, 0.72, 3.13, -0.68, -0.25),
      box(0.4, 0.09, 0.09, 0.72, 2.87, -0.68, 0.25),
    ],
  }),

  /** A monster of the hive: hunched on two clawed legs, a lower pair of arms reaching, an upper pair of scything talons, a crested head, plated back, tail. */
  monster: () => ({
    armour: [
      ...both(
        limb([-0.3, 2.1, 0.45], [0.3, 1.25, 0.55], 0.26, 0.2),
        limb([0.3, 1.25, 0.55], [-0.1, 0.3, 0.6], 0.18, 0.14),
        joint(0.2, [0.3, 1.25, 0.55]),
        box(0.6, 0.28, 0.36, 0.1, 0.14, 0.6),
        limb([0.55, 2.7, 0.55], [1.05, 2, 0.7], 0.17, 0.14),
        limb([1.05, 2, 0.7], [1.45, 1.2, 0.55], 0.14, 0.12),
        joint(0.15, [1.05, 2, 0.7]),
        limb([0.4, 2.9, 0.45], [0.85, 3.5, 0.8], 0.13, 0.09),
        joint(0.1, [0.85, 3.5, 0.8]),
      ),
      blob(0.75, -0.2, 2.45, 0, 1.35, 0.85, 1),
      blob(0.55, 0.45, 2.1, 0, 1.1, 1, 0.95),
      limb([0.85, 3.05, 0], [1.3, 3.55, 0], 0.26, 0.22),
      blob(0.3, 1.5, 3.6, 0, 1.2, 0.9, 1),
      box(0.5, 0.28, 0.34, 1.85, 3.5, 0),
      limb([-1.1, 2.4, 0], [-1.7, 1.9, 0.1], 0.25, 0.16),
      limb([-1.7, 1.9, 0.1], [-2.1, 1.2, 0.2], 0.16, 0.06),
    ],
    accent: [
      ...both(
        spike(0.06, 0.25, 0.4, 0.16, 0.5, HALF),
        spike(0.06, 0.25, 0.4, 0.16, 0.7, HALF),
        spike(0.05, 0.3, 1.45, 1.2, 0.45, 2),
        spike(0.05, 0.3, 1.45, 1.2, 0.55, 2),
        spike(0.05, 0.3, 1.45, 1.2, 0.65, 2),
        spike(0.07, 0.95, 0.85, 3.5, 0.8, 1.3),
      ),
      box(0.45, 0.08, 0.3, 1.85, 3.34, 0, 0.15),
      box(0.55, 0.12, 0.7, 1.3, 3.92, 0, -0.45),
      box(0.4, 0.08, 0.95, 0.4, 2.98, 0, 0.2),
      box(0.4, 0.08, 1, 0.05, 3.09, 0, 0.05),
      box(0.4, 0.08, 1, -0.3, 3.1, 0, -0.1),
      box(0.4, 0.08, 0.9, -0.65, 3.04, 0, -0.3),
      spike(0.07, 0.3, 0.4, 3.02, 0, -0.35),
      spike(0.07, 0.3, 0.05, 3.13, 0, -0.35),
      spike(0.07, 0.3, -0.3, 3.14, 0, -0.35),
      spike(0.07, 0.3, -0.65, 3.08, 0, -0.35),
    ],
  }),

  /** A beast: a deep-chested body on four legs, a snouted head with pricked ears, a raised tail. */
  beast: () => ({
    armour: [
      ...both(
        limb([0.4, 0.95, 0.2], [0.45, 0.45, 0.22], 0.09, 0.07),
        limb([0.45, 0.45, 0.22], [0.5, 0.06, 0.22], 0.07, 0.06),
        limb([-0.4, 0.95, 0.2], [-0.6, 0.5, 0.22], 0.11, 0.08),
        limb([-0.6, 0.5, 0.22], [-0.5, 0.06, 0.22], 0.08, 0.06),
      ),
      blob(0.32, 0, 1.15, 0, 1.8, 0.85, 0.9),
      blob(0.3, 0.35, 1.1, 0, 1.1, 1.05, 1),
      blob(0.28, -0.4, 1.15, 0),
      limb([0.55, 1.35, 0], [0.8, 1.6, 0], 0.16, 0.14),
      blob(0.18, 0.85, 1.62, 0, 1.1, 0.9, 0.9),
      box(0.24, 0.16, 0.18, 0.95, 1.55, 0),
      limb([-0.6, 1.25, 0], [-0.85, 1.6, 0.05], 0.07, 0.05),
      limb([-0.85, 1.6, 0.05], [-0.95, 1.95, 0.08], 0.05, 0.02),
    ],
    accent: [...both(blob(0.08, 0.52, 0.05, 0.22, 1.4, 0.6, 1.1), blob(0.08, -0.48, 0.05, 0.22, 1.4, 0.6, 1.1), spike(0.05, 0.2, 0.78, 1.76, 0.1, -0.3))],
  }),

  /** A swarm: small creatures over the base and a heap of them in the middle, one rearing on top. */
  swarm: () => {
    const critter = (x: number, z: number, turn: number, size: number, y = 0, rear = 0): Figure => {
      const body = [blob(0.1, 0, 0.1, 0, 1.5, 0.8, 1), blob(0.065, 0.15, 0.115, 0)];
      const legs = both(limb([0.045, 0.08, 0.06], [0.12, 0, 0.16], 0.015, 0.008, 5), limb([-0.045, 0.08, 0.06], [-0.12, 0, 0.16], 0.015, 0.008, 5), spike(0.015, 0.05, 0.19, 0.11, 0.03, HALF));
      const pose = (g: BufferGeometry) => (rear ? g.rotateZ(rear) : g);
      return { armour: moved(body.map(pose), x, y, z, size, turn), accent: moved(legs.map(pose), x, y, z, size, turn) };
    };
    const critters = [critter(0.42, 0.22, 0.4, 1), critter(-0.38, 0.3, 2.5, 0.9), critter(0.08, -0.47, -1.2, 1), critter(-0.42, -0.22, -2.6, 0.95), critter(0.45, -0.2, 0.9, 0.85), critter(-0.08, 0.5, 1.8, 0.9), critter(0.03, 0.2, 0.2, 1.3, 0.3, 0.85)];
    return merge({ armour: [blob(0.3, 0, 0.18, 0, 1.1, 0.6, 1.1)], accent: [] }, ...critters);
  },

  /** A gunship on its stand, blocky as the setting's flyers are: a slab fuselage, stub wings carrying engines and missile pods, a tail fin, a nose gun. */
  aircraft: () => ({
    armour: [
      hull([[-0.95, 3.8], [0.7, 3.8], [1.05, 4.05], [1, 4.45], [0.5, 4.6], [-0.7, 4.6], [-0.95, 4.4]], 0.6, 0, 0.04),
      box(0.35, 0.55, 0.06, -0.8, 4.75, 0),
      ...both(
        plate([[-0.3, 0.28], [0.35, 0.28], [0.2, 1.05], [-0.45, 1.05]], 0.08, 4.3),
        plate([[-0.95, 0.15], [-0.7, 0.15], [-0.75, 0.5], [-0.95, 0.5]], 0.05, 4.4),
        barrel(0.16, 0.8, -0.1, 4.2, 0.75, 12),
        box(0.5, 0.18, 0.22, -0.05, 4.05, 0.55),
      ),
    ],
    accent: [
      post(0.15, 0.15, 0.05, -0.15, 0.025, 0, 12),
      post(0.04, 0.04, 3.6, -0.15, 1.85, 0, 6),
      box(0.35, 0.22, 0.4, 0.75, 4.55, 0, 0.2),
      barrel(0.04, 0.35, 1.15, 4, 0, 6),
      ...both(barrel(0.14, 0.06, 0.31, 4.2, 0.75, 12), barrel(0.13, 0.08, -0.52, 4.2, 0.75, 12), barrel(0.03, 0.12, 0.25, 4.02, 0.5, 6), barrel(0.03, 0.12, 0.25, 4.08, 0.6, 6)),
    ],
  }),

  /** A bike: fat tyres, a faired body with twin guns, exhausts, and a rider leaning over the bars. */
  bike: () => ({
    armour: [
      wheel(0.17, 0.3, 0.85, 0.44, 0),
      wheel(0.17, 0.3, -0.85, 0.44, 0),
      mudguard(0.5, 0.34, 0.85, 0.44),
      hull([[-0.7, 0.5], [0.45, 0.5], [0.7, 0.75], [0.55, 1.05], [0.15, 0.95], [-0.3, 0.88], [-0.75, 0.85]], 0.6, 0, 0.04),
      box(0.36, 0.5, 0.46, -0.12, 1.32, 0, 0.55),
      ...both(blob(0.18, 0.03, 1.5, 0.32, 1, 0.75, 1), limb([0.03, 1.45, 0.32], [0.5, 1.2, 0.32], 0.08, 0.07), limb([-0.3, 1, 0.22], [0.05, 0.85, 0.32], 0.11, 0.09), limb([0.05, 0.85, 0.32], [-0.1, 0.55, 0.36], 0.09, 0.08)),
      blob(0.16, 0.22, 1.84, 0),
      box(0.22, 0.36, 0.42, -0.38, 1.3, 0, 0.55),
    ],
    accent: [
      wheel(0.42, 0.28, 0.85, 0.44, 0),
      wheel(0.42, 0.28, -0.85, 0.44, 0),
      box(0.5, 0.3, 0.7, 0.05, 0.62, 0),
      box(0.06, 0.06, 0.85, 0.52, 1.18, 0),
      box(0.45, 0.08, 0.4, -0.3, 0.92, 0),
      box(0.1, 0.1, 0.2, 0.37, 1.84, 0),
      ...both(barrel(0.045, 0.5, 1.05, 0.85, 0.17, 6), barrel(0.06, 0.6, -0.95, 0.68, 0.28, 6)),
    ],
  }),

  /** A rider on a mount: a deep-chested quadruped with a raised head, saddle, rider and a lance. */
  mounted: () => ({
    armour: [
      ...both(
        limb([0.4, 1.2, 0.2], [0.48, 0.6, 0.22], 0.09, 0.07),
        limb([0.48, 0.6, 0.22], [0.5, 0.06, 0.22], 0.07, 0.06),
        limb([-0.42, 1.25, 0.2], [-0.55, 0.65, 0.22], 0.11, 0.08),
        limb([-0.55, 0.65, 0.22], [-0.48, 0.06, 0.22], 0.08, 0.06),
        blob(0.16, -0.05, 2.32, 0.28, 1, 0.75, 1),
        limb([-0.05, 1.9, 0.18], [0.2, 1.6, 0.32], 0.09, 0.08),
        limb([0.2, 1.6, 0.32], [0.12, 1.15, 0.36], 0.08, 0.07),
      ),
      blob(0.36, 0, 1.45, 0, 2, 0.85, 1),
      blob(0.3, 0.4, 1.45, 0, 1.2, 1, 1),
      blob(0.3, -0.42, 1.5, 0),
      limb([0.6, 1.75, 0], [0.95, 2.3, 0], 0.15, 0.12),
      box(0.4, 0.18, 0.16, 1.1, 2.32, 0, 0.5),
      limb([-0.75, 1.6, 0], [-1.05, 1, 0.05], 0.06, 0.03),
      box(0.32, 0.48, 0.42, -0.05, 2.1, 0),
      blob(0.15, -0.03, 2.55, 0),
      box(0.2, 0.3, 0.36, -0.28, 2.1, 0),
      limb([-0.05, 2.28, 0.3], [0.25, 2, 0.3], 0.07, 0.06),
      limb([-0.05, 2.28, -0.3], [0.35, 2.05, -0.15], 0.07, 0.06),
      box(0.3, 0.14, 0.02, 0.85, 2.75, 0.27),
    ],
    accent: [
      ...both(post(0.075, 0.075, 0.1, 0.5, 0.05, 0.22, 6), post(0.075, 0.075, 0.1, -0.48, 0.05, 0.22, 6), spike(0.04, 0.14, 0.98, 2.42, 0.07)),
      box(0.45, 0.1, 0.45, -0.05, 1.78, 0),
      box(0.08, 0.07, 0.18, 0.11, 2.54, 0),
      limb([-0.55, 1.6, 0.32], [1.15, 2.95, 0.25], 0.035, 0.012, 6),
    ],
  }),

  /** A titan in the manner of the setting's knights: armoured legs, a domed carapace with guns, a cannon arm, a chain-blade arm, a tilting plate at the shoulder. */
  titanic: () => ({
    armour: [
      ...both(
        box(1.5, 0.4, 0.9, 0.15, 0.2, 1.05),
        limb([0.05, 0.35, 1.05], [0.3, 2.8, 1], 0.3, 0.36),
        joint(0.38, [0.3, 2.8, 1]),
        limb([0.3, 2.8, 1], [-0.05, 4.3, 0.8], 0.36, 0.36),
        joint(0.4, [-0.05, 4.3, 0.8]),
        box(0.65, 1.6, 0.5, 0.3, 3.6, 1.3, 0.15),
        box(0.5, 1.7, 0.5, 0.42, 1.7, 1.05),
        box(0.85, 0.9, 0.22, 0.15, 5.75, 1.5),
      ),
      box(1.1, 0.9, 1.9, -0.05, 4.45, 0),
      hull([[-0.9, 4.75], [0.8, 4.75], [1.1, 5.6], [0.9, 6.3], [-0.9, 6.3], [-1.1, 5.4]], 1.8, 0, 0.06),
      box(2.3, 0.3, 2.7, -0.25, 6.45, 0, -0.1),
      blob(1.4, -0.2, 6.5, 0, 0.85, 0.3, 1),
      box(0.9, 0.5, 0.7, -0.3, 6.75, 1),
      box(1.6, 0.65, 0.65, 0.6, 5.3, -1.75),
      box(1, 0.6, 0.6, 0.35, 5.3, 1.75),
      box(0.65, 0.45, 0.65, 0.95, 5.9, 0),
      box(0.08, 1.1, 0.8, 1.2, 4.9, 0.75, 0.1),
    ],
    accent: [
      ...both(box(0.36, 0.32, 0.24, 1, 0.16, 0.75), box(0.36, 0.32, 0.24, 1, 0.16, 1.05), box(0.36, 0.32, 0.24, 1, 0.16, 1.35), post(0.14, 0.14, 0.5, -0.9, 6.55, 0.6, 6)),
      barrel(0.08, 0.12, 0.16, 6.87, 0.85, 6),
      barrel(0.08, 0.12, 0.16, 6.87, 1.15, 6),
      barrel(0.08, 0.12, 0.16, 6.63, 0.85, 6),
      barrel(0.08, 0.12, 0.16, 6.63, 1.15, 6),
      barrel(0.16, 1.5, 0.15, 6.82, -0.95, 8),
      barrel(0.2, 0.15, 0.85, 6.82, -0.95, 8),
      barrel(0.2, 1.1, 1.9, 5.3, -1.75, 8),
      barrel(0.28, 0.2, 2.4, 5.3, -1.75, 8),
      box(1.5, 0.85, 0.14, 1.5, 5.3, 1.75),
      box(0.06, 0.16, 0.5, 1.28, 5.9, 0),
      box(0.05, 1.2, 0.5, -0.3, 3.5, 0),
    ],
  }),

  /** A bunker: an eight-sided blockhouse on a plinth, ribbed, slits and a door, a roof turret. */
  fortification: () => {
    const ribs: BufferGeometry[] = [];
    for (let k = 0; k < 8; k++) {
      const a = Math.PI / 8 + (k * Math.PI) / 4;
      ribs.push(box(0.45, 3, 0.45, 2.55 * Math.cos(a), 1.65, 2.55 * Math.sin(a), 0, -a));
    }
    const slits = [0, Math.PI / 4, -Math.PI / 4].map((a) => box(0.1, 0.18, 1, 2.27 * Math.cos(a), 3, 2.27 * Math.sin(a), 0, -a));
    return {
      armour: [
        new CylinderGeometry(2.4, 2.65, 3.4, 8).rotateY(Math.PI / 8).translate(0, 1.85, 0),
        ...ribs,
        new CylinderGeometry(2.65, 2.65, 0.2, 8).rotateY(Math.PI / 8).translate(0, 3.65, 0),
        box(1.6, 1, 1.6, -0.4, 4.25, 0),
        post(0.65, 0.75, 0.7, 0.3, 5.1, 0, 8),
      ],
      accent: [
        new CylinderGeometry(2.8, 2.8, 0.15, 8).rotateY(Math.PI / 8).translate(0, 0.075, 0),
        ...slits,
        box(0.1, 1.6, 0.8, -2.27, 0.95, 0),
        post(0.3, 0.3, 0.08, -0.7, 4.79, 0.35, 10),
        ...both(barrel(0.09, 1.4, 1.4, 5.2, 0.2, 6)),
        post(0.06, 0.06, 0.55, -0.1, 5.72, 0, 6),
        post(0.03, 0.03, 1.2, -1.5, 4.35, -1.2, 4),
      ],
    };
  },
};

/* ---- assembly ------------------------------------------------------------------------------- */

const cache = new Map<SilhouetteId, BufferGeometry>();

const flat = (parts: readonly BufferGeometry[]): BufferGeometry => {
  const loose = parts.map((g) => (g.index ? g.toNonIndexed() : g));
  const merged = mergeGeometries(loose, false) ?? new BufferGeometry();
  for (const g of loose) g.dispose();
  return merged;
};

/**
 * The merged geometry for a class, built once and shared by every model of that class.
 *
 * Two groups — armour then accent — so one mesh with two materials draws the whole figure. The
 * design rules are enforced here rather than trusted: feet on the ground, the top at exactly `y = 1`,
 * the base disc normalised to radius 1 with only the allowed overhang beyond it, whatever the
 * designer's arithmetic said. The result is never disposed — thirteen small geometries, kept for
 * the life of the page.
 */
export function silhouetteGeometry(id: SilhouetteId): BufferGeometry {
  let geometry = cache.get(id);
  if (!geometry) {
    const figure = FIGURES[id]();
    const armour = flat(figure.armour);
    const accent = flat(figure.accent);
    const all = mergeGeometries([armour, accent], true) ?? new BufferGeometry();
    armour.dispose();
    accent.dispose();
    all.computeBoundingBox();
    const box = all.boundingBox!;
    if (box.min.y < 0) all.translate(0, -box.min.y, 0);
    const nominal = NOMINAL[id];
    const fit = nominal.r * SILHOUETTE_FIT;
    all.scale(1 / (fit * nominal.stretch), 1 / Math.max(box.max.y - Math.min(0, box.min.y), 1e-6), 1 / fit);
    const pos = all.getAttribute("position");
    let reach = 0;
    for (let i = 0; i < pos.count; i++) reach = Math.max(reach, Math.hypot(pos.getX(i), pos.getZ(i)));
    if (reach > SILHOUETTE_OVERHANG) all.scale(SILHOUETTE_OVERHANG / reach, 1, SILHOUETTE_OVERHANG / reach);
    all.computeBoundingBox();
    geometry = all;
    cache.set(id, geometry);
  }
  return geometry;
}
