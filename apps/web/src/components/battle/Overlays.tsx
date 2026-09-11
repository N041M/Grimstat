import { BufferAttribute, BufferGeometry, CanvasTexture, DoubleSide, Line, LineBasicMaterial } from "three";
import type { BoardSize, ReachNode, Vec3 } from "@grimstat/board";
import { SCENE_COLOURS, toScene, writeScene } from "../../lib/battleScene";
import { useDisposable } from "./useDisposable";

/**
 * Where the selected unit can go, as one smooth region per storey.
 *
 * The search answers in half-inch cells, and a field of little squares reads as a staircase. So
 * the cells are rasterised: a disc a little wider than half a cell is painted for each reachable
 * position into an off-screen canvas at eight pixels to the inch, and the union of those discs —
 * whose scallops are a fraction of a pixel — becomes the alpha of one plane laid over the table.
 * Cells on an upper floor get their own plane at that height, in a different colour, because "you
 * can get there" and "you can get there *and* be a storey up" are different tactical facts.
 */
export function ReachOverlay({ nodes, size, cell = 0.5 }: { nodes: readonly ReachNode[]; size: BoardSize; cell?: number }) {
  const layers = useDisposable(() => {
    const byStorey = new Map<number, Vec3[]>();
    for (const n of nodes) {
      const z = Math.round(n.at.z * 10) / 10;
      (byStorey.get(z) ?? byStorey.set(z, []).get(z)!).push(n.at);
    }
    const built = [...byStorey.entries()].map(([z, points]) => ({ z, texture: rasterise(points, size, cell) }));
    return {
      layers: built,
      dispose() {
        for (const l of built) l.texture.dispose();
      },
    };
  }, [nodes, size.width, size.depth, cell]);

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

/** Pixels to the inch in the reach mask: enough that a disc's edge is a curve, not a step. */
const MASK_PPI = 8;

/**
 * Paint the reachable positions as overlapping discs into a canvas the size of the table.
 *
 * The disc radius is just over the half-diagonal of a cell, so diagonal neighbours touch and the
 * region closes; the scallops left between them are under a tenth of an inch, less than a pixel.
 * Canvas rows run top-down and the table's y runs away from the near edge, so a row is `depth − y`.
 */
function rasterise(points: readonly Vec3[], size: BoardSize, cell: number): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil(size.width * MASK_PPI));
  canvas.height = Math.max(1, Math.ceil(size.depth * MASK_PPI));
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.fillStyle = "#fff";
    const r = cell * 0.78 * MASK_PPI;
    for (const p of points) {
      ctx.beginPath();
      ctx.arc(p.x * MASK_PPI, (size.depth - p.y) * MASK_PPI, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  const texture = new CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
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
