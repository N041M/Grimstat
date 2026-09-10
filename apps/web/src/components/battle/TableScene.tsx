import { useMemo } from "react";
import type { ThreeEvent } from "@react-three/fiber";
import { BufferAttribute, BufferGeometry, DoubleSide, ExtrudeGeometry, Shape, ShapeGeometry } from "three";
import type { BoardSize, Objective, TerrainPiece, Vec2, Zone } from "@grimstat/board";
import { OBJECTIVE_RANGE, hasTrait } from "@grimstat/board";
import { SCENE_COLOURS, SIDE_COLOURS, fromScene, surfaceHeights, terrainAppearance } from "../../lib/battleScene";

/**
 * A board polygon as a three.js `Shape`.
 *
 * The shape is built in `(x, y)` and the mesh is then rotated −90° about X, which sends local
 * `(u, v, w)` to world `(u, w, −v)` — board `x` stays `x`, board `y` becomes `−z`, and the extrusion
 * axis becomes up. One rotation, applied in one place, is the whole of the coordinate change.
 */
function shapeOf(polygon: readonly Vec2[]): Shape {
  const shape = new Shape();
  const first = polygon[0];
  if (!first) return shape;
  shape.moveTo(first.x, first.y);
  for (const p of polygon.slice(1)) shape.lineTo(p.x, p.y);
  shape.closePath();
  return shape;
}

/** Lay a shape flat on the table: local (u, v, w) becomes world (u, w, −v). */
const FLAT: [number, number, number] = [-Math.PI / 2, 0, 0];

/**
 * The table itself: a slab, an edge, and a grid to measure against by eye.
 *
 * Only presses are reported. A measuring tape takes deliberate picks, and a drag does not go through
 * here at all — it casts against a plane from window events, which has no gaps.
 */
export function Table({ size, onDown }: { size: BoardSize; onDown?: (at: Vec2) => void }) {
  const relay = (to?: (at: Vec2) => void) => (e: ThreeEvent<PointerEvent>) => {
    if (!to) return;
    const p = fromScene(e.point.x, e.point.y, e.point.z);
    to({ x: p.x, y: p.y });
  };
  return (
    <group>
      <mesh rotation={FLAT} position={[size.width / 2, -0.02, -size.depth / 2]} onPointerDown={relay(onDown)}>
        <planeGeometry args={[size.width, size.depth]} />
        <meshStandardMaterial color={SCENE_COLOURS.table} roughness={0.95} />
      </mesh>
      <TableGrid size={size} />
      <lineSegments position={[0, 0.02, 0]}>
        <edgesGeometry args={[new ShapeGeometry(shapeOf([{ x: 0, y: 0 }, { x: size.width, y: 0 }, { x: size.width, y: size.depth }, { x: 0, y: size.depth }]))]} />
        <lineBasicMaterial color={SCENE_COLOURS.tableEdge} />
      </lineSegments>
    </group>
  );
}

/**
 * A six-inch grid, clipped to the table.
 *
 * `gridHelper` is square, so on a 60 × 44 table it hangs off two edges and the table stops looking
 * like a table. Six inches rather than one: a one-inch grid at this zoom is noise, and six is the
 * spacing a player already thinks in.
 */
function TableGrid({ size, step = 6 }: { size: BoardSize; step?: number }) {
  const geometry = useMemo(() => {
    const points: number[] = [];
    for (let x = step; x < size.width; x += step) points.push(x, 0, 0, x, 0, -size.depth);
    for (let y = step; y < size.depth; y += step) points.push(0, 0, -y, size.width, 0, -y);
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(new Float32Array(points), 3));
    return g;
  }, [size.width, size.depth, step]);
  return (
    <lineSegments geometry={geometry} position={[0, 0.008, 0]}>
      <lineBasicMaterial color={SCENE_COLOURS.grid} />
    </lineSegments>
  );
}

