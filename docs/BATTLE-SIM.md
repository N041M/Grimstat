# Battle Simulator — design plan

> Status: proposal (10 Sep 2026). Builds on the existing engine, rules plugin, resolver and army builder.

## Goal

A top-down, 2D battle simulator for Warhammer 40,000 (11th edition) that serves three jobs:

1. **Plan** — lay out deployment and movement for a matchup (your list vs a pasted opponent list) on a real-sized board with terrain, objectives and deployment zones; measure, check visibility and cover, see threat and charge ranges, save and share plans.
2. **Simulate** — step through battle rounds and phases with the probability engine resolving shooting, overwatch and fights (expected-value mode for planning, rolled-dice mode for play), with wounds, casualties, CP and VP tracked on the board.
3. **Play against the computer** — an AI opponent that deploys, moves, shoots, charges, fights and scores against you, with difficulty levels, a battle log and replay.

Non-goals for v1: 3D rendering, physics, full fidelity for every datasheet ability (the same three-tier honesty as the stats engine applies), online multiplayer.

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
  board      geometry kernel (pure, zero-dep): units in inches, bases as circles, terrain as polygons
             with traits, distance (edge to edge), visibility/LoS, cover, coherency, deployment zones,
             footprint control, reachability (Move/Advance) with obstacles, charge geometry
  game       battle state machine: rounds, phases, player turns, unit/model state (positions, wounds,
             battle-shock, reserves, embarked), action log (seeded, replayable), rule hooks per phase,
             scoring; missions and terrain layouts are DATA packages; resolution delegates to the engine
  ai         computer opponent: deployment, movement, targeting, charging, fighting, stratagems, scoring
             priorities; difficulty = search budget + noise; also a "coach" that suggests moves to the human
apps/web
  Battle page: Canvas2D board (pan/zoom, drag units/models, snap, measure, LoS tool, overlays),
  phase bar, unit cards, dice/battle log, plan/play/vs-AI modes, save/replay/export
