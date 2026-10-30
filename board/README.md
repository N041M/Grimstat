# @grimstat/board

The table geometry behind the battle table in [Grimstat](https://grimstat.com). It answers the
questions the rules ask about space. It measures how far apart two models are, decides whether one
can see the other and whether the target is in cover, finds where a model can move, checks whether a
unit is coherent, and says who holds an objective. Each answer is worked out from the shapes of the
models and the terrain.

It is MIT licensed and has no dependencies. It does not use WebGL. The renderer in the app is the
only code that maps its coordinates to the screen.

```ts
import { canSee, circleBase, distance, terrain } from "./src/index";
```

## The model of the table

Units are inches. The table is the `xy` plane and `z` points up. A model is its base swept upwards
to the model's height, so round bases, oval bases and vehicle footprints all have a circle or a
capsule as their cross section. Every distance query then has a closed-form answer. A terrain piece
is a polygon footprint swept upwards, with trait flags and any number of floors that models can
stand on.

| File | What it is |
|---|---|
| `vec.ts` | Points, segments and polygons in two and three dimensions, and the intersection and distance tests between them. |
| `shapes.ts` | Models as solids, with their bases, their heights, and the points on a hull that sight rays start and end at. |
| `distance.ts` | Measurement between the nearest points of two models, and unit coherency. It keeps the horizontal and vertical gaps apart, because engagement range limits each one separately. |
| `terrain.ts` | Terrain pieces, their traits and floors, and a spatial index that lets a ray test only the pieces near it. |
| `los.ts` | Line of sight and cover. Rays are cast between sample points on the two hulls, and one clear ray is enough. The rays are returned with the verdict, so the app can draw why a model is or is not visible. |
| `movement.ts` | Where a model can go. It is a shortest-path search over the surfaces of the table, which are the ground and every floor of every piece. Climbing to a first floor costs the height climbed. |
| `board.ts` | The table size, the deployment zones and the objectives. |
| `layout.ts` | Generic terrain layouts as data, and a check that reports faults such as a floor outside its piece. None of the layouts comes from a published mission pack. |

## Running it

```bash
npm install
npm test
```

`npm test` runs 174 tests. The geometry and terrain tests are property-based tests with fast-check.
The line-of-sight tests set up the cases the terrain rules turn on, such as a model inside a ruin, a
model on an upper floor, and a low wall in front of a tall vehicle.

## What is not here

The numbers that make movement a rules question, such as how high a model can step over terrain,
come in a `MoveRules` object that the game system supplies. The layouts are generic arrangements.
Mission packs are imported by the user, like all rules text in the app, and are not part of this
code.
