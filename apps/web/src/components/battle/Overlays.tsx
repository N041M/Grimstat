import { useMemo } from "react";
import { BufferAttribute, BufferGeometry, DoubleSide } from "three";
import type { Vec3 } from "@grimstat/board";
import type { ReachNode } from "@grimstat/board";
import { SCENE_COLOURS } from "../../lib/battleScene";

/**
 * Where the selected unit can go, as one slab per reachable cell.
 *
 * Cells on an upper floor are a different colour, because "you can get there" and "you can get there
 * *and be a storey up*" are different tactical facts and the flat view cannot distinguish them.
 *
 * Drawn as a single geometry rather than a mesh per cell: a 12" advance is a couple of thousand
 * cells, and two thousand draw calls would cost more than the search that produced them.
 */
export function ReachOverlay({ nodes, cell = 0.5 }: { nodes: readonly ReachNode[]; cell?: number }) {
  const { ground, upper } = useMemo(() => {
    const best = new Map<string, Vec3>();
    for (const n of nodes) {
      const key = `${n.at.x.toFixed(2)},${n.at.y.toFixed(2)}`;
      const seen = best.get(key);
      if (!seen || n.at.z > seen.z) best.set(key, n.at);
    }
    const on: Vec3[] = [];
    const up: Vec3[] = [];
    for (const at of best.values()) (at.z > 0.5 ? up : on).push(at);
    return { ground: quads(on, cell), upper: quads(up, cell) };
  }, [nodes, cell]);

  return (
    <group>
      <mesh geometry={ground}>
        <meshBasicMaterial color={SCENE_COLOURS.reachable} transparent opacity={0.3} side={DoubleSide} depthWrite={false} />
      </mesh>
      <mesh geometry={upper}>
        <meshBasicMaterial color={SCENE_COLOURS.reachableUpper} transparent opacity={0.45} side={DoubleSide} depthWrite={false} />
      </mesh>
    </group>
  );
}

/** Two triangles per cell, laid flat just above whatever surface the cell sits on. */
function quads(points: readonly Vec3[], cell: number): BufferGeometry {
  const half = cell / 2;
  const data = new Float32Array(points.length * 18);
  let i = 0;
  for (const p of points) {
    const y = p.z + 0.06;
    const x0 = p.x - half;
    const x1 = p.x + half;
    const z0 = -p.y - half;
    const z1 = -p.y + half;
    for (const [x, z] of [
      [x0, z0],
      [x1, z0],
      [x1, z1],
      [x0, z0],
      [x1, z1],
      [x0, z1],
    ] as const) {
      data[i++] = x;
      data[i++] = y;
      data[i++] = z;
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(data, 3));
  return geometry;
}

/**
 * The rays the kernel actually cast, clear ones in green and blocked ones in red.
 *
 * This is the feature 3D buys that a top-down view cannot: it does not assert that a target is
 * hidden, it shows the shot going into the wall.
 */
export function SightRays({ rays }: { rays: readonly { from: Vec3; to: Vec3; blockedBy?: string }[] }) {
  const { clear, blocked } = useMemo(() => {
    const split = (want: boolean) => segments(rays.filter((r) => Boolean(r.blockedBy) === want));
    return { clear: split(false), blocked: split(true) };
  }, [rays]);
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
    data[i++] = r.from.x;
    data[i++] = r.from.z;
    data[i++] = -r.from.y;
    data[i++] = r.to.x;
    data[i++] = r.to.z;
    data[i++] = -r.to.y;
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(data, 3));
  return geometry;
}

/** A route across the table: the charge path, or the way a drag actually got where it went. */
export function PathLine({ path, colour = SCENE_COLOURS.path }: { path: readonly Vec3[]; colour?: string }) {
  const geometry = useMemo(() => {
    const data = new Float32Array(path.length * 3);
    let i = 0;
    for (const p of path) {
      data[i++] = p.x;
      data[i++] = p.z + 0.2;
      data[i++] = -p.y;
    }
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(data, 3));
    return g;
  }, [path]);
  if (path.length < 2) return null;
  return (
    <line>
      <primitive object={geometry} attach="geometry" />
      <lineBasicMaterial color={colour} linewidth={2} />
    </line>
  );
}

/** The measuring tape: a straight line between two picked points, with no regard for terrain. */
export function MeasureLine({ from, to }: { from: Vec3; to: Vec3 }) {
  return <PathLine path={[from, to]} colour={SCENE_COLOURS.selected} />;
}