/**
 * Terrain as solids.
 *
 * Tall pieces are drawn translucent with their edges picked out: an opaque ruin would be honest but
 * would hide everything inside it, and the whole reason to model floors is to see who is standing on
 * them. Each walkable surface gets a visible slab so a storey reads as somewhere to stand.
 */
export function Terrain({ pieces }: { pieces: readonly TerrainPiece[] }) {
  return (
    <group>
      {pieces.map((piece) => (
        <TerrainSolid key={piece.id} piece={piece} />
      ))}
    </group>
  );
}

function TerrainSolid({ piece }: { piece: TerrainPiece }) {
  const { colour, opacity } = terrainAppearance(piece);
  const shape = useMemo(() => shapeOf(piece.polygon), [piece.polygon]);
  const solid = useMemo(() => new ExtrudeGeometry(shape, { depth: Math.max(piece.height, 0.05), bevelEnabled: false }), [shape, piece.height]);
  const flat = useMemo(() => new ShapeGeometry(shape), [shape]);
  const surfaces = useMemo(() => surfaceHeights(piece), [piece]);

  return (
    <group>
      <mesh geometry={solid} rotation={FLAT} position={[0, piece.base, 0]}>
        <meshStandardMaterial color={colour} transparent opacity={opacity} roughness={0.9} depthWrite={opacity > 0.9} />
      </mesh>
      <lineSegments position={[0, piece.base, 0]} rotation={FLAT}>
        <edgesGeometry args={[solid]} />
        <lineBasicMaterial color={SCENE_COLOURS.floorEdge} transparent opacity={0.55} />
      </lineSegments>
      {surfaces.map((z) => (
        <mesh key={z} geometry={flat} rotation={FLAT} position={[0, z + 0.02, 0]}>
          <meshStandardMaterial color={hasTrait(piece, "impassable") ? SCENE_COLOURS.terrainImpassable : SCENE_COLOURS.terrainRoof} side={DoubleSide} roughness={0.9} transparent opacity={0.9} />
        </mesh>
      ))}
    </group>
  );
}

/** Deployment zones, tinted into the table rather than fenced off — they are advisory, not walls. */
export function Zones({ zones }: { zones: readonly Zone[] }) {
  return (
    <group>
      {zones.map((zone) => (
        <mesh key={zone.id} geometry={new ShapeGeometry(shapeOf(zone.polygon))} rotation={FLAT} position={[0, 0.002, 0]}>
          <meshBasicMaterial color={zone.owner === "attacker" ? SIDE_COLOURS.attacker : SIDE_COLOURS.defender} transparent opacity={0.12} side={DoubleSide} />
        </mesh>
      ))}
    </group>
  );
}

/** Objective markers, each inside the ring a model has to be within to hold it. */
export function Objectives({ objectives }: { objectives: readonly Objective[] }) {
  return (
    <group>
      {objectives.map((o) => (
        <group key={o.id} position={[o.at.x, (o.z ?? 0) + 0.03, -o.at.y]}>
          <mesh rotation={FLAT}>
            <circleGeometry args={[o.markerRadius ?? 0.8, 24]} />
            <meshBasicMaterial color={SCENE_COLOURS.objective} />
          </mesh>
          <mesh rotation={FLAT}>
            <ringGeometry args={[(o.range ?? OBJECTIVE_RANGE) - 0.08, o.range ?? OBJECTIVE_RANGE, 48]} />
            <meshBasicMaterial color={SCENE_COLOURS.objective} transparent opacity={0.45} side={DoubleSide} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/** Enough light to read a table by: one key light, and ambient so nothing is a silhouette. */
export function Lighting({ size }: { size: BoardSize }) {
  return (
    <>
      <ambientLight intensity={1.5} />
      <hemisphereLight args={["#cdd6e5", "#1b1e24", 1.1]} />
      <directionalLight position={[size.width * 0.7, 60, -size.depth * 0.2]} intensity={1.6} />
    </>
  );
}
