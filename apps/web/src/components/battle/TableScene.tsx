import { memo, useMemo } from "react";
import type { ThreeEvent } from "@react-three/fiber";
import { BufferAttribute, BufferGeometry, DoubleSide, EdgesGeometry, ExtrudeGeometry, Shape, ShapeGeometry } from "three";
import type { BoardSize, Objective, TerrainPiece, Vec2, Zone } from "@grimstat/board";
import { OBJECTIVE_MARKER_RADIUS, OBJECTIVE_RANGE, hasTrait } from "@grimstat/board";
import { SCENE_COLOURS, SIDE_COLOURS, fromScene, surfaceHeights, terrainAppearance, toScene } from "../../lib/battleScene";
import { useDisposable } from "./useDisposable";

/** A press on something on the table, reported with the board point under the pointer. */
export type PickHandler = (id: string, at: Vec2) => void;

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

/** The board point under a pointer event. */
function boardPoint(e: ThreeEvent<PointerEvent>): Vec2 {
  const p = fromScene(e.point.x, e.point.y, e.point.z);
  return { x: p.x, y: p.y };
}

/** Handlers that set the cursor while something interactive is under the pointer. */
const cursorOn = (cursor: string) => ({
  onPointerOver: (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    document.body.style.cursor = cursor;
  },
  onPointerOut: () => {
    document.body.style.cursor = "";
  },
});

/**
 * The table itself, drawn as a slab with an edge and a grid for measuring by eye.
 *
 * Only presses are reported. A measuring tape takes deliberate picks, and a drag does not go through
 * here at all — it casts against a plane from window events, which has no gaps.
 */
export const Table = memo(function Table({ size, onDown }: { size: BoardSize; onDown?: (at: Vec2, event: PointerEvent) => void }) {
  const edge = useDisposable(() => {
    const flat = new ShapeGeometry(shapeOf([{ x: 0, y: 0 }, { x: size.width, y: 0 }, { x: size.width, y: size.depth }, { x: 0, y: size.depth }]));
    const edges = new EdgesGeometry(flat);
    flat.dispose();
    return edges;
  }, [size.width, size.depth]);
  return (
    <group>
      <mesh rotation={FLAT} position={[size.width / 2, -0.02, -size.depth / 2]} onPointerDown={onDown ? (e) => onDown(boardPoint(e), e.nativeEvent) : undefined}>
        <planeGeometry args={[size.width, size.depth]} />
        <meshStandardMaterial color={SCENE_COLOURS.table} roughness={0.95} />
      </mesh>
      <TableGrid size={size} />
      <lineSegments geometry={edge} position={[0, 0.02, 0]}>
        <lineBasicMaterial color={SCENE_COLOURS.tableEdge} />
      </lineSegments>
    </group>
  );
});

/**
 * A six-inch grid, clipped to the table.
 *
 * `gridHelper` is square, so on a 60 × 44 table it hangs off two edges and the table stops looking
 * like a table. The grid is six inches rather than one because a one-inch grid is noise at this zoom
 * and six inches is the spacing a player already thinks in.
 */
