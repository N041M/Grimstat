/**
 * `@grimstat/board` — the 3D geometry kernel for the battle simulator.
 *
 * Pure, zero-dependency and free of WebGL: inches on the `xy` table plane with `z` up, models as
 * extruded base hulls, terrain as extruded polygons with floors. Everything the rules need to ask
 * about space — how far, can it see, is it in cover, is the unit coherent, who holds the objective —
 * answered from real geometry rather than from a table of special cases.
 */

export * from "./vec";
export * from "./shapes";
export * from "./terrain";
export * from "./distance";
export * from "./los";
export * from "./movement";
export * from "./board";
export * from "./layout";
