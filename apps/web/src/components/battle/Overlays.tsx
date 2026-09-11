import { useState } from "react";
import type { ThreeEvent } from "@react-three/fiber";
import { BufferAttribute, BufferGeometry, CanvasTexture, DoubleSide, Line, LineBasicMaterial } from "three";
import type { BoardSize, ModelHull, ReachNode, Vec2, Vec3 } from "@grimstat/board";
import { footReach } from "@grimstat/board";
import { SCENE_COLOURS, fromScene, toScene, writeScene } from "../../lib/battleScene";
import { reachMask, type ReachMask } from "../../lib/reachMask";
import { useDisposable } from "./useDisposable";

/**
 * Where the selected unit can go, as one smooth region per storey.
 *
 * The search answers in half-inch cells, and a field of little squares reads as a staircase. So
 * the region is drawn instead — see `reachMask`: every point within the movement a node has left,
 * with the edge smoothed to its true outline — as the alpha of one plane laid over the table.
 * Cells on an upper floor get their own plane at that height, in a different colour, because "you
 * can get there" and "you can get there *and* be a storey up" are different tactical facts.
 * `budget` is the movement the region was searched with; without it the furthest node stands in.
 */
export function ReachOverlay({ nodes, size, cell = 0.5, budget }: { nodes: readonly ReachNode[]; size: BoardSize; cell?: number; budget?: number }) {
  const layers = useDisposable(() => {
    const byStorey = new Map<number, ReachNode[]>();
    for (const n of nodes) {
      const z = Math.round(n.at.z * 10) / 10;
      (byStorey.get(z) ?? byStorey.set(z, []).get(z)!).push(n);
    }
    const spend = budget ?? nodes.reduce((m, n) => Math.max(m, n.cost), 0) + cell;
    const built = [...byStorey.entries()].map(([z, storey]) => ({ z, texture: textureOf(reachMask(storey, size, cell, spend)) }));
    return {
      layers: built,
      dispose() {
        for (const l of built) l.texture.dispose();
      },
    };
  }, [nodes, size.width, size.depth, cell, budget]);

  return (
    <group>
      {layers.layers.map((layer) => (
        <mesh key={layer.z} rotation={[-Math.PI / 2, 0, 0]} position={[size.width / 2, layer.z + 0.06, -size.depth / 2]}>
          <planeGeometry args={[size.width, size.depth]} />
          <meshBasicMaterial color={layer.z > 0.5 ? SCENE_COLOURS.reachableUpper : SCENE_COLOURS.reachable} transparent opacity={layer.z > 0.5 ? 0.5 : 0.36} alphaMap={layer.texture} depthWrite={false} side={DoubleSide} />
        </mesh>
      ))}
    </group>
  );
}

/**
 * The mask as a texture: its coverage in every channel of an opaque canvas, since an alpha map
 * reads the green channel. The mask's rows already run from the table's far edge, as a canvas's do.
 */
