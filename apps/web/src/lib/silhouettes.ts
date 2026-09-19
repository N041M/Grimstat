/**
 * A model's shape on the table, built here from primitives rather than downloaded.
 *
 * This app ships no Games Workshop sculpts, and the "free" Warhammer models to be found online are
 * rips and fan works of them, so no model can look like its own miniature. What every model has is
 * a class: trooper, tank, walker, monster, swarm. One stylised figure per class is enough to tell a
 * table apart at a glance, and there is nothing to licence, credit, fetch or store. The class is the
 * same one that picks the unit's picture (a faction picture stands in only for plain infantry, and
 * only on the page), so the figure and the picture always agree on what a thing is.
 *
 * Every figure is designed in inches, in real proportions, for a nominal model of its class: a
 * trooper two inches tall on a 32 mm base, a tank on a 120 × 92 mm oval. `x` runs forward along the
 * facing, `z` across, and the feet stand on `y = 0`. The figure is then normalised: `y` so the
 * highest point is 1, `x` and `z` by the nominal base, so that `figureScale` puts a nominal model
 * back at true size and merely stretches an unusual one. The height rule matters for play. The
 * kernel measures visibility with the model's assumed height, and the figure is drawn to exactly
 * that height so the player can see why a wall does or does not hide it. Weapons and snouts may
 * overhang the base a little, as a miniature's do. The limit is enforced at assembly.
 *
 * A figure is two merged geometries in one. The armour is drawn in the side's colour and the accent
 * (tracks, weapons, visors, claws) in gunmetal, which is what makes a tank read as a tank rather
 * than a coloured brick. Within each, every part carries a tone as a vertex colour: a multiplier on
 * the material's colour, so that a helmet and a pauldron come out a shade lighter than the chest, a
 * knee joint and a tabard a good deal darker, a track darker than a gun barrel, and a visor red.
 * The tones cost nothing at draw time and need no extra materials. Boxes are drawn with a small
 * chamfer, since a bevelled edge catches the light and a sharp one does not.
 *
 * Parts may overlap freely. The merge costs nothing at draw time.
 */

import { BufferAttribute, BufferGeometry, ConeGeometry, CylinderGeometry, ExtrudeGeometry, Quaternion, Shape, SphereGeometry, TorusGeometry, Vector3 } from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { ModelHull } from "@grimstat/board";
import { footReach, inches } from "@grimstat/board";
import { UNIT_CLASS_IDS, unitClassFor, type UnitClassId } from "./unitArt";

/** The classes a figure exists for: the same classes the unit pictures use. */
export type SilhouetteId = UnitClassId;
export const SILHOUETTE_IDS: readonly SilhouetteId[] = UNIT_CLASS_IDS;

/** Which figure stands for a unit, from its keywords: the picture's class rule, applied to the model. */
export const silhouetteFor = (keywords: readonly string[]): SilhouetteId => unitClassFor(keywords);

/** How much of the base disc's radius a figure fills. The rest is the rim of the base. */
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
 * the facing the base's own elongation or the figure's, whichever is more. A tank on a round base
 * keeps its length and overhangs rather than being squashed into a cube.
 */
export function figureScale(id: SilhouetteId, hull: ModelHull): [number, number, number] {
  const r = hull.foot.r * SILHOUETTE_FIT;
  const stretch = footReach(hull.foot) / hull.foot.r;
  return [r * Math.max(stretch, NOMINAL[id].stretch), hull.height, r];
}

/* ---- tones ---------------------------------------------------------------------------------- */

/** A part's tone: one multiplier on its material's colour, or one per channel for a tint. */
type Tone = number | readonly [number, number, number];

/* Armour tones, as shades of the side's colour. */
/** An armour plate, in the side's colour as it is. Parts left unshaded get this. */
const PLATE = 1;
/** A plate meant to catch the eye: a helmet, a pauldron, a hatch. */
const LIGHT = 1.2;
/** A secondary panel: a power pack, a track guard, a boot. */
const PANEL = 0.74;
/** The soft undersuit at a joint, and cloth: a tabard, a cape. */
const SUIT = 0.45;

/* Accent tones, as shades of gunmetal. */
/** Bright steel: a blade, a piston. */
const STEEL = 1.6;
/** Rubber and track: darker than a gun. */
const DARK = 0.68;
/** A red lens or visor. */
const LENS: Tone = [3.4, 0.7, 0.6];
/** Canopy glass. */
const GLASS: Tone = [0.9, 1.25, 1.7];
/** A headlamp. */
const LAMP: Tone = [2.6, 2.3, 1.6];

/** Paint parts a tone of their material's colour, as a vertex colour on every vertex. Returns the parts. */
function shade(tone: Tone, ...parts: BufferGeometry[]): BufferGeometry[] {
  const [r, g, b] = typeof tone === "number" ? [tone, tone, tone] : tone;
  for (const part of parts) {
    const count = part.getAttribute("position").count;
    const colours = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      colours[i * 3] = r;
      colours[i * 3 + 1] = g;
      colours[i * 3 + 2] = b;
    }
    part.setAttribute("color", new BufferAttribute(colours, 3));
  }
  return parts;
}

/* ---- primitives, placed --------------------------------------------------------------------- */

type P3 = readonly [number, number, number];
const HALF = Math.PI / 2;
const UP = new Vector3(0, 1, 0);

/** The largest chamfer a box gets, in inches. A smaller box gets a fifth of its thinnest side. */
const CHAMFER = 0.045;

/**
 * A box `w` along x, `h` along y, `d` along z, centred at `(x, y, z)`, with chamfered edges.
 * `tilt` leans its top forward (+x); `turn` spins it about y; `roll` leans its top across (+z).
 */
