# Battle Simulator — design plan

> Status: proposal (10 Sep 2026), rescoped to 3D (11 Sep 2026). Builds on the existing engine, rules
> plugin, resolver and army builder.

## Goal

A **3D** battle simulator for Warhammer 40,000 (11th edition) that serves three jobs:

1. **Plan** — lay out deployment and movement for a matchup (your list vs a pasted opponent list) on a
   real-sized table with three-dimensional terrain, objectives and deployment zones; measure, check
   *true* line of sight and cover, see threat and charge ranges, save and share plans.
2. **Simulate** — step through battle rounds and phases with the probability engine resolving
   shooting, overwatch and fights (expected-value mode for planning, rolled-dice mode for play), with
   wounds, casualties, CP and VP tracked on the table.
3. **Play against the computer** — an AI opponent that deploys, moves, shoots, charges, fights and
   scores against you, with difficulty levels, a battle log and replay.

Non-goals for v1: rigid-body physics, sculpted miniature models or any GW artwork (abstract proxies
only), online multiplayer, full fidelity for every datasheet ability (the same three-tier honesty as
the stats engine applies).

## Why 3D is the *kernel* decision, not a rendering decision

40k's core geometric questions are genuinely three-dimensional, and a 2D kernel has to fake all of
them:

| Rule | What 2D forces | What 3D gives |
|---|---|---|
| Visibility ("if a model can see any part of the target") | a flag per terrain piece; ruins are either walls or not | a real ray against real solids: a Rhino sees over a wall a Guardsman cannot |
| Obscuring / height classes | a look-up table of hand-tuned exceptions | falls out of the geometry — terrain height vs model height vs distance |
| Models on upper floors of ruins | not representable | a floor is a horizontal surface at a height, and models stand on it |
| Vertical movement (climbing, dropping) | ignored, or a flat penalty | the vertical leg is measured and charged against Move |
| Engagement range (1" horizontally, 5" vertically) | horizontal only | exactly as written |
| Cover from a footprint that a tall model shoots over | wrong in both directions | derived from the same ray casts as visibility |

So the geometry kernel is 3D from the first commit, and the renderer is a consumer of it — not the
other way round. Everything below is a straight-line consequence.

## What already exists that this reuses

| Need | Existing piece |
|---|---|
| Attack resolution with distributions and dice | `@grimstat/engine` (exact + Monte Carlo, chained defender states) |
| Stats → probabilities under 11e/10e rules, cover, modifiers, keywords | `@grimstat/game-40k-11e` `runScenario`, `RULES` |
| Target allocation under a CP budget | `optimiseTurn` (joint plan evaluation, greedy + local search) |
| Kill probabilities for charge/fight decisions | `runScenario` with `phase: "fight"`, `charged` |
| Army lists with wargear, leaders, enhancements, points | Armies (rosters) + `unitFromRosterUnit` |
| Opponent lists from text | `importRosterText` (GW app, New Recruit, Grimstat dialects) |
| Data, overrides, effects | snapshots, override packs, Tier-1/2/3 effects |
| Worker execution, Dexie storage, permalinks, PWA | `apps/web` infrastructure |

## Architecture (new packages, same principles: rules are data or plugins)

```
packages/
  board      3D geometry kernel (pure, zero-dep, no WebGL): inches, models as extruded base hulls,
             terrain as extruded polygons with floors, true 3D distance, true line of sight, cover,
             coherency, engagement range, deployment zones, objective control, reachability with
             climbing, charge geometry
  game       battle state machine: rounds, phases, player turns, unit/model state (positions in 3D,
             wounds, battle-shock, reserves, embarked), action log (seeded, replayable), rule hooks
             per phase, scoring; missions and terrain layouts are DATA packages; resolution delegates
             to the engine
  ai         computer opponent: deployment, movement, targeting, charging, fighting, stratagems,
             scoring priorities; difficulty = search budget + noise; also a "coach" that suggests
             moves to the human
apps/web
  Battle page: WebGL table (react-three-fiber), orbit + top-down cameras, drag models on the ground
  plane and onto floors, measuring tape, LoS ray tool, range and threat volumes, phase bar, unit
  cards, dice/battle log, plan/play/vs-AI modes, save/replay/export
```

### Coordinate system and the model abstraction

- **Units are inches. `x`/`y` span the table, `z` is up.** Wargamers measure across a table, so the
  table is the `xy` plane; the renderer maps `(x, y, z) → three.js (x, z, −y)` in one place.
