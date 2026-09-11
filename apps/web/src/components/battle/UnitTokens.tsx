import { memo, useEffect, useRef, type ReactNode } from "react";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { DoubleSide, type Group } from "three";
import type { ModelHull, Vec2, Vec3 } from "@grimstat/board";
import { footReach } from "@grimstat/board";
import type { BattleUnit } from "../../lib/battle";
import { SCENE_COLOURS, SIDE_COLOURS, fromScene, toScene } from "../../lib/battleScene";

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

const pathLength = (path: readonly Vec3[]): number => path.reduce((s, p, i) => (i ? s + gap(path[i - 1]!, p) : 0), 0);

/**
 * A model is a base disc with a plain tapered proxy standing on it.
 *
 * The proxy is a volume, never a sculpt: it is the height the kernel actually measured with, drawn
 * so the player can see why a wall does or does not hide it. An oval base is a cylinder stretched
 * along its facing — close enough at this scale, and the kernel measures the real capsule regardless.
 * Drawn at the origin: whoever places it decides where it stands.
 */
function TokenBody({ hull, colour, ghost, selected, warn }: { hull: ModelHull; colour: string; ghost?: boolean; selected?: boolean; warn?: boolean }) {
  const r = hull.foot.r;
  const stretch = footReach(hull.foot) / r;
  const bodyR = r * 0.62;
  return (
    <group rotation={[0, -hull.facing, 0]} scale={[stretch, 1, 1]}>
      <mesh position={[0, 0.08, 0]}>
        <cylinderGeometry args={[r, r, 0.16, 22]} />
        <meshStandardMaterial color={colour} transparent={ghost} opacity={ghost ? 0.45 : 1} roughness={0.7} />
      </mesh>
      <mesh position={[0, 0.16 + hull.height / 2, 0]}>
        <cylinderGeometry args={[bodyR * 0.55, bodyR, hull.height, 14]} />
        <meshStandardMaterial color={colour} transparent opacity={ghost ? 0.3 : 0.82} roughness={0.6} />
      </mesh>
      {selected || warn ? (
        <mesh position={[0, 0.19, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[r + 0.06, r + 0.24, 28]} />
          <meshBasicMaterial color={warn ? SCENE_COLOURS.rayBlocked : SCENE_COLOURS.selected} side={DoubleSide} />
        </mesh>
      ) : null}
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
  draggable = true,
  onSelect,
  onGrab,
}: {
  units: readonly BattleUnit[];
  selectedId?: string;
  activeModelId?: string;
  /** Ids of models out of coherency, ringed in red so the unit's shape is legible at a glance. */
  incoherent?: ReadonlySet<string>;
  /** Only the cursor: whether the press actually picks the model up is the scene's decision. */
  draggable?: boolean;
  onSelect?: (unitId: string, modelId: string) => void;
  onGrab?: (unitId: string, modelId: string, at: Vec2) => void;
}) {
  return (
    <group>
      {units
        .filter((unit) => !unit.reserve)
        .map((unit) => (
          <group key={unit.id}>
            {unit.models.map((m) => (
              <LiveToken key={m.id} modelId={m.id} at={m.hull.pos} route={m.route}>
                <group
                  onPointerDown={(e: ThreeEvent<PointerEvent>) => {
                    e.stopPropagation();
                    const p = fromScene(e.point.x, e.point.y, e.point.z);
                    onSelect?.(unit.id, m.id);
                    onGrab?.(unit.id, m.id, { x: p.x, y: p.y });
                  }}
                  onPointerOver={(e: ThreeEvent<PointerEvent>) => {
                    e.stopPropagation();
                    document.body.style.cursor = draggable ? "grab" : "pointer";
                  }}
                  onPointerOut={() => {
                    document.body.style.cursor = "";
                  }}
                >
                  <TokenBody hull={m.hull} colour={SIDE_COLOURS[unit.side]} selected={m.id === activeModelId || (unit.id === selectedId && !activeModelId)} warn={incoherent?.has(m.id)} />
                </group>
              </LiveToken>
            ))}
          </group>
        ))}
    </group>
  );
});

/** The translucent copy that follows the pointer during a drag, tinted by whether the move is legal. */
export function Ghost({ hulls, legal }: { hulls: readonly ModelHull[]; legal: boolean }) {
  return (
    <group>
      {hulls.map((hull, i) => (
        <group key={i} position={toScene(hull.pos)}>
          <TokenBody hull={hull} colour={legal ? SCENE_COLOURS.rayClear : SCENE_COLOURS.rayBlocked} ghost />
        </group>
      ))}
    </group>
  );
}
