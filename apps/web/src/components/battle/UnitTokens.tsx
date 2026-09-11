import { memo, useEffect, useRef, type ReactNode } from "react";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { Color, DoubleSide, MeshStandardMaterial, type Group, type Material } from "three";
import type { ModelHull, Vec2, Vec3 } from "@grimstat/board";
import { footReach } from "@grimstat/board";
import type { BattleUnit } from "../../lib/battle";
import { SCENE_COLOURS, SIDE_COLOURS, fromScene, toScene } from "../../lib/battleScene";
import { ACCENT, ARMOUR, figureScale, silhouetteFor, silhouetteGeometry, type SilhouetteId } from "../../lib/silhouettes";

/**
 * Where each model's token is right now, mid-animation included, by model id.
 *
 * The state says where a model *is*; the token takes a moment to get there. Anything that follows
 * the token — the label over it — reads this rather than the state, or it arrives before the model.
 */
export const livePositions = new Map<string, Vec3>();

/** Inches per second a token travels. Brisk: a 6" move takes under half a second. */
const TOKEN_SPEED = 14;
const MIN_MS = 180;
const MAX_MS = 900;

const easeInOut = (t: number): number => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const near = (a: Vec3, b: Vec3): boolean => Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6 && Math.abs(a.z - b.z) < 1e-6;
const gap = (a: Vec3, b: Vec3): number => Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);

/** A point `along` inches into a polyline, clamped to its ends. */
function pointAlong(path: readonly Vec3[], along: number): Vec3 {
  let left = along;
  for (let i = 0; i + 1 < path.length; i++) {
    const a = path[i]!;
    const b = path[i + 1]!;
    const d = gap(a, b);
    if (left <= d || i + 2 === path.length) {
      const t = d < 1e-9 ? 1 : Math.min(1, left / d);
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
    }
    left -= d;
  }
  return path[path.length - 1] ?? { x: 0, y: 0, z: 0 };
}

/**
 * The silhouette for one of a unit's models.
 *
 * One rule per unit, so a unit's models agree — except that a CHARACTER unit of several models is
 * a character with a retinue, as far as keywords can tell, and drawing every one of them with a
 * standard makes a colour guard. The model that leads the unit, the first, is the one whole-unit
 * moves are measured from, so it carries the standard; the rest are troopers.
 */
function kindOf(unit: BattleUnit, index: number, models: readonly unknown[]): SilhouetteId {
  const kind = silhouetteFor(unit.keywords);
  return kind === "character" && models.length > 1 && index > 0 ? "infantry" : kind;
}

const pathLength = (path: readonly Vec3[]): number => path.reduce((s, p, i) => (i ? s + gap(path[i - 1]!, p) : 0), 0);

/** The base's thickness: the silhouette stands on top of it. */
const BASE_H = 0.16;

/** Gunmetal, for the parts of a figure that are not armour: tracks, weapons, visors, claws. */
const ACCENT_COLOUR = "#3b3e46";

const materials = new Map<string, MeshStandardMaterial>();
const figureMaterials = new Map<string, Material[]>();

/**
 * One material per colour and finish, shared by every token drawn in it.
 *
 * A table holds a hundred tokens in two colours; a material each would be a hundred GPU programs
 * to switch between for nothing. The handful made here are never disposed: they are the page's.
 * Figures are drawn double-sided: a cape or a mudguard is an open surface with a back.
 */
function material(colour: string, finish: "base" | "armour" | "accent" | "ghost"): MeshStandardMaterial {
  const key = `${finish}:${colour}`;
  let m = materials.get(key);
  if (!m) {
    const ghost = finish === "ghost";
    const tint = finish === "base" ? `#${new Color(colour).multiplyScalar(0.72).getHexString()}` : colour;
    m = new MeshStandardMaterial({
      color: tint,
      roughness: finish === "accent" ? 0.5 : 0.65,
      metalness: finish === "accent" ? 0.4 : 0.08,
      transparent: ghost,
      opacity: ghost ? 0.4 : 1,
      ...(finish === "base" ? {} : { side: DoubleSide }),
    });
    materials.set(key, m);
  }
  return m;
}

/** The figure's two materials, armour then accent, in the side's colour — or both the ghost's. */
function figureMaterial(colour: string, ghost: boolean): Material[] {
  const key = `${ghost}:${colour}`;
  let set = figureMaterials.get(key);
  if (!set) {
    set = [];
    set[ARMOUR] = material(colour, ghost ? "ghost" : "armour");
    set[ACCENT] = ghost ? set[ARMOUR] : material(ACCENT_COLOUR, "accent");
    figureMaterials.set(key, set);
  }
  return set;
}

/**
 * A model is a base disc with its class's figure standing on it.
 *
 * The figure is a proxy, never a sculpt: it is drawn to the height the kernel actually measured
 * with, so the player can see why a wall does or does not hide it, and it is chosen by what the
 * unit is rather than who — see `silhouettes.ts`. An oval base is a disc stretched along its
 * facing; the figure is scaled to the base and the height separately, so a tank is as long as
 * its base and a trooper as tall as the kernel thinks. Drawn at the origin: whoever places it
 * decides where it stands.
 */