function TableGrid({ size, step = 6 }: { size: BoardSize; step?: number }) {
  const geometry = useDisposable(() => {
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
 *
 * Each piece is its own memoised component, so dragging one rebuilds only that piece's geometry.
 */
export const Terrain = memo(function Terrain({ pieces, selectedId, onPick }: { pieces: readonly TerrainPiece[]; selectedId?: string; onPick?: PickHandler }) {
  return (
    <group>
      {pieces.map((piece) => (
        <TerrainSolid key={piece.id} piece={piece} selected={piece.id === selectedId} onPick={onPick} />
      ))}
    </group>
  );
});

const TerrainSolid = memo(function TerrainSolid({ piece, selected, onPick }: { piece: TerrainPiece; selected?: boolean; onPick?: PickHandler }) {
  const { colour, opacity } = terrainAppearance(piece);
  const solid = useDisposable(() => new ExtrudeGeometry(shapeOf(piece.polygon), { depth: Math.max(piece.height, 0.05), bevelEnabled: false }), [piece.polygon, piece.height]);
  const edges = useDisposable(() => new EdgesGeometry(solid), [solid]);
  const flat = useDisposable(() => new ShapeGeometry(shapeOf(piece.polygon)), [piece.polygon]);
  const surfaces = useMemo(() => surfaceHeights(piece), [piece]);
  const roof = hasTrait(piece, "impassable") ? SCENE_COLOURS.terrainImpassable : SCENE_COLOURS.terrainRoof;

  return (
    <group
      {...(onPick
        ? {
            onPointerDown: (e: ThreeEvent<PointerEvent>) => {
              e.stopPropagation();
              onPick(piece.id, boardPoint(e));
            },
            ...cursorOn("grab"),
          }
        : {})}
    >
      <mesh geometry={solid} rotation={FLAT} position={[0, piece.base, 0]}>
        <meshStandardMaterial color={selected ? SCENE_COLOURS.selected : colour} transparent opacity={selected ? Math.min(0.8, opacity + 0.2) : opacity} roughness={0.9} depthWrite={opacity > 0.9} />
      </mesh>
      <lineSegments geometry={edges} position={[0, piece.base, 0]} rotation={FLAT}>
        <lineBasicMaterial color={selected ? SCENE_COLOURS.selected : SCENE_COLOURS.floorEdge} transparent opacity={selected ? 1 : 0.55} />
      </lineSegments>
      {surfaces.map((z) => (
        <mesh key={z} geometry={flat} rotation={FLAT} position={[0, z + 0.02, 0]}>
          <meshStandardMaterial color={roof} side={DoubleSide} roughness={0.9} transparent opacity={0.9} />
        </mesh>
      ))}
    </group>
  );
});

/**
 * Deployment zones, tinted into the table rather than fenced off, since they are advisory and nothing collides with them.
 * The side being deployed gets its zone lit, so the edge a unit must stay inside is the edge on show.
 */
export const Zones = memo(function Zones({ zones, highlight }: { zones: readonly Zone[]; highlight?: Zone["owner"] }) {
  return (
    <group>
      {zones.map((zone) => (
        <ZoneShape key={zone.id} zone={zone} lit={zone.owner === highlight} />
      ))}
    </group>
  );
});

function ZoneShape({ zone, lit }: { zone: Zone; lit: boolean }) {
  const geometry = useDisposable(() => new ShapeGeometry(shapeOf(zone.polygon)), [zone.polygon]);
  const edge = useDisposable(() => new EdgesGeometry(new ShapeGeometry(shapeOf(zone.polygon))), [zone.polygon]);
  const colour = zone.owner === "attacker" ? SIDE_COLOURS.attacker : SIDE_COLOURS.defender;
  return (
    <group>
      <mesh geometry={geometry} rotation={FLAT} position={[0, 0.002, 0]}>
        <meshBasicMaterial color={colour} transparent opacity={lit ? 0.28 : 0.12} side={DoubleSide} />
      </mesh>
      {lit ? (
        <lineSegments geometry={edge} rotation={FLAT} position={[0, 0.03, 0]}>
          <lineBasicMaterial color={colour} transparent opacity={0.9} />
        </lineSegments>
      ) : null}
    </group>
  );
}

/**
 * Objective markers, each inside the ring a model has to be within to hold it.
 *
 * Under the terrain tool a marker can be picked up and moved. The marker is 40 mm across, which is a
 * small thing to hit from an orbit camera, so a larger invisible disc takes the press for it — only
 * while editing, because under the other tools a press near an objective belongs to the table.
 */
export const Objectives = memo(function Objectives({ objectives, selectedId, onPick }: { objectives: readonly Objective[]; selectedId?: string; onPick?: PickHandler }) {
  return (
    <group>
      {objectives.map((o) => (
        <ObjectiveMarker key={o.id} objective={o} selected={o.id === selectedId} onPick={onPick} />
      ))}
    </group>
  );
});

const ObjectiveMarker = memo(function ObjectiveMarker({ objective: o, selected, onPick }: { objective: Objective; selected?: boolean; onPick?: PickHandler }) {
  const marker = o.markerRadius ?? OBJECTIVE_MARKER_RADIUS;
  const range = o.range ?? OBJECTIVE_RANGE;
  const colour = selected ? SCENE_COLOURS.selected : SCENE_COLOURS.objective;
  return (
    <group
      position={toScene({ x: o.at.x, y: o.at.y, z: (o.z ?? 0) + 0.03 })}
      {...(onPick
        ? {
            onPointerDown: (e: ThreeEvent<PointerEvent>) => {
              e.stopPropagation();
              onPick(o.id, boardPoint(e));
            },
            ...cursorOn("grab"),
          }
        : {})}
    >
      <mesh rotation={FLAT}>
        <circleGeometry args={[marker, 24]} />
        <meshBasicMaterial color={colour} />
      </mesh>
      <mesh rotation={FLAT}>
        <ringGeometry args={[range - 0.08, range, 48]} />
        <meshBasicMaterial color={colour} transparent opacity={selected ? 0.9 : 0.45} side={DoubleSide} />
      </mesh>
      {onPick ? (
        <mesh rotation={FLAT}>
          <circleGeometry args={[Math.max(marker, 1.4), 16]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
      ) : null}
    </group>
  );
});

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