function textureOf(mask: ReachMask): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = mask.width;
  canvas.height = mask.height;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const image = ctx.createImageData(mask.width, mask.height);
    const px = image.data;
    for (let i = 0, j = 0; i < mask.alpha.length; i++, j += 4) {
      px[j] = px[j + 1] = px[j + 2] = mask.alpha[i]!;
      px[j + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
  }
  const texture = new CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

/** How far outside the base the turn ring's band starts and ends, in inches. */
const RING_IN = 0.12;
const RING_OUT = 0.42;

/**
 * The turn ring: a band around the selected model's base with a knob at its facing.
 *
 * Dragging the band turns the model to follow the hand, which is how a player turns a miniature
 * on the table: by its base, not by a key. The knob shows which way the model faces, so a round
 * base has a direction the eye can read.
 */
export function TurnRing({ hull, onGrab }: { hull: ModelHull; onGrab: (at: Vec2) => void }) {
  const [hot, setHot] = useState(false);
  const r = footReach(hull.foot);
  const reach = r + (RING_IN + RING_OUT) / 2;
  const knob = { x: hull.pos.x + reach * Math.cos(hull.facing), y: hull.pos.y + reach * Math.sin(hull.facing), z: hull.pos.z + 0.12 };
  return (
    <group>
      <mesh
        position={toScene({ x: hull.pos.x, y: hull.pos.y, z: hull.pos.z + 0.05 })}
        rotation={[-Math.PI / 2, 0, 0]}
        onPointerDown={(e: ThreeEvent<PointerEvent>) => {
          e.stopPropagation();
          const p = fromScene(e.point.x, e.point.y, e.point.z);
          onGrab({ x: p.x, y: p.y });
        }}
        onPointerOver={(e: ThreeEvent<PointerEvent>) => {
          e.stopPropagation();
          setHot(true);
          if (!document.body.style.cursor) document.body.style.cursor = "grab";
        }}
        onPointerOut={() => {
          setHot(false);
          if (document.body.style.cursor === "grab") document.body.style.cursor = "";
        }}
      >
        <ringGeometry args={[r + RING_IN, r + RING_OUT, 48]} />
        <meshBasicMaterial color={SCENE_COLOURS.selected} transparent opacity={hot ? 0.7 : 0.35} side={DoubleSide} depthWrite={false} />
      </mesh>
      <mesh position={toScene(knob)}>
        <sphereGeometry args={[0.16, 12, 8]} />
        <meshBasicMaterial color={SCENE_COLOURS.selected} />
      </mesh>
    </group>
  );
}

/**
 * The rays the kernel actually cast, clear ones in green and blocked ones in red.
 *
 * This is the feature 3D buys that a top-down view cannot: it does not assert that a target is
 * hidden, it shows the shot going into the wall.
 */
export function SightRays({ rays }: { rays: readonly { from: Vec3; to: Vec3; blockedBy?: string }[] }) {
  const blocked = useDisposable(() => segments(rays.filter((r) => r.blockedBy)), [rays]);
  const clear = useDisposable(() => segments(rays.filter((r) => !r.blockedBy)), [rays]);
  return (
    <group>
      {/* Blocked rays are drawn faintly and behind: they are context for the answer, not the answer.
          Depth testing is off so a ray that ends inside a ruin is still visible going into it. */}
      <lineSegments geometry={blocked} renderOrder={1}>
        <lineBasicMaterial color={SCENE_COLOURS.rayBlocked} transparent opacity={0.4} depthTest={false} />
      </lineSegments>
      <lineSegments geometry={clear} renderOrder={2}>
        <lineBasicMaterial color={SCENE_COLOURS.rayClear} transparent opacity={0.85} depthTest={false} />
      </lineSegments>
    </group>
  );
}

function segments(rays: readonly { from: Vec3; to: Vec3 }[]): BufferGeometry {
  const data = new Float32Array(rays.length * 6);
  let i = 0;
  for (const r of rays) {
    i = writeScene(data, i, r.from);
    i = writeScene(data, i, r.to);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(data, 3));
  return geometry;
}

/**
 * A route across the table: the charge path, or the way a drag actually got where it went.
 *
 * `onTop` draws it through terrain: a tape stretched across a ruin is still a tape.
 */
export function PathLine({ path, colour = SCENE_COLOURS.path, onTop = false }: { path: readonly Vec3[]; colour?: string; onTop?: boolean }) {
  // Built as an object rather than a `<line>` element: JSX types read that tag as SVG.
  const object = useDisposable(() => {
    const data = new Float32Array(path.length * 3);
    let i = 0;
    for (const p of path) i = writeScene(data, i, { x: p.x, y: p.y, z: p.z + 0.2 });
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(data, 3));
    const line = new Line(geometry, new LineBasicMaterial({ color: colour, depthTest: !onTop }));
    line.renderOrder = onTop ? 3 : 0;
    return {
      line,
      dispose() {
        geometry.dispose();
        line.material.dispose();
      },
    };
  }, [path, colour, onTop]);
  if (path.length < 2) return null;
  return <primitive object={object.line} />;
}

