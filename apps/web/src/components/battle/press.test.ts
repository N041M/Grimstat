import { describe, expect, it } from "vitest";
import { PerspectiveCamera, Ray, Raycaster, Vector2, Vector3 } from "three";
import type { Vec2 } from "@grimstat/board";
import { boardPointOn, press } from "./press";

/** The orbit view's rig: a 42° lens 36° above a 60 × 44 table, aimed at the middle of it. */
const ELEVATION = (36 * Math.PI) / 180;
const TABLE = { width: 60, depth: 44 };

function rig(): PerspectiveCamera {
  const camera = new PerspectiveCamera(42, 850 / 820, 0.5, 600);
  const away = 80;
  camera.position.set(TABLE.width / 2, away * Math.sin(ELEVATION), -TABLE.depth / 2 + away * Math.cos(ELEVATION));
  camera.lookAt(TABLE.width / 2, 0, -TABLE.depth / 2);
  camera.updateMatrixWorld();
  return camera;
}

/** The pointer ray through the pixel a board point at this height is drawn at. */
function rayThrough(camera: PerspectiveCamera, at: Vec2, height: number): Ray {
  const ndc = new Vector3(at.x, height, -at.y).project(camera);
  const caster = new Raycaster();
  caster.setFromCamera(new Vector2(ndc.x, ndc.y), camera);
  return caster.ray;
}

/** A press carries the pointer that made it; nothing here reads more of the event than that. */
const pointer = { pointerId: 3, button: 0 } as PointerEvent;

const apart = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);

describe("a press on the table", () => {
  it("reads the point where the ray crosses the height asked for", () => {
    const camera = rig();
    const roof = { x: 22, y: 15 };
    const p = press(pointer, rayThrough(camera, roof, 9), roof);
    expect(apart(p.at(9), roof)).toBeLessThan(1e-6);
    // Nine inches lower the same ray has run on across the table, which is the whole of the problem.
    expect(apart(p.at(0), roof)).toBeGreaterThan(10);
    expect(p.event.pointerId).toBe(3);
  });

  /*
   * A drag casts the pointer against a horizontal plane at the height of the thing it is moving.
   * The grab has to be taken on that same plane, or the offset between the pointer and the piece
   * is out by the height of whatever the press landed on, for the whole of the drag.
   */
  it("holds a piece still when the drag's first frame is the press itself", () => {
    const camera = rig();
    const centre = { x: 20, y: 14 };
    const roof = { x: 22, y: 15 };
    const ray = rayThrough(camera, roof, 9);

    // Terrain is dragged along the table, so both ends of the gesture are read there.
    const p = press(pointer, ray, roof);
    const grab = p.at(0);
    const offset = { x: centre.x - grab.x, y: centre.y - grab.y };
    const frame = boardPointOn(ray, 0)!;
    expect(apart({ x: frame.x + offset.x, y: frame.y + offset.y }, centre)).toBeLessThan(1e-9);

    // Taken on the roof that was pressed instead, the same frame throws the piece a ruin's height
    // across the table.
    const surface = { x: centre.x - roof.x, y: centre.y - roof.y };
    expect(apart({ x: frame.x + surface.x, y: frame.y + surface.y }, centre)).toBeGreaterThan(10);
  });

  it("holds a model on an upper floor still, on the floor's own plane", () => {
    const camera = rig();
    const model = { x: 31, y: 25 };
    const storey = 4;
    // The press lands on the model's head, two inches above the floor it is standing on.
    const head = { x: 31.3, y: 25.2 };
    const ray = rayThrough(camera, head, storey + 2);

    const grab = press(pointer, ray, head).at(storey);
    const offset = { x: model.x - grab.x, y: model.y - grab.y };
    const frame = boardPointOn(ray, storey)!;
    expect(apart({ x: frame.x + offset.x, y: frame.y + offset.y }, model)).toBeLessThan(1e-9);
  });

  it("falls back to the surface for a ray that never reaches the plane", () => {
    const surface = { x: 12, y: 9 };
    const flat = new Ray(new Vector3(0, 6, 0), new Vector3(1, 0, 0));
    expect(boardPointOn(flat, 0)).toBeUndefined();
    expect(press(pointer, flat, surface).at(0)).toEqual(surface);
  });
});
