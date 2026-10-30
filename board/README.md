# @grimstat/board

The table geometry behind [Grimstat](https://grimstat.com)'s battle table. It answers the questions
the rules ask about space: how far apart two models are, whether one can see the other, whether the
target is in cover, where a model can move to, whether a unit is coherent, and who holds an
objective. Each answer comes from the shapes of the models and the terrain.

MIT licensed, with no dependencies. It knows nothing about WebGL. The renderer in the app is the
only place that maps its coordinates to the screen.

```ts
import { canSee, circleBase, distance, terrain } from "./src/index";
```

## The model of the table

Units are inches. The table is the `xy` plane and `z` points up. A model is its base swept upwards
to the model's height, so round bases, oval bases and vehicle footprints all become a circle or a
capsule in cross section. That keeps every distance query in closed form. Terrain is a polygon
footprint swept upwards, with trait flags and any number of floors that models can stand on.

| File | What it is |
|---|---|
| `vec.ts` | Points, segments and polygons in two and three dimensions, and the tests between them. |
| `shapes.ts` | Models as solids: bases, heights, and the points on a hull that sight rays start and end at. |
| `distance.ts` | Measurement between the nearest points of two models. It keeps the horizontal and vertical gaps apart, because engagement range limits each one separately. Also unit coherency. |
| `terrain.ts` | Terrain pieces, their traits and floors, and a spatial index so a ray only tests the pieces near it. |
| `los.ts` | Line of sight and cover. Rays are cast between sample points on the two hulls and one clear ray is enough. The rays are returned with the verdict, so the app can draw why a model is or is not visible. |
| `movement.ts` | Where a model can go. It is a shortest-path search over the surfaces of the table, which are the ground and every floor of every piece, so climbing to a first floor costs the height climbed. |
| `board.ts` | The table size, deployment zones and objectives. |
| `layout.ts` | Generic terrain layouts as data, with a check that reports floors outside their piece and other faults. None of them comes from a published mission pack. |

## Running it

```bash
npm install
npm test
```

`npm test` runs 174 tests. The geometry and terrain tests are property-based with fast-check, and
the line-of-sight tests set up the cases the terrain rules turn on: a model inside a ruin, a model on
an upper floor, a low wall in front of a tall vehicle.

## What is not here

The rules numbers that make movement a rules question, such as how high a model can step over
terrain, arrive in a `MoveRules` object that the game system supplies. The layouts are generic
arrangements. Mission packs, like all rules text in the app, are imported by the user and are not
part of this code.