function box(w: number, h: number, d: number, x: number, y: number, z: number, tilt = 0, turn = 0, roll = 0): BufferGeometry {
  const g = new RoundedBoxGeometry(w, h, d, 1, Math.min(CHAMFER, 0.2 * Math.min(w, h, d)));
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

/** A cylinder lying along x (a barrel, an engine) `length` long, centred at `(x, y, z)`. */
function barrel(r: number, length: number, x: number, y: number, z: number, segments = 8): BufferGeometry {
  return new CylinderGeometry(r, r, length, segments).rotateZ(HALF).translate(x, y, z);
}

/** A wheel: a cylinder with its axle along z. */
function wheel(r: number, width: number, x: number, y: number, z: number): BufferGeometry {
  return new CylinderGeometry(r, r, width, 16).rotateX(HALF).translate(x, y, z);
}

/** A ring lying flat, of radius `r` and thickness `tube`, centred at `(x, y, z)`: a pauldron rim, a hatch ring. */
function ring(r: number, tube: number, x: number, y: number, z: number): BufferGeometry {
  return new TorusGeometry(r, tube, 6, 18).rotateX(HALF).translate(x, y, z);
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
 * A tapered cylinder from `a` to `b` (a limb, a neck, a tail segment, a lance), `rA` thick at `a`
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

/** A rounded-rectangle profile (a tank track seen from the side) `length` by `height`, corners `r`. */
function trackShape(length: number, height: number, r: number): (readonly [number, number])[] {
  const pts: [number, number][] = [];
  const cx = length / 2 - r;
  const cy = height / 2 - r;
  const corners: [number, number, number][] = [[cx, cy, 0], [-cx, cy, HALF], [-cx, -cy, Math.PI], [cx, -cy, 3 * HALF]];
  for (const [x, y, start] of corners) for (let i = 0; i <= 4; i++) pts.push([x + r * Math.cos(start + (i / 4) * HALF), y + r * Math.sin(start + (i / 4) * HALF)]);
  return pts;
}

/** A row of road wheels on the outer face of a track, one at each `x`, of radius `r` and `width` proud of the track. */
function roadWheels(r: number, width: number, xs: readonly number[], y: number, z: number): BufferGeometry[] {
  return xs.map((x) => wheel(r, width, x, y, z));
}

/** A half-cylinder shell over a wheel (a mudguard) of radius `r`, `width` across, axle at `(x, y)`. */
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

/**
 * Parts designed at the origin and pointing along +x, put in place: tilted about z (a positive
 * tilt points the +x end down), turned about y, then moved. A weapon is designed once this way and
 * held in as many poses as there are.
 */
function placed(parts: readonly BufferGeometry[], x: number, y: number, z: number, tilt = 0, turn = 0): BufferGeometry[] {
  return parts.map((g) => {
    if (tilt) g.rotateZ(-tilt);
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

/** A whole figure designed at the origin, put in place: see `placed`. */
const place = (f: Figure, x: number, y: number, z: number, tilt = 0, turn = 0): Figure => ({ armour: placed(f.armour, x, y, z, tilt, turn), accent: placed(f.accent, x, y, z, tilt, turn) });

/**
 * A trooper's body from the waist up, two inches tall standing, in the heavy powered plate the
 * setting is known for: a barrel chest with a raised breastplate, oversized pauldrons with a trim
 * ring, a snouted helm with a red visor, a tabard from the belt with a pouch either side, a power
 * pack on the back with twin vents. No arms. They depend on what the figure is doing with them.
 */
function torso(): Figure {
  return {
    armour: [
      ...shade(SUIT, post(0.2, 0.2, 0.2, 0, 0.98, 0)),
      box(0.46, 0.55, 0.62, 0.02, 1.32, 0),
      ...shade(LIGHT, blob(0.28, 0.2, 1.36, 0, 0.6, 0.9, 1.05)),
      ...shade(LIGHT, ...both(blob(0.25, 0.02, 1.6, 0.4, 1, 0.75, 1))),
      ...shade(SUIT, post(0.08, 0.08, 0.12, 0.02, 1.64, 0)),
      blob(0.17, 0.03, 1.83, 0),
      ...shade(PANEL, box(0.26, 0.5, 0.5, -0.34, 1.32, 0), blob(0.24, -0.34, 1.57, 0, 0.55, 0.6, 1)),
      ...shade(SUIT, box(0.06, 0.45, 0.24, 0.06, 0.75, 0)),
      ...shade(PANEL, ...both(box(0.1, 0.13, 0.12, 0.1, 0.97, 0.17))),
    ],
    accent: [
      post(0.21, 0.21, 0.08, 0, 1.02, 0),
      ...both(ring(0.25, 0.02, 0.02, 1.6, 0.4), post(0.06, 0.06, 0.24, -0.36, 1.68, 0.17, 6)),
      box(0.12, 0.12, 0.16, 0.17, 1.78, 0),
      ...shade(LENS, box(0.06, 0.06, 0.24, 0.17, 1.9, 0)),
    ],
  };
}

/** Striding legs in greaves, the left forward: dark knee joints under a knee pad, boots with a sole. */
function legs(): Figure {
  const knee = (at: P3): BufferGeometry[] => [...shade(SUIT, joint(0.11, at)), blob(0.1, at[0] + 0.06, at[1] + 0.01, at[2], 0.8, 1.1, 1)];
  return {
    armour: [
      limb([0, 0.95, 0.15], [0.12, 0.5, 0.18], 0.13, 0.11),
      limb([0.12, 0.5, 0.18], [0.18, 0.1, 0.19], 0.12, 0.1),
      ...knee([0.12, 0.5, 0.18]),
      ...shade(PANEL, box(0.36, 0.12, 0.22, 0.22, 0.06, 0.2)),
      limb([0, 0.95, -0.15], [-0.08, 0.5, -0.18], 0.13, 0.11),
      limb([-0.08, 0.5, -0.18], [-0.12, 0.1, -0.19], 0.12, 0.1),
      ...knee([-0.08, 0.5, -0.18]),
      ...shade(PANEL, box(0.36, 0.12, 0.22, -0.08, 0.06, -0.2)),
    ],
    accent: shade(DARK, box(0.36, 0.03, 0.22, 0.22, 0.015, 0.2), box(0.36, 0.03, 0.22, -0.08, 0.015, -0.2)),
  };
}

/** An arm from `shoulder` through `elbow` to `hand`, the elbow in the dark undersuit and the hand gauntleted. */
function arm(shoulder: P3, elbow: P3, hand: P3): BufferGeometry[] {
  return [limb(shoulder, elbow, 0.1, 0.085), limb(elbow, hand, 0.085, 0.075), ...shade(SUIT, joint(0.09, elbow)), ...shade(PANEL, joint(0.075, hand))];
}

/**
 * A rifle of the setting's boxy pattern, designed pointing along +x and centred on its receiver: a
 * grip and a magazine below, a short barrel with a muzzle, a stub of stock behind. One design, held
 * three ways by the poses below.
 */
function rifle(): BufferGeometry[] {
  return [
    box(0.42, 0.16, 0.14, 0, 0, 0),
    ...shade(DARK, box(0.1, 0.18, 0.1, -0.08, -0.13, 0), box(0.1, 0.09, 0.05, -0.25, -0.02, 0)),
    box(0.07, 0.15, 0.07, 0.07, -0.12, 0),
    barrel(0.03, 0.16, 0.27, 0.03, 0.03, 6),
    barrel(0.045, 0.05, 0.315, 0.03, 0.03, 6),
  ];
}

/**
 * A trooper, in one of three poses.
 *
 * A squad is five or ten models, and ten copies of one pose facing one way is a row of toy
 * soldiers rather than a unit. The poses differ only from the waist up. The torso, the legs and the
 * helmet are the same and at the same height, so every one of them still tops out at exactly the
 * height the kernel measured with.
 *
 * `0` carries the gun across the body at the ready, `1` has it shouldered and aimed, `2` has it
 * lowered at the hip with the off hand raised.
 */
function trooper(pose = 0): Figure {
  const held: Figure[] = [
    {
      armour: [...arm([0.02, 1.52, 0.4], [0.2, 1.18, 0.4], [0.41, 1.28, 0.1]), ...arm([0.02, 1.52, -0.4], [0.12, 1.16, -0.36], [0.15, 1.27, -0.06])],
      accent: placed(rifle(), 0.28, 1.31, 0.02, 0, -0.5),
    },
    {
      // Aimed: the right hand back at the grip, the left thrown forward under the barrel.
      armour: [...arm([0.02, 1.52, -0.4], [-0.14, 1.22, -0.46], [0.2, 1.34, -0.2]), ...arm([0.02, 1.52, 0.4], [0.26, 1.3, 0.28], [0.46, 1.36, 0.08])],
      accent: placed(rifle(), 0.31, 1.38, -0.04, 0, -0.14),
    },
    {
      // Lowered: the gun carried at the hip, the free arm up as if calling the advance on.
      armour: [...arm([0.02, 1.52, -0.4], [-0.02, 1.14, -0.46], [0.22, 1.0, -0.32]), ...arm([0.02, 1.52, 0.4], [0.16, 1.22, 0.48], [0.3, 1.48, 0.42])],
      accent: placed(rifle(), 0.28, 1.04, -0.3, 0.22, -0.26),
    },
  ];
  // Every pose has to stay inside the overhang. A pose that reached further would be scaled down to
  // fit at assembly, and the squad would have men of two sizes. The tests check this for each pose.
  return merge(torso(), legs(), held[pose % held.length]!);
}

/**
 * A walker in the manner of the setting's armoured dreadnoughts, in one of two poses: thick
 * reverse-jointed legs on broad clawed feet, with shin guards, thigh plates and a piston behind
 * each shin, a wide pelvis, a broad sarcophagus torso with a raised face plate and a red vision
 * slit, a sensor block and twin exhausts on top, heavy shoulder blocks, a four-barrelled gun hung
 * from one shoulder and a power fist with an under-slung flamer from the other.
 *
 * The upper body is designed about the waist and set on the legs turned, so `0` faces square on
 * with the gun level and the fist closed, and `1` is turned a little at the waist with the gun
 * raised to fire and the fist swung forward and open. The turn is about the base's own axis, so
 * it changes no reach.
 */
function walker(pose = 0): Figure {
  const legs: Figure = {
    armour: [
      ...both(
        ...shade(PANEL, box(0.95, 0.22, 0.6, 0.12, 0.11, 0.6)),
        limb([0.05, 0.28, 0.6], [0.38, 1.22, 0.6], 0.2, 0.22),
        box(0.3, 0.8, 0.5, 0.35, 0.7, 0.6, 0.34),
        ...shade(SUIT, joint(0.25, [0.38, 1.22, 0.6])),
        ...shade(LIGHT, blob(0.2, 0.52, 1.24, 0.6, 0.8, 1.05, 1)),
        limb([0.38, 1.22, 0.6], [-0.08, 2.0, 0.55], 0.24, 0.27),
        box(0.34, 0.75, 0.56, 0.29, 1.69, 0.58, -0.53),
        ...shade(SUIT, blob(0.3, -0.08, 2.0, 0.55)),
      ),
      ...shade(PANEL, box(0.9, 0.5, 1.5, -0.05, 2.15, 0)),
      ...shade(SUIT, post(0.45, 0.5, 0.25, 0, 2.45, 0, 12)),
    ],
    accent: [
      ...both(
        box(0.24, 0.18, 0.15, 0.7, 0.09, 0.4),
        box(0.24, 0.18, 0.15, 0.7, 0.09, 0.6),
        box(0.24, 0.18, 0.15, 0.7, 0.09, 0.8),
        box(0.2, 0.2, 0.42, -0.4, 0.1, 0.6),
        ...shade(STEEL, limb([-0.3, 0.4, 0.6], [-0.1, 0.85, 0.6], 0.045, 0.045, 6)),
        ...shade(DARK, limb([-0.1, 0.85, 0.6], [0.08, 1.28, 0.6], 0.085, 0.085, 8)),
      ),
    ],
  };
  // The upper body, about the waist: local y = 0 is the waist, local x = 0 the base's axis.
  const torso: Figure = {
    armour: [
      hull([[-0.7, 0], [0.6, 0], [0.82, 0.3], [0.78, 1.15], [0.55, 1.25], [-0.6, 1.25], [-0.85, 0.75]], 1.5, 0, 0.06),
      ...shade(LIGHT, box(0.1, 0.7, 0.95, 0.83, 0.62, 0), box(0.5, 0.28, 0.6, 0.2, 1.36, 0)),
      ...both(box(0.7, 0.6, 0.45, 0.02, 0.85, 0.78), ...shade(LIGHT, box(0.72, 0.08, 0.47, 0.02, 1.18, 0.78)), ...shade(SUIT, blob(0.22, 0.02, 0.5, 0.78))),
    ],
    accent: [
      ...shade(LENS, box(0.05, 0.12, 0.62, 0.9, 0.78, 0), box(0.05, 0.1, 0.38, 0.46, 1.4, 0)),
      ...shade(DARK, box(0.05, 0.08, 0.4, 0.9, 0.42, 0)),
      ...shade(1.2, ...both(post(0.09, 0.09, 0.55, -0.6, 1.225, 0.38, 6))),
    ],
  };
  // The arms hang from the shoulder joints, designed pointing forward and placed with the pose's tilt.
  const gun: Figure = {
    armour: shade(PANEL, box(0.55, 0.42, 0.38, 0.3, -0.18, 0)),
    accent: [
      ...shade(DARK, wheel(0.14, 0.2, 0.15, -0.48, 0)),
      barrel(0.16, 0.08, 0.6, -0.1, 0, 10),
      barrel(0.05, 0.42, 0.66, -0.01, -0.09, 6),
      barrel(0.05, 0.42, 0.66, -0.01, 0.09, 6),
      barrel(0.05, 0.42, 0.66, -0.19, -0.09, 6),
      barrel(0.05, 0.42, 0.66, -0.19, 0.09, 6),
    ],
  };
  const fist = (open: number): Figure => ({
    armour: shade(PANEL, box(0.5, 0.42, 0.38, 0.28, -0.18, 0), box(0.28, 0.32, 0.32, 0.62, -0.22, 0)),
    accent: [
      box(0.24, 0.07, 0.07, 0.76, -0.1, -0.1, -open),
      box(0.24, 0.07, 0.07, 0.76, -0.1, 0, -open),
      box(0.24, 0.07, 0.07, 0.76, -0.1, 0.1, -open),
      box(0.22, 0.07, 0.07, 0.74, -0.36, 0, open + 0.2),
      barrel(0.045, 0.3, 0.45, -0.44, 0.12, 6),
    ],
  });
  const square = pose % 2 === 0;
  const upper = merge(torso, place(gun, 0.02, 0.5, 0.78, square ? 0 : -0.45), place(fist(square ? 0.2 : 0.5), 0.02, 0.5, -0.78, square ? 0 : 0.3));
  return merge(legs, place(upper, 0, 2.5, 0, 0, square ? 0 : 0.2));
}

/**
 * A war beast, in one of two poses: a deep-chested body on four legs with dark lower legs, a
 * snouted head with pricked ears and red eyes, a collar, a raised tail. `0` stands, `1` lunges
 * forward with the head low and the legs stretched. The tail is raised in both, since it is the
 * highest point of the figure and the two poses have to be the same height.
 */
function beast(pose = 0): Figure {
  if (pose % 2 === 0) {
    return {
      armour: [
        ...both(
          limb([0.4, 0.95, 0.2], [0.45, 0.45, 0.22], 0.09, 0.07),
          ...shade(PANEL, limb([0.45, 0.45, 0.22], [0.5, 0.06, 0.22], 0.07, 0.06)),
          limb([-0.4, 0.95, 0.2], [-0.6, 0.5, 0.22], 0.11, 0.08),
          ...shade(PANEL, limb([-0.6, 0.5, 0.22], [-0.5, 0.06, 0.22], 0.08, 0.06)),
        ),
        blob(0.32, 0, 1.15, 0, 1.8, 0.85, 0.9),
        ...shade(LIGHT, blob(0.3, 0.35, 1.1, 0, 1.1, 1.05, 1)),
        blob(0.28, -0.4, 1.15, 0),
        limb([0.55, 1.35, 0], [0.8, 1.6, 0], 0.16, 0.14),
        blob(0.18, 0.85, 1.62, 0, 1.1, 0.9, 0.9),
        ...shade(PANEL, box(0.24, 0.16, 0.18, 0.95, 1.55, 0)),
        limb([-0.6, 1.25, 0], [-0.85, 1.6, 0.05], 0.07, 0.05),
        limb([-0.85, 1.6, 0.05], [-0.95, 1.95, 0.08], 0.05, 0.02),
      ],
      accent: [
        ...both(blob(0.08, 0.52, 0.05, 0.22, 1.4, 0.6, 1.1), blob(0.08, -0.48, 0.05, 0.22, 1.4, 0.6, 1.1), spike(0.05, 0.2, 0.78, 1.76, 0.1, -0.3), ...shade(LENS, blob(0.03, 1.0, 1.68, 0.11))),
        limb([0.58, 1.38, 0], [0.64, 1.44, 0], 0.19, 0.19, 12),
        ...shade(DARK, blob(0.045, 1.02, 1.62, 0)),
      ],
    };
  }
  return {
    armour: [
      ...both(
        limb([0.4, 0.85, 0.2], [0.72, 0.55, 0.22], 0.09, 0.07),
        ...shade(PANEL, limb([0.72, 0.55, 0.22], [0.82, 0.06, 0.22], 0.07, 0.06)),
        limb([-0.4, 0.85, 0.2], [-0.72, 0.5, 0.22], 0.11, 0.08),
        ...shade(PANEL, limb([-0.72, 0.5, 0.22], [-0.9, 0.06, 0.22], 0.08, 0.06)),
      ),
      blob(0.32, 0.05, 1.0, 0, 1.9, 0.8, 0.9),
      ...shade(LIGHT, blob(0.3, 0.45, 0.95, 0, 1.15, 1, 1)),
      blob(0.28, -0.45, 1.05, 0),
      limb([0.6, 1.15, 0], [0.82, 1.25, 0], 0.16, 0.14),
      blob(0.18, 0.86, 1.27, 0, 1.1, 0.9, 0.9),
      ...shade(PANEL, box(0.24, 0.16, 0.18, 0.95, 1.2, 0)),
      limb([-0.65, 1.15, 0], [-0.85, 1.55, 0.05], 0.07, 0.05),
      limb([-0.85, 1.55, 0.05], [-0.95, 1.95, 0.08], 0.05, 0.02),
    ],
    accent: [
      ...both(blob(0.08, 0.84, 0.05, 0.22, 1.4, 0.6, 1.1), blob(0.08, -0.88, 0.05, 0.22, 1.4, 0.6, 1.1), spike(0.05, 0.2, 0.79, 1.41, 0.1, -0.3), ...shade(LENS, blob(0.03, 1.0, 1.33, 0.11))),
      limb([0.62, 1.16, 0], [0.68, 1.19, 0], 0.19, 0.19, 12),
      ...shade(DARK, blob(0.045, 1.02, 1.27, 0)),
    ],
  };
}

/**
 * A swarm, in one of two arrangements: small creatures over the base and a heap of them in the
 * middle, one rearing on top. The second arrangement is the first turned half way round, so two
 * bases side by side are not the same base twice.
 */
function swarm(variant = 0): Figure {
  const flip = variant % 2 ? -1 : 1;
  const spin = variant % 2 ? Math.PI : 0;
  const critter = (x: number, z: number, turn: number, size: number, tone: Tone, y = 0, rear = 0): Figure => {
    const body = [...shade(tone, blob(0.1, 0, 0.1, 0, 1.5, 0.8, 1)), ...shade(LIGHT, blob(0.065, 0.15, 0.115, 0))];
    const legs = both(limb([0.045, 0.08, 0.06], [0.12, 0, 0.16], 0.015, 0.008, 5), limb([-0.045, 0.08, 0.06], [-0.12, 0, 0.16], 0.015, 0.008, 5), spike(0.015, 0.05, 0.19, 0.11, 0.03, HALF));
    const pose = (g: BufferGeometry) => (rear ? g.rotateZ(rear) : g);
    return { armour: moved(body.map(pose), flip * x, y, flip * z, size, turn + spin), accent: moved(legs.map(pose), flip * x, y, flip * z, size, turn + spin) };
  };
  const critters = [
    critter(0.42, 0.22, 0.4, 1, PLATE),
    critter(-0.38, 0.3, 2.5, 0.9, 1.08),
    critter(0.08, -0.47, -1.2, 1, PLATE),
    critter(-0.42, -0.22, -2.6, 0.95, 1.08),
    critter(0.45, -0.2, 0.9, 0.85, PLATE),
    critter(-0.08, 0.5, 1.8, 0.9, 1.08),
    critter(0.03, 0.2, 0.2, 1.3, PLATE, 0.3, 0.85),
  ];
  return merge({ armour: shade(PANEL, blob(0.3, 0, 0.18, 0, 1.1, 0.6, 1.1)), accent: [] }, ...critters);
}

/**
 * A bike, in one of two poses: fat tyres, a faired body with twin guns and a headlamp, exhausts,
 * and a rider. `0` leans over the bars, `1` sits up and fires a pistol forward.
 */
function bike(pose = 0): Figure {
  const machine: Figure = {
    armour: [
      ...shade(PANEL, wheel(0.17, 0.3, 0.85, 0.44, 0), wheel(0.17, 0.3, -0.85, 0.44, 0)),
      mudguard(0.5, 0.34, 0.85, 0.44),
      hull([[-0.7, 0.5], [0.45, 0.5], [0.7, 0.75], [0.55, 1.05], [0.15, 0.95], [-0.3, 0.88], [-0.75, 0.85]], 0.6, 0, 0.04),
    ],
    accent: [
      ...shade(DARK, wheel(0.42, 0.28, 0.85, 0.44, 0), wheel(0.42, 0.28, -0.85, 0.44, 0), box(0.45, 0.08, 0.4, -0.3, 0.92, 0)),
      box(0.5, 0.3, 0.7, 0.05, 0.62, 0),
      box(0.06, 0.06, 0.85, 0.52, 1.18, 0),
      ...shade(LAMP, blob(0.06, 0.7, 0.9, 0, 0.5, 1, 1)),
      ...both(barrel(0.045, 0.5, 1.05, 0.85, 0.17, 6), ...shade(1.2, barrel(0.06, 0.6, -0.95, 0.68, 0.28, 6))),
    ],
  };
  const legs = both(limb([-0.3, 1, 0.22], [0.05, 0.85, 0.32], 0.11, 0.09), ...shade(PANEL, limb([0.05, 0.85, 0.32], [-0.1, 0.55, 0.36], 0.09, 0.08)));
  if (pose % 2 === 0) {
    return merge(machine, {
      armour: [
        box(0.36, 0.5, 0.46, -0.12, 1.32, 0, 0.55),
        ...both(...shade(LIGHT, blob(0.18, 0.03, 1.5, 0.32, 1, 0.75, 1)), limb([0.03, 1.45, 0.32], [0.5, 1.2, 0.32], 0.08, 0.07)),
        ...legs,
        blob(0.16, 0.22, 1.84, 0),
        ...shade(PANEL, box(0.22, 0.36, 0.42, -0.38, 1.3, 0, 0.55)),
      ],
      accent: shade(LENS, box(0.1, 0.1, 0.2, 0.37, 1.84, 0)),
    });
  }
  return merge(machine, {
    armour: [
      box(0.36, 0.5, 0.46, -0.16, 1.36, 0, 0.3),
      ...both(...shade(LIGHT, blob(0.18, -0.03, 1.56, 0.32, 1, 0.75, 1))),
      limb([-0.03, 1.5, 0.32], [0.5, 1.2, 0.32], 0.08, 0.07),
      limb([-0.03, 1.5, -0.32], [0.25, 1.45, -0.36], 0.08, 0.07),
      limb([0.25, 1.45, -0.36], [0.55, 1.5, -0.3], 0.07, 0.065),
      ...shade(PANEL, joint(0.07, [0.55, 1.5, -0.3])),
      ...legs,
      ...shade(SUIT, post(0.06, 0.06, 0.1, 0, 1.66, 0)),
      blob(0.16, 0.04, 1.84, 0),
      ...shade(PANEL, box(0.22, 0.36, 0.42, -0.4, 1.34, 0, 0.3)),
    ],
    accent: [...shade(LENS, box(0.1, 0.1, 0.2, 0.19, 1.84, 0)), box(0.16, 0.09, 0.06, 0.66, 1.53, -0.3), barrel(0.025, 0.1, 0.78, 1.55, -0.3, 6)],
  });
}

/**
 * A rider on a mount, in one of two poses: a deep-chested quadruped, a saddle, a rider with a lance
 * and pennant. `0` has the mount's head up and all four hooves down, `1` has its head down, a
 * foreleg raised, and the rider's free arm pointing the way.
 */
function mounted(pose = 0): Figure {
  const still = pose % 2 === 0;
  const rider: Figure = {
    armour: [
      ...both(...shade(LIGHT, blob(0.16, -0.05, 2.32, 0.28, 1, 0.75, 1)), limb([-0.05, 1.9, 0.18], [0.2, 1.6, 0.32], 0.09, 0.08), ...shade(PANEL, limb([0.2, 1.6, 0.32], [0.12, 1.15, 0.36], 0.08, 0.07))),
      box(0.32, 0.48, 0.42, -0.05, 2.1, 0),
      blob(0.15, -0.03, 2.55, 0),
      ...shade(PANEL, box(0.2, 0.3, 0.36, -0.28, 2.1, 0)),
      limb([-0.05, 2.28, 0.3], [0.25, 2, 0.3], 0.07, 0.06),
      ...(still ? [limb([-0.05, 2.28, -0.3], [0.35, 2.05, -0.15], 0.07, 0.06)] : [limb([-0.05, 2.28, -0.3], [0.4, 2.35, -0.28], 0.07, 0.06), ...shade(PANEL, joint(0.065, [0.4, 2.35, -0.28]))]),
      ...shade(LIGHT, box(0.3, 0.14, 0.02, 0.85, 2.75, 0.27)),
    ],
    accent: [...shade(DARK, box(0.45, 0.1, 0.45, -0.05, 1.78, 0)), ...shade(LENS, box(0.08, 0.07, 0.18, 0.11, 2.54, 0)), limb([-0.55, 1.6, 0.32], [1.15, 2.95, 0.25], 0.035, 0.012, 6)],
  };
  const hoof = (x: number, y: number, z: number): BufferGeometry => post(0.075, 0.075, 0.1, x, y, z, 6);
  const foreleg = (raised: boolean): Figure =>
    raised
      ? { armour: [limb([0.4, 1.2, 0.2], [0.65, 0.85, 0.22], 0.09, 0.07), ...shade(PANEL, limb([0.65, 0.85, 0.22], [0.55, 0.6, 0.22], 0.07, 0.06))], accent: [hoof(0.55, 0.57, 0.22)] }
      : { armour: [limb([0.4, 1.2, 0.2], [0.48, 0.6, 0.22], 0.09, 0.07), ...shade(PANEL, limb([0.48, 0.6, 0.22], [0.5, 0.06, 0.22], 0.07, 0.06))], accent: [hoof(0.5, 0.05, 0.22)] };
  const near = foreleg(!still);
  const far = foreleg(false);
  const mount: Figure = {
    armour: [
      ...near.armour,
      ...far.armour.map(mirror),
      ...both(limb([-0.42, 1.25, 0.2], [-0.55, 0.65, 0.22], 0.11, 0.08), ...shade(PANEL, limb([-0.55, 0.65, 0.22], [-0.48, 0.06, 0.22], 0.08, 0.06))),
      blob(0.36, 0, 1.45, 0, 2, 0.85, 1),
      ...shade(LIGHT, blob(0.3, 0.4, 1.45, 0, 1.2, 1, 1)),
      blob(0.3, -0.42, 1.5, 0),
      ...(still ? [limb([0.6, 1.75, 0], [0.9, 2.25, 0], 0.15, 0.12), ...shade(PANEL, box(0.4, 0.18, 0.16, 1.02, 2.3, 0, 0.5))] : [limb([0.6, 1.75, 0], [0.92, 2.0, 0], 0.15, 0.12), ...shade(PANEL, box(0.4, 0.18, 0.16, 1.02, 1.95, 0, 0.9))]),
      ...(still ? [limb([-0.75, 1.6, 0], [-1.05, 1, 0.05], 0.06, 0.03)] : [limb([-0.75, 1.6, 0], [-1.0, 1.35, 0.15], 0.06, 0.03)]),
    ],
    accent: [...near.accent, ...far.accent.map(mirror), ...both(hoof(-0.48, 0.05, 0.22), spike(0.04, 0.14, still ? 0.92 : 0.92, still ? 2.38 : 2.12, 0.07))],
  };
  return merge(mount, rider);
}

const FIGURES: Readonly<Record<SilhouetteId, () => Figure>> = {
  infantry: trooper,

  /** The trooper made a hero: a little larger, caped, a crest on the helm, a blade raised high. */
  character: () => {
    const t = trooper();
    const f = merge({ armour: moved(t.armour, 0, 0, 0, 1.1), accent: moved(t.accent, 0, 0, 0, 1.1) });
    return merge(f, {
      armour: shade(SUIT, new CylinderGeometry(0.16, 0.46, 0.95, 14, 1, true, HALF, Math.PI).rotateY(-HALF).translate(-0.3, 1.25, 0)),
      accent: [...shade(STEEL, limb([0.17, 1.4, -0.07], [0.05, 2.5, -0.2], 0.04, 0.008, 6)), box(0.05, 0.05, 0.26, 0.15, 1.44, -0.08), ...shade(LENS, box(0.26, 0.1, 0.05, 0.03, 2.22, 0))],
    });
  },

  /** A battle tank of the setting's boxy pattern: tall tracks with road wheels, a hull gun in the glacis, the turret set back, sponsons, an engine grille. */
  vehicle: () => ({
    armour: [
      ...shade(PANEL, ...both(box(4, 0.2, 0.58, 0, 1.7, 0.95))),
      ...both(box(1.1, 0.55, 0.4, 0.3, 2.05, 1.2)),
      hull([[-1.85, 0.7], [1.4, 0.7], [2, 1.5], [1.6, 2.4], [-1.6, 2.4], [-1.85, 1.9]], 1.45, 0, 0.05),
      box(1.2, 0.25, 1.35, -1.2, 2.5, 0),
      post(0.6, 0.75, 0.8, -0.45, 2.8, 0, 12),
      ...shade(LIGHT, post(0.24, 0.24, 0.3, -0.7, 3.35, 0.3, 10)),
      ...shade(LIGHT, ...both(post(0.2, 0.2, 0.06, 0.95, 2.43, 0.42, 10))),
    ],
    accent: [
      ...shade(DARK, ...both(hull(trackShape(3.9, 1.6, 0.6), 0.5, 0.95).translate(0, 0.85, 0))),
      ...shade(1.2, ...both(...roadWheels(0.28, 0.06, [-1.2, -0.6, 0, 0.6, 1.2], 0.5, 1.23))),
      ...both(barrel(0.06, 0.5, 1.1, 2.05, 1.2, 6)),
      ...shade(1.2, ...both(post(0.08, 0.08, 0.35, -1.75, 2.6, 0.5, 6, -0.4))),
      ...shade(LAMP, ...both(box(0.08, 0.12, 0.18, 1.92, 1.9, 0.35))),
      ...shade(DARK, ...[-1.65, -1.45, -1.25, -1.05].map((x) => box(0.12, 0.05, 1, x, 2.65, 0))),
      box(0.35, 0.5, 0.55, 0.2, 2.8, 0),
      barrel(0.09, 1.7, 1.25, 2.85, 0),
      barrel(0.13, 0.18, 2.05, 2.85, 0),
      barrel(0.06, 0.5, 2, 1.95, -0.5, 6),
      post(0.2, 0.2, 0.05, -0.7, 3.475, 0.3, 10),
      barrel(0.04, 0.5, -0.25, 3.42, 0.3, 6),
      post(0.02, 0.02, 0.7, -1.5, 3.05, -0.6, 4),
    ],
  }),

  /** A carrier: the tank's tracks under a tall hull with a rear ramp, side doors, stowage, roof hatches, smoke launchers and a small turret. */
  transport: () => ({
    armour: [
      ...shade(PANEL, ...both(box(4, 0.2, 0.58, 0, 1.3, 0.95))),
      ...shade(LIGHT, ...both(box(0.6, 0.12, 0.55, -0.6, 2.9, 0.4))),
      hull([[-1.85, 0.7], [1.35, 0.7], [2, 1.55], [1.85, 2.85], [-1.6, 2.85], [-1.85, 2.1]], 1.5, 0, 0.05),
      post(0.35, 0.42, 0.4, 0.7, 3.05, 0, 12),
      ...shade(PANEL, ...both(box(0.9, 0.32, 0.14, -0.9, 2.3, 0.8), box(0.9, 1.1, 0.06, 0, 1.7, 0.76)), box(0.08, 1.7, 1.1, -1.87, 1.55, 0)),
    ],
    accent: [
      ...shade(DARK, ...both(hull(trackShape(3.9, 1.15, 0.5), 0.5, 0.95).translate(0, 0.625, 0))),
      ...shade(1.2, ...both(...roadWheels(0.2, 0.06, [-1.2, -0.6, 0, 0.6, 1.2], 0.38, 1.23))),
      // The seam down the side door, and the hinge along the top of the ramp.
      ...shade(DARK, ...both(box(0.04, 1.0, 0.02, 0, 1.7, 0.8)), box(0.06, 0.06, 1.14, -1.9, 2.42, 0)),
      ...shade(LAMP, ...both(box(0.08, 0.12, 0.18, 1.99, 1.75, 0.5))),
      ...both(barrel(0.045, 0.6, 1.25, 3.15, 0.08, 6)),
      ...both(...[0.5, 0.6, 0.7].map((z) => post(0.035, 0.035, 0.2, 1.72, 2.95, z, 6, 0.7))),
      ...shade(DARK, ...both(box(0.05, 0.08, 0.28, 1.9, 2.6, 0.35))),
      box(0.15, 0.25, 0.15, 0.5, 3.375, 0),
      post(0.02, 0.02, 0.6, -1.4, 3.1, -0.55, 4),
    ],
  }),

  walker,

  /** A monster of the hive: hunched on two clawed legs, a lower pair of arms reaching, an upper pair of scything talons, a crested head with red eyes, plated back, tail. */
  monster: () => ({
    armour: [
      ...both(
        limb([-0.3, 2.1, 0.45], [0.3, 1.25, 0.55], 0.26, 0.2),
        limb([0.3, 1.25, 0.55], [-0.1, 0.3, 0.6], 0.18, 0.14),
        ...shade(PANEL, joint(0.2, [0.3, 1.25, 0.55]), box(0.6, 0.28, 0.36, 0.1, 0.14, 0.6)),
        limb([0.55, 2.7, 0.55], [1.05, 2, 0.7], 0.17, 0.14),
        limb([1.05, 2, 0.7], [1.45, 1.2, 0.55], 0.14, 0.12),
        ...shade(PANEL, joint(0.15, [1.05, 2, 0.7])),
        limb([0.4, 2.9, 0.45], [0.85, 3.5, 0.8], 0.13, 0.09),
        ...shade(PANEL, joint(0.1, [0.85, 3.5, 0.8])),
      ),
      blob(0.75, -0.2, 2.45, 0, 1.35, 0.85, 1),
      ...shade(LIGHT, blob(0.55, 0.45, 2.1, 0, 1.1, 1, 0.95)),
      limb([0.85, 3.05, 0], [1.3, 3.55, 0], 0.26, 0.22),
      blob(0.3, 1.5, 3.6, 0, 1.2, 0.9, 1),
      ...shade(PANEL, box(0.5, 0.28, 0.34, 1.85, 3.5, 0)),
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
        ...shade(LENS, blob(0.04, 1.78, 3.68, 0.2)),
      ),
      box(0.45, 0.08, 0.3, 1.85, 3.34, 0, 0.15),
      box(0.55, 0.12, 0.7, 1.3, 3.92, 0, -0.45),
      ...shade(DARK, box(0.4, 0.08, 0.95, 0.4, 2.98, 0, 0.2), box(0.4, 0.08, 1, 0.05, 3.09, 0, 0.05), box(0.4, 0.08, 1, -0.3, 3.1, 0, -0.1), box(0.4, 0.08, 0.9, -0.65, 3.04, 0, -0.3)),
      spike(0.07, 0.3, 0.4, 3.02, 0, -0.35),
      spike(0.07, 0.3, 0.05, 3.13, 0, -0.35),
      spike(0.07, 0.3, -0.3, 3.14, 0, -0.35),
      spike(0.07, 0.3, -0.65, 3.08, 0, -0.35),
    ],
  }),

  beast,
  swarm,

  /** A gunship on its stand, blocky as the setting's flyers are: a slab fuselage with a glazed canopy, stub wings carrying engines and missile pods, a tail fin, a nose gun. */
  aircraft: () => ({
    armour: [
      hull([[-0.95, 3.8], [0.7, 3.8], [1.05, 4.05], [1, 4.45], [0.5, 4.6], [-0.7, 4.6], [-0.95, 4.4]], 0.6, 0, 0.04),
      ...shade(PANEL, box(0.35, 0.55, 0.06, -0.8, 4.75, 0)),
      ...both(
        ...shade(PANEL, plate([[-0.3, 0.28], [0.35, 0.28], [0.2, 1.05], [-0.45, 1.05]], 0.08, 4.3), plate([[-0.95, 0.15], [-0.7, 0.15], [-0.75, 0.5], [-0.95, 0.5]], 0.05, 4.4)),
        ...shade(PANEL, barrel(0.16, 0.8, -0.1, 4.2, 0.75, 12)),
        box(0.5, 0.18, 0.22, -0.05, 4.05, 0.55),
      ),
    ],
    accent: [
      ...shade(DARK, post(0.15, 0.15, 0.05, -0.15, 0.025, 0, 12), post(0.04, 0.04, 3.6, -0.15, 1.85, 0, 6)),
      ...shade(GLASS, box(0.35, 0.22, 0.4, 0.75, 4.55, 0, 0.2)),
      barrel(0.04, 0.3, 1.1, 4, 0, 6),
      ...both(...shade(DARK, barrel(0.14, 0.06, 0.31, 4.2, 0.75, 12)), ...shade(1.2, barrel(0.13, 0.08, -0.52, 4.2, 0.75, 12), barrel(0.03, 0.12, 0.25, 4.02, 0.5, 6), barrel(0.03, 0.12, 0.25, 4.08, 0.6, 6))),
    ],
  }),

  bike,
  mounted,

  /**
   * A titan in the manner of the setting's knights: tall legs in greaves and thigh plates on
   * broad clawed feet, with a piston behind each shin, a pelvis with a groin plate, a torso under
   * a broad domed carapace, a rocket pod and twin stacks on the carapace, a masked head with a red
   * slit, pauldrons hanging over both arms, a cannon on one arm and a chain blade on the other,
   * and a tilting plate at the shoulder.
   */
  titanic: () => ({
    armour: [
      ...both(
        ...shade(PANEL, box(1.7, 0.45, 1.0, 0.15, 0.22, 1.05)),
        limb([0.1, 0.5, 1.05], [0.25, 2.7, 1.0], 0.32, 0.36),
        box(0.6, 1.9, 0.85, 0.5, 1.6, 1.02, 0.07),
        ...shade(SUIT, joint(0.42, [0.25, 2.7, 1.0])),
        ...shade(LIGHT, blob(0.36, 0.55, 2.75, 1.0, 0.7, 1.05, 1)),
        limb([0.25, 2.7, 1.0], [-0.1, 4.25, 0.85], 0.38, 0.4),
        box(0.65, 1.35, 0.95, 0.37, 3.55, 0.92, -0.22),
        ...shade(SUIT, joint(0.45, [-0.1, 4.25, 0.85])),
        ...shade(LIGHT, box(1.3, 1.0, 0.45, 0.1, 6.0, 1.45, 0, 0, 0.12)),
        limb([0.1, 5.9, 1.45], [0.3, 5.1, 1.5], 0.3, 0.3),
        ...shade(SUIT, joint(0.32, [0.3, 5.1, 1.5])),
      ),
      ...shade(PANEL, box(1.3, 0.8, 2.3, -0.1, 4.55, 0)),
      box(0.12, 1.1, 0.7, 0.55, 4.1, 0),
      hull([[-0.9, 4.9], [0.85, 4.9], [1.15, 5.6], [1.0, 6.4], [-0.9, 6.4], [-1.15, 5.7]], 1.9, 0, 0.06),
      ...shade(PANEL, box(2.6, 0.35, 3.0, -0.25, 6.55, 0, -0.08), box(1.0, 0.55, 0.8, -0.5, 6.95, 1.0)),
      ...shade(LIGHT, blob(1.5, -0.25, 6.6, 0, 0.9, 0.35, 1), box(0.75, 0.55, 0.8, 1.05, 5.95, 0), box(0.1, 1.2, 0.9, 1.25, 5.2, 0.8, 0.1)),
      box(1.6, 0.7, 0.7, 0.6, 5.0, -1.5),
      box(1.2, 0.7, 0.7, 0.5, 5.0, 1.5),
    ],
    accent: [
      ...both(
        box(0.4, 0.35, 0.28, 1.1, 0.17, 0.72),
        box(0.4, 0.35, 0.28, 1.1, 0.17, 1.05),
        box(0.4, 0.35, 0.28, 1.1, 0.17, 1.38),
        box(0.35, 0.4, 0.7, -0.85, 0.2, 1.05),
        ...shade(STEEL, limb([-0.35, 0.7, 1.05], [-0.2, 2.2, 1.02], 0.07, 0.07, 6)),
        ...shade(DARK, limb([-0.2, 2.2, 1.02], [-0.1, 2.55, 1.0], 0.13, 0.13, 8)),
        ...shade(1.2, post(0.16, 0.16, 0.7, -1.05, 6.85, 0.55, 8)),
      ),
      ...shade(DARK, ...[-0.2, 0, 0.2].flatMap((dz) => [barrel(0.09, 0.14, 0.02, 7.1, 1.0 + dz, 6), barrel(0.09, 0.14, 0.02, 6.8, 1.0 + dz, 6)])),
      ...shade(LENS, box(0.06, 0.14, 0.55, 1.44, 6.02, 0)),
      ...shade(DARK, box(0.06, 0.12, 0.4, 1.44, 5.8, 0), wheel(0.3, 0.3, 0.2, 4.6, -1.5)),
      barrel(0.2, 1.4, 1.9, 5.0, -1.5, 10),
      barrel(0.27, 0.25, 2.5, 5.0, -1.5, 10),
      ...shade(STEEL, box(1.6, 0.95, 0.12, 1.7, 5.0, 1.5)),
      ...shade(DARK, ...[1.2, 1.5, 1.8, 2.1, 2.4].map((x) => box(0.12, 0.12, 0.16, x, 5.53, 1.5))),
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
        ...shade(PANEL, ...ribs),
        ...shade(PANEL, new CylinderGeometry(2.65, 2.65, 0.2, 8).rotateY(Math.PI / 8).translate(0, 3.65, 0)),
        ...shade(LIGHT, box(1.6, 1, 1.6, -0.4, 4.25, 0)),
        post(0.65, 0.75, 0.7, 0.3, 5.1, 0, 8),
      ],
      accent: [
        ...shade(DARK, new CylinderGeometry(2.8, 2.8, 0.15, 8).rotateY(Math.PI / 8).translate(0, 0.075, 0), ...slits),
        ...shade(0.85, box(0.1, 1.6, 0.8, -2.27, 0.95, 0)),
        post(0.3, 0.3, 0.08, -0.7, 4.79, 0.35, 10),
        ...both(barrel(0.09, 1.4, 1.4, 5.2, 0.2, 6)),
        post(0.06, 0.06, 0.55, -0.1, 5.72, 0, 6),
        post(0.03, 0.03, 1.2, -1.5, 4.35, -1.2, 4),
      ],
    };
  },
};

/**
 * The poses of the classes that arrive several models to a unit.
 *
 * `FIGURES` holds the one figure every class has. A class listed here has alternatives to it, and
 * the entry at index `0` must be that same figure. A class not listed has one pose. A tank is a
 * tank, and there is nothing to vary.
 */
const POSES: Partial<Readonly<Record<SilhouetteId, readonly (() => Figure)[]>>> = {
  infantry: [() => trooper(0), () => trooper(1), () => trooper(2)],
  walker: [() => walker(0), () => walker(1)],
  beast: [() => beast(0), () => beast(1)],
  swarm: [() => swarm(0), () => swarm(1)],
  bike: [() => bike(0), () => bike(1)],
  mounted: [() => mounted(0), () => mounted(1)],
};

/** How many poses a class has. One, unless it is a class that turns up in numbers. */
export const poseCount = (id: SilhouetteId): number => POSES[id]?.length ?? 1;

/**
 * Which pose the `n`th model of a unit stands in.
 *
 * By position rather than by name, so a unit's ghost and its tokens agree without either of them
 * needing to know a model's id, and so a model keeps its pose for as long as it keeps its place.
 */
export const poseOf = (id: SilhouetteId, index: number): number => (index % poseCount(id) + poseCount(id)) % poseCount(id);

/* ---- assembly ------------------------------------------------------------------------------- */

/** What assembly measured of a figure, for the tests: its designed height in inches, and the squeeze the overhang rule applied (1 when none). */
export interface FigureMetrics {
  readonly height: number;
  readonly squeeze: number;
}

const cache = new Map<string, BufferGeometry>();
const metrics = new Map<string, FigureMetrics>();

const flat = (parts: readonly BufferGeometry[]): BufferGeometry => {
  const loose = parts.map((g) => (g.index ? g.toNonIndexed() : g));
  // Every part carries a tone, so that the merge has the same attributes on every part. A part
  // nobody shaded is in its material's colour as it is.
  for (const g of loose) if (!g.getAttribute("color")) shade(PLATE, g);
  const merged = mergeGeometries(loose, false) ?? new BufferGeometry();
  for (const g of loose) g.dispose();
  return merged;
};

/**
 * The merged geometry for a class, built once and shared by every model of that class.
 *
 * Two groups, armour then accent, so one mesh with two materials draws the whole figure. The
 * design rules are enforced here rather than trusted: feet on the ground, the top at exactly `y = 1`,
 * the base disc normalised to radius 1 with only the allowed overhang beyond it, whatever the
 * designer's arithmetic said. The result is never disposed. It is a handful of small geometries,
 * kept for the life of the page.
 */
export function silhouetteGeometry(id: SilhouetteId, pose = 0): BufferGeometry {
  const chosen = poseOf(id, pose);
  const key = `${id}:${chosen}`;
  let geometry = cache.get(key);
  if (!geometry) {
    const figure = (POSES[id]?.[chosen] ?? FIGURES[id])();
    const armour = flat(figure.armour);
    const accent = flat(figure.accent);
    const all = mergeGeometries([armour, accent], true) ?? new BufferGeometry();
    armour.dispose();
    accent.dispose();
    all.computeBoundingBox();
    const box = all.boundingBox!;
    if (box.min.y < 0) all.translate(0, -box.min.y, 0);
    const height = Math.max(box.max.y - Math.min(0, box.min.y), 1e-6);
    const nominal = NOMINAL[id];
    const fit = nominal.r * SILHOUETTE_FIT;
    all.scale(1 / (fit * nominal.stretch), 1 / height, 1 / fit);
    const pos = all.getAttribute("position");
    let reach = 0;
    for (let i = 0; i < pos.count; i++) reach = Math.max(reach, Math.hypot(pos.getX(i), pos.getZ(i)));
    const squeeze = reach > SILHOUETTE_OVERHANG ? SILHOUETTE_OVERHANG / reach : 1;
    if (squeeze < 1) all.scale(squeeze, 1, squeeze);
    all.computeBoundingBox();
    geometry = all;
    cache.set(key, geometry);
    metrics.set(key, { height, squeeze });
  }
  return geometry;
}

/** What assembly measured of a figure. Builds the figure if it has not been built yet. */
export function figureMetrics(id: SilhouetteId, pose = 0): FigureMetrics {
  silhouetteGeometry(id, pose);
  return metrics.get(`${id}:${poseOf(id, pose)}`)!;
}
