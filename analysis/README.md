# @grimstat/analysis

The army-level analyses behind [Grimstat](https://grimstat.com). The [engine](../engine/) works out
what one unit does to another. This package builds many such scenarios, runs them and combines the
results to answer questions about whole armies.

It is MIT licensed. It depends on the engine in this repository and on nothing else.

## Any game system

None of the analyses reads a Strength, a Toughness or a save. A game system passes `createAnalyses`
an `AnalysisHost`. The host has a function that scores one scenario, the preset units to score
against, and the one-at-a-time changes the what-if analysis offers. The rest of the arithmetic is the
same for every game.

`modularity.test.ts` checks this. It defines a made-up game in which damage is one number times the
attacker's model count and nothing has a save or a hit roll. It then runs every analysis over that
game.

## What it computes

| File | What it is |
|---|---|
| `analyses.ts` | The matchup matrix, the durability profile and index, the efficiency ranking, incoming fire, effective wounds, and the removal chain. The removal chain counts how many activations of one unit it takes to remove another. |
| `sensitivity.ts` | The what-if analysis. It reruns a scenario under one change at a time and reports the difference each change makes. |
| `reverse.ts` | The reverse search. Given a target, it ranks single units and small combinations by the points they cost to remove it. |
| `exchange.ts` | What two units do to each other in turn. The survivors shoot back with only the models they have left. |
| `turn.ts` | The whole-turn optimiser. It assigns every attacker to a target and to at most one option that costs command points, within a budget. Each target's state carries over from one attacker to the next, so overkill and a target that is already dead are counted exactly. A greedy pass gives a first plan, and a local search improves it. |
| `host.ts` | The `AnalysisHost` interface that a game system implements. |
| `schema.ts` | The scenario and result types, written out for this repository. In the app they come from a schema package that is not published. |

## Running it

```bash
npm install
npm test
```

`npm install` links the engine from `../engine`. `npm test` runs 16 tests. They use made-up game
systems, so none of them needs any game data.