function TokenBody({ hull, kind, colour, ghost, selected, warn }: { hull: ModelHull; kind: SilhouetteId; colour: string; ghost?: boolean; selected?: boolean; warn?: boolean }) {
  const r = hull.foot.r;
  const stretch = footReach(hull.foot) / r;
  return (
    <group rotation={[0, -hull.facing, 0]}>
      <group scale={[stretch, 1, 1]}>
        <mesh position={[0, BASE_H / 2, 0]} material={material(colour, ghost ? "ghost" : "base")}>
          <cylinderGeometry args={[r, r, BASE_H, 22]} />
        </mesh>
        {selected || warn ? (
          <mesh position={[0, 0.19, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[r + 0.06, r + 0.24, 28]} />
            <meshBasicMaterial color={warn ? SCENE_COLOURS.rayBlocked : SCENE_COLOURS.selected} side={DoubleSide} />
          </mesh>
        ) : null}
      </group>
      <mesh position={[0, BASE_H, 0]} scale={figureScale(kind, hull)} geometry={silhouetteGeometry(kind)} material={figureMaterial(colour, !!ghost)} />
    </group>
  );
}

/**
 * A token that travels to where its model is rather than appearing there.
 *
 * When the position changes, the token sets off along the model's `route` — the path the movement
 * search found, if it starts where the token stands — or straight there if not, at a steady speed
 * with a soft start and stop. A token seen for the first time drops in from above. The state is
 * never touched: the animation is the token's own business, written straight to the scene graph.
 */
function LiveToken({ modelId, at, route, children }: { modelId: string; at: Vec3; route?: readonly Vec3[]; children: ReactNode }) {
  const group = useRef<Group>(null);
  const shown = useRef<Vec3 | undefined>();
  const travel = useRef<{ path: readonly Vec3[]; length: number; start: number; duration: number } | undefined>();

  useEffect(() => {
    const from = shown.current ?? { x: at.x, y: at.y, z: at.z + 3 };
    if (near(from, at)) return;
    const path = route && route.length >= 2 && near(route[route.length - 1]!, at) && near(route[0]!, from) ? route : [from, at];
    const length = pathLength(path);
    travel.current = { path, length, start: performance.now(), duration: Math.min(MAX_MS, Math.max(MIN_MS, (length / TOKEN_SPEED) * 1000)) };
  }, [at, route]);

  useFrame(() => {
    const g = group.current;
    if (!g) return;
    let p = at;
    const t = travel.current;
    if (t) {
      const f = Math.min(1, (performance.now() - t.start) / t.duration);
      p = pointAlong(t.path, easeInOut(f) * t.length);
      if (f >= 1) travel.current = undefined;
    }
    shown.current = p;
    livePositions.set(modelId, p);
    g.position.set(p.x, p.z, -p.y);
  });

  useEffect(
    () => () => {
      livePositions.delete(modelId);
    },
    [modelId],
  );

  return <group ref={group}>{children}</group>;
}

/**
 * Every model is its own handle.
 *
 * Pressing one selects and picks up *that model*, not its unit: a unit is a handful of models that
 * spread, screen and string out, and a token you can only move as a body cannot do any of it. The
 * press reports where on the table it landed, so a drag can keep the model under the finger that
 * took it rather than snapping its centre to the pointer. Units in reserve have no tokens: they are
 * not on the table.
 */
export const UnitTokens = memo(function UnitTokens({
  units,
  selectedId,
  activeModelId,
  incoherent,
  groupIds,
  draggable = true,
  onSelect,
  onGrab,
}: {
  units: readonly BattleUnit[];
  selectedId?: string;
  activeModelId?: string;
  /** Ids of models selected together, each ringed like the active one. */
  groupIds?: ReadonlySet<string>;
  /** Ids of models out of coherency, ringed in red so the unit's shape is legible at a glance. */
  incoherent?: ReadonlySet<string>;
  /** Only the cursor: whether the press actually picks the model up is the scene's decision. */
  draggable?: boolean;
  onSelect?: (unitId: string, modelId: string, additive?: boolean) => void;
  onGrab?: (unitId: string, modelId: string, at: Vec2) => void;
}) {
  return (
    <group>
      {units
        .filter((unit) => !unit.reserve)
        .map((unit) => (
          <group key={unit.id}>
            {unit.models.map((m, i, all) => (
              <LiveToken key={m.id} modelId={m.id} at={m.hull.pos} route={m.route}>
                <group
                  onPointerDown={(e: ThreeEvent<PointerEvent>) => {
                    e.stopPropagation();
                    const p = fromScene(e.point.x, e.point.y, e.point.z);
                    // A press with Shift, Ctrl or ⌘ adds to the selection rather than picking the model up.
                    const additive = e.nativeEvent.shiftKey || e.nativeEvent.ctrlKey || e.nativeEvent.metaKey;
                    onSelect?.(unit.id, m.id, additive);
                    if (!additive) onGrab?.(unit.id, m.id, { x: p.x, y: p.y });
                  }}
                  onPointerOver={(e: ThreeEvent<PointerEvent>) => {
                    e.stopPropagation();
                    document.body.style.cursor = draggable ? "grab" : "pointer";
                  }}
                  onPointerOut={() => {
                    document.body.style.cursor = "";
                  }}
                >
                  <TokenBody hull={m.hull} kind={kindOf(unit, i, all)} colour={SIDE_COLOURS[unit.side]} selected={m.id === activeModelId || (unit.id === selectedId && !activeModelId) || !!groupIds?.has(m.id)} warn={incoherent?.has(m.id)} />
                </group>
              </LiveToken>
            ))}
          </group>
        ))}
    </group>
  );
});

/** The translucent copy that follows the pointer during a drag, tinted by whether the move is legal. */
export function Ghost({ hulls, kind = "infantry", kinds, legal }: { hulls: readonly ModelHull[]; kind?: SilhouetteId; kinds?: readonly SilhouetteId[]; legal: boolean }) {
  return (
    <group>
      {hulls.map((hull, i) => (
        <group key={i} position={toScene(hull.pos)}>
          <TokenBody hull={hull} kind={kinds?.[i] ?? kind} colour={legal ? SCENE_COLOURS.rayClear : SCENE_COLOURS.rayBlocked} ghost />
        </group>
      ))}
    </group>
  );
}