```

### `board` — geometry kernel
- Coordinates in inches; board sizes from battle size (Incursion 44"×30", Strike Force 60"×44", Onslaught 90"×44"). Bases as circles (base sizes from datasheets; ovals approximated by circles or two-circle capsules), vehicles/monsters as rectangles or hulls when a footprint is known.
- Terrain pieces: polygon footprint + traits (`obscuring`, `light-cover`, `impassable` with keyword exceptions such as INFANTRY through ruin walls, `difficult`, `objective` footprint) and a height class.
- Queries: `distance(a, b)` edge to edge; `within(a, b, x)`; `visible(fromModel, toModel)` via ray casts from base edge to base edge against obscuring polygons (11e visibility model as data flags: models wholly behind obscuring terrain are not visible; models inside are visible per the terrain's rules); `benefitOfCover(target, attacker)` per 11e cover-from-footprints rule; `coherent(unit)` (2" to another model, 9" to all); `inZone(model, zone)`; `controls(objectiveFootprint)` by OC sum; `reachable(model, distance, obstacles)` on a 0.5" sampling grid with a visibility-graph path check; `chargeDistance(unit, target)` (models to engagement range, 2D6 PMF from the engine's dice tools); `hidden(unit)` for the 15" HIDDEN rule and Lone Operative.
- Everything pure and unit-tested with synthetic layouts; no rendering.

### `game` — state machine and rules hooks
- `BattleState`: mission, board, terrain, two `Army`s (from rosters via `unitFromRosterUnit`), per-unit state (model positions, wounds remaining per model, destroyed models, battle-shocked, in reserves / deep strike / embarked, advanced/fell back/charged flags), CP, VP, round, phase, active player, RNG seed, action log.
- Phase sequence as data from the game-system plugin: Command (CP, battle-shock tests, scoring hooks) → Movement (move/advance/fall back, reserves arrival, disembark; overwatch window at end) → Shooting (declare targets, resolve via engine) → Charge (declare, roll, move) → Fight (fights-first ordering, pile-in, resolve, consolidate). Each phase exposes `legalActions(state)` and `apply(state, action)`; a rules-hook registry lets plugins add or modify steps (the same slot-in pattern as effects and widgets).
- Resolution: a shooting action builds one scenario per (unit, target) with the board supplying range band, visibility, cover, HIDDEN/Lone Operative eligibility, charged/stationary flags, and toggles from active stratagems and Tier-2 abilities; **planning mode** applies expected damage (fractional wounds shown, casualties as expectations), **play mode** samples an actual outcome from the same pipeline (seeded) and allocates damage to models per the allocation policy with defender choice for the human.
- Missions and terrain layouts are data packages: deployment zones, objective footprints, primary scoring (a small DSL: hold N, hold more, hold in enemy zone…), secondaries as scorable hooks, and the 11e Force Disposition → mission generation table. The repo ships generic symmetric layouts and a generic capture-and-hold mission set; official mission packs are user-imported like every other rules text.
- Determinism: the seed plus the action log reproduce a battle exactly; undo = replay to N−1; export a battle report (Markdown) and a replay file (JSON).

### `ai` — the computer opponent
- **Evaluation function** V(state) = VP differential estimate + objective control (weighted by remaining rounds) + material swing (expected damage dealt minus expected damage suffered next turn, both from the engine and cached by (attacker, target, context) like the optimiser) + positional terms (units in cover, hidden, screened, within charge threat).
- **Deployment**: score candidate deployment spots per unit (objective proximity, LoS-safe from likely enemy firing lanes, screening front-line units, reserves for deep-strike units) and place greedily with a couple of swap passes.
- **Movement**: per unit sample K candidate destinations (hold objective, advance to objective, cover spot, charge staging inside threat range, retreat out of threat), evaluate the whole-turn plan with the target allocation optimiser after tentative moves, iterate two greedy passes; respects reachability, coherency, engagement rules.
- **Shooting**: `optimiseTurn` with the board-derived context and CP budget; **charges**: expected value of the fight (kill probability, retaliation, being stuck) vs staying; **fights**: same engine with `phase: "fight"`; **stratagems**: options with CP costs, one per unit per phase; **scoring**: secondaries picked by expected achievability.
- **Difficulty**: Easy (greedy, no lookahead, noise), Normal (greedy + local search, one-ply lookahead on enemy shooting), Hard (adds Monte Carlo rollouts of the next enemy turn, bigger candidate sets). Unmodelled (Tier-3) abilities are simply not used by the AI; the human can apply them manually.
- **Coach mode**: the same planner runs for the human side and suggests deployment/moves/targets with expected outcomes.

### Web app
- Board renderer on Canvas2D (units as base circles with faction colour, model count/wounds pips, selected/hover states, terrain polygons, objectives, deployment zones, range and threat overlays, LoS rays, measurement tape); pan/zoom, snapping, multi-select, drag with legality feedback (green/red ghost); touch support.
- Side panels: phase bar with the current step and legal actions, unit card (from the datasheet), target picker with expected damage per candidate (engine, live), dice/battle log, VP/CP, mission card.
- Modes: **Plan** (free placement, advisory rules, expected outcomes, save/share plan permalinks per matchup), **Play** (rules enforced, dice, hot-seat or vs AI), **Replay**.
- Worker: board queries stay on the main thread (cheap); engine and AI run in the existing worker with progress/cancel.

## Phases

| Phase | Deliverable | Rough size |
|---|---|---|
| B1 Board kernel | `packages/board` with tests; terrain layout schema + 4 generic layouts; layout editor | 1 session |
| B2 Planning mode | Battle page: board renderer, deploy both lists, move with legality overlays, measure/LoS/cover/threat/charge tools, expected shooting from any unit to any target, save/share plans | 2 sessions |
| B3 Resolution & missions | `packages/game`: phases, actions, dice mode, casualty allocation, CP/VP, generic missions, Force Disposition generation, hot-seat play, replay/undo, battle report | 2 sessions |
| B4 AI opponent v1 | `packages/ai`: deployment, movement, shooting, charges, fights, scoring; Easy/Normal; play vs computer end to end | 2 sessions |
| B5 Depth | Stratagems from data, Tier-2 abilities applied automatically, transports/reserves/deep strike, overwatch, battle-shock, leaders/support on the board, Hard difficulty with rollouts, coach mode | 2+ sessions |

## Decisions to confirm (defaults chosen)

1. **Look**: abstract top-down tokens on a schematic board (default) rather than miniatures art or 3D. Keeps rendering cheap and legally clean.
2. **Rules enforcement**: planning mode is advisory (warns, never blocks); play mode enforces core movement/targeting/charge rules and lets the human override with a note.
3. **AI ambition**: v1 plays legally and sensibly (Normal difficulty) rather than competitively; Hard comes with rollouts in B5.
4. **Missions**: ship generic layouts and a generic mission set; official mission packs and tournament layouts are user-imported data.
5. **Where it lives**: a new "Battle" section of the same PWA, reusing the worker, storage and permalink infrastructure.

## Risks

- Rule fidelity creep: mitigated by the tiered model and by scoping enforcement to core rules.
- Engine call volume in AI search: mitigated by the scenario cache and by capping candidate sets per difficulty.
- Geometry edge cases (ovals, hulls, ruins with walls): start with circles and polygons, add hull footprints per datasheet later.
- Content rights: no official layouts, missions or artwork in the repo.
