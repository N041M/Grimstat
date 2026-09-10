import type { ThreeEvent } from "@react-three/fiber";
import { DoubleSide } from "three";
import type { ModelHull } from "@grimstat/board";
import { footReach } from "@grimstat/board";
import type { BattleUnit } from "../../lib/battle";
import { SCENE_COLOURS, SIDE_COLOURS } from "../../lib/battleScene";

/**
 * A model is a base disc with a plain tapered proxy standing on it.
 *
 * The proxy is a volume, never a sculpt: it is the height the kernel actually measured with, drawn
 * so the player can see why a wall does or does not hide it. An oval base is a cylinder stretched
 * along its facing — close enough at this scale, and the kernel measures the real capsule regardless.
 */
function ModelToken({ hull, colour, ghost, selected }: { hull: ModelHull; colour: string; ghost?: boolean; selected?: boolean }) {
  const r = hull.foot.r;
  const stretch = footReach(hull.foot) / r;
  const bodyR = r * 0.62;
  return (
    <group position={[hull.pos.x, hull.pos.z, -hull.pos.y]} rotation={[0, -hull.facing, 0]} scale={[stretch, 1, 1]}>
      <mesh position={[0, 0.08, 0]}>
        <cylinderGeometry args={[r, r, 0.16, 22]} />
        <meshStandardMaterial color={colour} transparent={ghost} opacity={ghost ? 0.45 : 1} roughness={0.7} />
      </mesh>
      <mesh position={[0, 0.16 + hull.height / 2, 0]}>
        <cylinderGeometry args={[bodyR * 0.55, bodyR, hull.height, 14]} />
        <meshStandardMaterial color={colour} transparent opacity={ghost ? 0.3 : 0.82} roughness={0.6} />
      </mesh>
      {selected ? (
        <mesh position={[0, 0.19, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[r + 0.06, r + 0.24, 28]} />
          <meshBasicMaterial color={SCENE_COLOURS.selected} side={DoubleSide} />
        </mesh>
      ) : null}
    </group>
  );
}

export function UnitTokens({
  units,
  selectedId,
  onSelect,
  onGrab,
}: {
  units: readonly BattleUnit[];
  selectedId?: string;
  onSelect?: (id: string) => void;
  onGrab?: (id: string) => void;
}) {
  return (
    <group>
      {units.map((unit) => (
        <group
          key={unit.id}
          onPointerDown={(e: ThreeEvent<PointerEvent>) => {
            e.stopPropagation();
            onSelect?.(unit.id);
            onGrab?.(unit.id);
          }}
          onPointerOver={() => {
            document.body.style.cursor = "grab";
          }}
          onPointerOut={() => {
            document.body.style.cursor = "";
          }}
        >
          {unit.models.map((m) => (
            <ModelToken key={m.id} hull={m.hull} colour={SIDE_COLOURS[unit.side]} selected={unit.id === selectedId} />
          ))}
        </group>
      ))}
    </group>
  );
}

/** The translucent copy that follows the pointer during a drag, tinted by whether the move is legal. */
export function GhostUnit({ unit, legal }: { unit: BattleUnit; legal: boolean }) {
  return (
    <group>
      {unit.models.map((m) => (
        <ModelToken key={m.id} hull={m.hull} colour={legal ? SCENE_COLOURS.rayClear : SCENE_COLOURS.rayBlocked} ghost />
      ))}
    </group>
  );
}