- **A model is an extruded base hull**: a circle (`r`) or an oval (a capsule: `r` plus a half-length
  and a facing), swept from its feet `z` to `z + height`. Round bases, oval bases and hull footprints
  for vehicles all reduce to circle-or-capsule cross sections, which keeps every distance query
  closed-form. Base sizes and heights come from data (datasheet base size where known, a per-keyword
  height table otherwise: INFANTRY 2", CHARACTER 2.5", BIKE 2", MONSTER/WALKER 4", VEHICLE 3.5"…),
  and both are overridable per model like every other datum.
- **Terrain is an extruded polygon with traits and floors**: a footprint polygon, a base elevation, a
  height, trait flags (`obscuring`, `light-cover`, `heavy-cover`, `impassable`, `difficult`,
  `breachable`, `scalable`, `defensible`), a keyword allow-list for passage (INFANTRY through ruin
  walls), and zero or more *floors* — horizontal surfaces at given heights that models can stand on.
  A ruin is one prism with floors and `breachable` walls; a crater is a prism 0.5" tall with
  `light-cover`; a bastion is `impassable` with a floor on top.
- **Everything pure**: no WebGL, no DOM, no randomness except an injected RNG. Unit-tested against
  synthetic layouts, property-tested for the invariants (distance symmetry, triangle inequality on
  free space, visibility symmetry).

### `board` — the 3D geometry kernel

- `distance(a, b)` — true shortest distance between two model hulls: horizontal gap between the base
  cross sections combined with the vertical gap between the `[z, z+h]` spans (`hypot` of the two, so
  a model 3" up and 4" across is 5" away, exactly as a tape measure held taut would read).
- `withinEngagementRange(a, b)` — the 11e split test: ≤1" horizontally **and** ≤5" vertically.
- `visible(from, to, terrain)` — **true line of sight**: cast rays from sample points on the
  observer's hull (base rim × eye heights) to sample points on the target's hull, against the terrain
  prisms; returns whether *any* ray is unblocked, plus the fraction that are (used for cover and for
  the AI's positional terms). Obscuring terrain is a solid the ray cannot cross unless the target is
  inside it or the observer is within the 11e exemptions — all expressed as trait data.
- `coverFrom(target, attacker, terrain)` — benefit of cover derived from the same ray casts, plus the
  footprint rule, plus per-trait overrides.
- `coherent(unit)` — 2" to another model (6+ models: two others), the standard check.
- `inZone(model, zone)` / `controls(objective, models)` — deployment zones as prisms, objective
  control by OC sum inside a 3" cylinder.
- `reachable(model, move, terrain)` — where a model can end its move: a horizontal sampling grid with
  a visibility-graph refinement, **charging the vertical legs** (climb up/down costs the height
  difference), honouring `impassable`, `difficult`, keyword passage and the "ignore terrain ≤ 2""
  allowance; returns a reachable set *and* the cheapest path to any point, so drag-to-move can show
  the cost live.
- `chargeGeometry(unit, target, terrain)` — minimum roll needed for the closest model to reach
  engagement range along a legal path, fed through the engine's 2D6 PMF for the probability.
- `hidden(unit, enemies, terrain)` — the 15" HIDDEN rule and Lone Operative, both LoS-dependent.

### `game` — state machine and rules hooks

- `BattleState`: mission, board, terrain, two `Army`s (from rosters via `unitFromRosterUnit`),
  per-unit state (model positions in 3D, wounds remaining per model, destroyed models,
  battle-shocked, in reserves / deep strike / embarked, advanced/fell back/charged flags), CP, VP,
  round, phase, active player, RNG seed, action log.
- Phase sequence as data from the game-system plugin: Command (CP, battle-shock tests, scoring hooks)
  → Movement (move/advance/fall back, reserves arrival, disembark; overwatch window at end) →
  Shooting (declare targets, resolve via engine) → Charge (declare, roll, move) → Fight (fights-first
  ordering, pile-in, resolve, consolidate). Each phase exposes `legalActions(state)` and
  `apply(state, action)`; a rules-hook registry lets plugins add or modify steps (the same slot-in
  pattern as effects and widgets).
- Resolution: a shooting action builds one scenario per (unit, target) with the board supplying range
  band, visibility, cover, HIDDEN/Lone Operative eligibility, charged/stationary flags, and toggles
  from active stratagems and Tier-2 abilities; **planning mode** applies expected damage (fractional
  wounds shown, casualties as expectations), **play mode** samples an actual outcome from the same
  pipeline (seeded) and allocates damage to models per the allocation policy with defender choice for
  the human.
- Missions and terrain layouts are data packages: deployment zones, objective footprints, primary
  scoring (a small DSL: hold N, hold more, hold in enemy zone…), secondaries as scorable hooks, and
  the 11e Force Disposition → mission generation table. The repo ships generic symmetric layouts
  (authored in the layout schema, heights and floors included) and a generic capture-and-hold mission
  set; official mission packs are user-imported like every other rules text.
- Determinism: the seed plus the action log reproduce a battle exactly; undo = replay to N−1; export
  a battle report (Markdown) and a replay file (JSON). Model positions are part of the log, so a
  replay is a camera-independent record.

### `ai` — the computer opponent

- **Evaluation function** V(state) = VP differential estimate + objective control (weighted by
  remaining rounds) + material swing (expected damage dealt minus expected damage suffered next turn,
  both from the engine and cached by (attacker, target, context) like the optimiser) + positional
  terms (in cover, out of LoS, on a floor with sight lines, screened, within charge threat) — all of
  which the 3D kernel can now actually measure.
- **Deployment**: score candidate spots per unit (objective proximity, LoS exposure sampled against
  likely enemy firing positions, screening, reserves for deep-strike units) and place greedily with a
  couple of swap passes.
- **Movement**: per unit sample K candidate destinations from `reachable` (hold objective, advance to
  objective, cover spot, upper floor with sight lines, charge staging inside threat range, retreat
  out of threat), evaluate the whole-turn plan with the target allocation optimiser after tentative
  moves, iterate two greedy passes.
- **Shooting**: `optimiseTurn` with the board-derived context and CP budget; **charges**: expected
  value of the fight vs staying, with the real charge distance from `chargeGeometry`; **fights**: the
  same engine with `phase: "fight"`; **stratagems**: options with CP costs, one per unit per phase;
  **scoring**: secondaries picked by expected achievability.
- **Difficulty**: Easy (greedy, no lookahead, noise), Normal (greedy + local search, one-ply lookahead
  on enemy shooting), Hard (adds Monte Carlo rollouts of the next enemy turn, bigger candidate sets).
  Unmodelled (Tier-3) abilities are simply not used by the AI; the human can apply them manually.
- **Coach mode**: the same planner runs for the human side and suggests deployment/moves/targets with
  expected outcomes.

### Web app — the 3D table

- **Renderer**: `three` + `@react-three/fiber` (+ `drei` for controls/helpers), lazily loaded so the
  calculator's bundle is untouched by anyone who never opens the Battle page.
- **Look**: abstract, legally clean, readable from above — a matt table, terrain as extruded solids
  with faces tinted by trait, models as base discs with a simple extruded silhouette (a proxy volume,
  never a sculpt) in faction colour, wound pips and unit labels as billboards that stay upright and
  scale with distance.
- **Cameras**: an orbit camera for the immersive view and an orthographic top-down camera one key
  away — the top-down camera *is* the old 2D planning view, so nothing is lost by going 3D.
- **Interaction**: drag a unit on the ground plane with a legality ghost (green/red) and a live path
  cost; hold to lift onto a floor; click a floor surface to place; snap to coherency; box-select;
  measuring tape between any two picked points; a LoS tool that draws the actual rays the kernel
  tested (blocked ones in red) — the single best feature 3D unlocks, because it *explains* a
  visibility answer instead of asserting it.
- **Overlays as geometry**: movement range as a decal on the walkable surfaces, threat range as a
  translucent volume, charge range as a ring on the ground plus reachable floors, objective control
  cylinders, deployment zones as tinted floor regions.
- **Performance budget**: instanced meshes for models and terrain, one draw call per material class,
  60 fps for 200 models on integrated graphics; overlays recomputed off the main thread.
- **Accessibility and fallback**: the top-down camera plus a full keyboard/list interface (select
  unit → pick action from a list with the same numbers) means the game is playable without a mouse
  and, if WebGL is unavailable, the page degrades to a top-down canvas render of the same scene
  graph. Everything the 3D view shows is also available as text (distances, visibility verdicts,
  expected damage).

## Phases

| Phase | Deliverable | Status |
|---|---|---|
| **B1 Geometry kernel** | `packages/board`: vectors, hulls, terrain prisms with floors, 3D distance, engagement range, true LoS, cover, coherency, zones, objective control | **done** |
| **B1b Movement & charge** | `reachable` with climbing and path cost, `chargeGeometry` with an exact final leg, `hidden`, the layout schema and four generic layouts with a validator | **done** |
| **B2a The table** | Battle page: r3f renderer, orbit and orthographic top-down cameras, terrain with floors, unit tokens and labels, drag *and* click to move with a live legality verdict, reach overlay, LoS ray tool, cover and charge readouts, measuring tape, layout picker | **done** |
| B2b Real armies | Deploy from a saved roster instead of the placeholder force, expected shooting from any unit to any target through the engine, save and share plans as permalinks | 1 session |
| B3 Resolution & missions | `packages/game`: phases, actions, dice mode, casualty allocation, CP/VP, generic missions, Force Disposition generation, hot-seat play, replay/undo, battle report | 2 sessions |
| B4 AI opponent v1 | `packages/ai`: deployment, movement, shooting, charges, fights, scoring; Easy/Normal; play vs computer end to end | 2 sessions |
| B5 Depth | Stratagems from data, Tier-2 abilities applied automatically, transports/reserves/deep strike, overwatch, battle-shock, leaders/support on the table, Hard difficulty with rollouts, coach mode | 2+ sessions |

### What the kernel settled along the way

Three answers fell out of the geometry that a 2D model would have had to hard-code, and one of them is
genuinely counter-intuitive:

- A wall that hides a 2" trooper does not hide a 3.5" Rhino, from the same spot, at the same range.
- A model on a ruin's **ground floor is already engaged** with one on the first floor above it —
  engagement range reaches five inches up, and 4.5" of storey is inside that. Charging "upstairs" to
  the first floor costs nothing extra; the second floor is what forces a climb.
- Climbing is paid for out of the Move characteristic, so a unit's threat range is not a circle. It
  is a shape that terrain carves, and `reachable` returns that shape rather than a radius.

Two performance notes for B4, where the AI will call all of this in a loop: a 6" move for a
ten-model unit costs about 60 ms at half-inch resolution, and a 10-versus-10 charge about 30 ms once
the search is bounded by the best answer found so far (it was 350 ms before that bound). Both need
the caching the AI section describes before they run inside a search.

### What the table settled

- **Both gestures, one verdict.** Dragging shows the cost as the pointer moves; clicking a
  destination commits. They share `dragVerdict`, so they can never disagree, and click-to-move is
  what makes the table usable with a finger or a trackpad.
- **The frame loop runs continuously.** Drawing on demand is cheaper, but a redraw requested while
  the tab is hidden is simply lost, and the page then shows a stale table or an empty one. This scene
  is nothing to draw; correctness wins.
- **Orbiting and dragging are the same gesture**, and the orbit controls listen below R3F's object
  picking, so grabbing a unit has to switch the camera off in the same tick — which is why the drag
  lives inside the canvas rather than around it.
- **three.js is lazily loaded and excluded from the reported bundle size.** It is 232 kB gzipped,
  bigger than the rest of the app together, and nobody who never opens the Battle page downloads any
  of it. Counting it in the About screen's figure would print a number no visitor experiences.

## Decisions (defaults chosen)

1. **Look**: abstract 3D proxies — base discs plus simple extruded silhouettes — on a schematic
   table. No sculpts, no GW artwork, no photogrammetry. Cheap to render and legally clean.
2. **Rules enforcement**: planning mode is advisory (warns, never blocks); play mode enforces core
   movement/targeting/charge rules and lets the human override with a note.
3. **AI ambition**: v1 plays legally and sensibly (Normal difficulty) rather than competitively; Hard
   comes with rollouts in B5.
4. **Missions**: ship generic layouts and a generic mission set; official mission packs and tournament
   layouts are user-imported data.
5. **Where it lives**: a new "Battle" section of the same PWA, reusing the worker, storage and
   permalink infrastructure; the 3D dependency is code-split behind that route.
6. **Model heights**: a keyword-derived default table shipped as data, overridable per datasheet and
   per model, and always shown in the UI — a guessed height must never masquerade as a rule.

## Risks

- **Rule fidelity creep**: mitigated by the tiered model and by scoping enforcement to core rules.
- **3D makes wrong answers look authoritative**: a rendered ray is very convincing. Mitigated by
  surfacing the inputs (this model is 2.0" tall *by assumption*; this ruin is `obscuring` *by
  layout*) next to every verdict, and by the honesty tiers the stats engine already uses.
- **Engine call volume in AI search**: mitigated by the scenario cache and by capping candidate sets
  per difficulty.
- **Ray-cast cost**: LoS between two 10-model units is 100 model pairs × sample rays. Mitigated by
  hull-level early-outs (bounding cylinders, terrain broad-phase grid), caching per (unit, unit,
  positions-version), and running batches in the worker.
- **Bundle size and device support**: three.js is lazily loaded on the Battle route only; the
  top-down fallback keeps the page usable without WebGL.
- **Geometry edge cases** (ovals, hulls, ruins with breachable walls, models part-way up a ladder):
  start with circles, capsules and prisms with floors; add authored hull footprints per datasheet
  later.
- **Content rights**: no official layouts, missions or artwork in the repo.
