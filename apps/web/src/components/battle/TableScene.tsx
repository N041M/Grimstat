import { memo, useEffect, useMemo, useRef } from "react";
import { useThree, type ThreeEvent } from "@react-three/fiber";
import { BufferAttribute, BufferGeometry, Color, DataTexture, DoubleSide, EdgesGeometry, EquirectangularReflectionMapping, ExtrudeGeometry, FloatType, PMREMGenerator, RGBAFormat, Shape, ShapeGeometry, Vector3, type DirectionalLight } from "three";
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

/** Height the shadow camera allows for above the table, so a three-storey ruin still casts. */
const SHADOW_HEADROOM = 16;

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
      <mesh receiveShadow rotation={FLAT} position={[size.width / 2, -0.02, -size.depth / 2]} onPointerDown={onDown ? (e) => onDown(boardPoint(e), e.nativeEvent) : undefined}>
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
      {/*
        Only a piece drawn solid casts a shadow. A ruin is drawn see-through precisely so the models
        inside it can be seen, and a solid shadow of its footprint would hide from above exactly
        what the transparency was there to show — as well as being a lie about a building that is
        mostly open walls. Low rubble and impassable blocks are drawn solid, so they do cast.
      */}
      <mesh castShadow={opacity > 0.85} receiveShadow geometry={solid} rotation={FLAT} position={[0, piece.base, 0]}>
        <meshStandardMaterial color={selected ? SCENE_COLOURS.selected : colour} transparent opacity={selected ? Math.min(0.8, opacity + 0.2) : opacity} roughness={0.9} depthWrite={opacity > 0.9} />
      </mesh>
      <lineSegments geometry={edges} position={[0, piece.base, 0]} rotation={FLAT}>
        <lineBasicMaterial color={selected ? SCENE_COLOURS.selected : SCENE_COLOURS.floorEdge} transparent opacity={selected ? 1 : 0.55} />
      </lineSegments>
      {surfaces.map((z) => (
        <mesh key={z} receiveShadow geometry={flat} rotation={FLAT} position={[0, z + 0.02, 0]}>
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

/** Sky, horizon and ground of the gradient the table stands under. */
const SKY = "#9fb0c8";
const HORIZON = "#4d5462";
const GROUND = "#1a1d23";

/**
 * The sky the table stands under, as a tiny gradient environment.
 *
 * Every material on the table is a `MeshStandardMaterial`, and a standard material with no
 * environment has nothing to reflect: the gunmetal on a tank's tracks and gun barrels is set
 * `metalness: 0.4`, and metalness with no environment does not read as metal — it only removes the
 * diffuse colour, which is why the accents came out as flat dark shapes. A gradient from an
 * overcast sky down through a dull horizon to the table itself is enough to put a soft highlight
 * along every top edge, and it costs one small gradient, blurred once at start-up.
 *
 * It is deliberately colourless and low-contrast. The table has to stay drab: this is an
 * environment to give edges away, not a skybox to look at.
 */
function useTableEnvironment(): void {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);

  useEffect(() => {
    // A column of colour repeated across the width. The size is not arbitrary: the pre-filter takes
    // a cube face a quarter of the source width, and below 128 the face is smaller than the tile the
    // sampler assumes, which samples the wrong place and — small enough — writes a shader constant
    // that will not even compile. The texture itself is thrown away as soon as it has been blurred.
    const width = 128;
    const height = 64;
    const data = new Float32Array(width * height * 4);
    const sky = new Color(SKY);
    const horizon = new Color(HORIZON);
    const ground = new Color(GROUND);
    const band = new Color();
    for (let y = 0; y < height; y++) {
      // `y = 0` is the top of an equirectangular map, so the sky is first and the table last.
      const t = y / (height - 1);
      band.copy(t < 0.5 ? sky : horizon).lerp(t < 0.5 ? horizon : ground, (t < 0.5 ? t : t - 0.5) * 2);
      for (let x = 0; x < width; x++) {
        const at = (y * width + x) * 4;
        data[at] = band.r;
        data[at + 1] = band.g;
        data[at + 2] = band.b;
        data[at + 3] = 1;
      }
    }
    const gradient = new DataTexture(data, width, height, RGBAFormat, FloatType);
    gradient.mapping = EquirectangularReflectionMapping;
    gradient.needsUpdate = true;

    const pmrem = new PMREMGenerator(gl);
    const target = pmrem.fromEquirectangular(gradient);
    scene.environment = target.texture;
    gradient.dispose();
    pmrem.dispose();

    return () => {
      scene.environment = null;
      target.dispose();
    };
  }, [gl, scene]);
}

/**
 * Enough light to read a table by, and enough shadow to believe it.
 *
 * The previous rig was ambient light with a lamp on top of it, which lit every face of every solid
 * equally: a ruin came out the colour of polystyrene and a tank was a flat blue shape. Form on this
 * table is the whole point — a player has to see that a wall is a wall and that a model is standing
 * in front of it — so the light is now a single key with the fill turned well down, and the key
 * casts. Contact with the ground is what makes the table look like a table rather than a diagram.
 *
 * The key comes over the viewer's left shoulder in the default orbit, so shadows fall away from the
 * camera and never across the thing that cast them. The hemisphere light is what keeps the shadowed
 * side legible: it is sky above and table below, so an unlit face goes cool and dim rather than
 * black, and nothing is ever a silhouette.
 */
export function Lighting({ size }: { size: BoardSize }) {
  useTableEnvironment();
  const centre = useMemo(() => new Vector3(size.width / 2, 0, -size.depth / 2), [size.width, size.depth]);
  const key = useRef<DirectionalLight>(null);

  /**
   * The shadow camera is orthographic and has to hold the whole table whatever angle it is seen
   * from, so it is sized by the table's half-diagonal plus headroom for the tallest ruin. At this
   * extent a 2048 map is about twenty texels across a 32 mm base, which is enough for a base to
   * cast a base-shaped shadow rather than a smudge.
   */
  const reach = Math.hypot(size.width, size.depth) / 2 + SHADOW_HEADROOM;
  const distance = Math.max(size.width, size.depth) * 1.5;

  useEffect(() => {
    const light = key.current;
    if (!light) return;
    // The target is not in the scene, so nothing else will update its world matrix. It never moves.
    light.target.position.copy(centre);
    light.target.updateMatrixWorld();
  }, [centre]);

  return (
    <>
      <ambientLight intensity={0.16} />
      <hemisphereLight args={["#b9c8dd", "#191c22", 0.55]} />
      <directionalLight
        ref={key}
        position={[centre.x - distance * 0.36, distance * 1.34, centre.z + distance * 0.42]}
        intensity={1.55}
        color="#fff3e4"
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-left={-reach}
        shadow-camera-right={reach}
        shadow-camera-top={reach}
        shadow-camera-bottom={-reach}
        shadow-camera-near={1}
        shadow-camera-far={distance * 3}
        shadow-bias={-0.0004}
        shadow-normalBias={0.03}
      />
      {/* A cool counter-light from the far side, so the unlit flank of a tank keeps its edges. */}
      <directionalLight position={[centre.x + distance * 0.6, distance * 0.35, centre.z - distance * 0.5]} intensity={0.42} color="#93abcc" />
    </>
  );
}