/** The measuring tape: a straight line between two picked points, with no regard for terrain. */
export function MeasureLine({ from, to }: { from: Vec3; to: Vec3 }) {
  return <PathLine path={[from, to]} colour={SCENE_COLOURS.selected} onTop />;
}

/**
 * A tape left on the table: the line, a mark at each end, and a wide invisible sleeve along it so a
 * double-click lands without needing to hit a one-pixel line. A press on it is swallowed so that
 * taking hold of a tape never also drops a mark on the table beneath it.
 */
export function TapeObject({ from, to, onRemove }: { from: Vec3; to: Vec3; onRemove: () => void }) {
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2, z: (from.z + to.z) / 2 + 0.2 };
  return (
    <group
      onDoubleClick={(e) => {
        e.stopPropagation();
        onRemove();
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onPointerOver={(e) => {
        e.stopPropagation();
        document.body.style.cursor = "pointer";
      }}
      onPointerOut={() => {
        document.body.style.cursor = "";
      }}
    >
      <MeasureLine from={from} to={to} />
      <MeasureMarker at={from} />
      <MeasureMarker at={to} />
      {/* Board angles turn counter-clockwise about +z; the scene's y is up and its z is -board y,
          so the same turn about the scene's y axis is the same angle. */}
      <mesh position={toScene(mid)} rotation={[-Math.PI / 2, 0, angle]}>
        <planeGeometry args={[Math.max(length, 0.5), 0.9]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} depthTest={false} />
      </mesh>
    </group>
  );
}

/** A mark set by the tape: a small ring on the table, drawn through whatever stands on it. */
export function MeasureMarker({ at }: { at: Vec3 }) {
  return (
    <mesh position={toScene({ x: at.x, y: at.y, z: at.z + 0.06 })} rotation={[-Math.PI / 2, 0, 0]} renderOrder={3}>
      <ringGeometry args={[0.16, 0.3, 24]} />
      <meshBasicMaterial color={SCENE_COLOURS.selected} side={DoubleSide} depthTest={false} />
    </mesh>
  );
}

/**
 * A protractor around a mark: a ring with a tick every 15°, longer at 45° and longer again at 90°,
 * with 0° along the table's +x axis. It gives the bearing in the readout something to be read
 * against, which is what turns a number into an angle a player can see.
 */
export function Protractor({ at, radius = 3 }: { at: Vec3; radius?: number }) {
  const geometry = useDisposable(() => {
    const z = at.z + 0.06;
    const points: Vec3[] = [];
    const segments = 96;
    for (let i = 0; i < segments; i++) {
      const a0 = (i / segments) * Math.PI * 2;
      const a1 = ((i + 1) / segments) * Math.PI * 2;
      points.push({ x: at.x + Math.cos(a0) * radius, y: at.y + Math.sin(a0) * radius, z }, { x: at.x + Math.cos(a1) * radius, y: at.y + Math.sin(a1) * radius, z });
    }
    for (let deg = 0; deg < 360; deg += 15) {
      const a = (deg * Math.PI) / 180;
      const len = deg % 90 === 0 ? 0.9 : deg % 45 === 0 ? 0.55 : 0.3;
      points.push({ x: at.x + Math.cos(a) * (radius - len), y: at.y + Math.sin(a) * (radius - len), z }, { x: at.x + Math.cos(a) * radius, y: at.y + Math.sin(a) * radius, z });
    }
    const data = new Float32Array(points.length * 3);
    let i = 0;
    for (const p of points) i = writeScene(data, i, p);
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(data, 3));
    return g;
  }, [at.x, at.y, at.z, radius]);
  return (
    <lineSegments geometry={geometry} renderOrder={3}>
      <lineBasicMaterial color={SCENE_COLOURS.selected} transparent opacity={0.55} depthTest={false} />
    </lineSegments>
  );
}
