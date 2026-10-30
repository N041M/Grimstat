# @grimstat/engine

The probability engine behind the calculator in [Grimstat](https://grimstat.com). It works out what
an attack does to a target and returns the whole damage distribution. It is MIT licensed and has no
dependencies.

```ts
import { run } from "./src/index";

const out = run(input);
// out.damage      the full damage PMF: damage[k] = P(exactly k damage)
// out.slain       the models-slain PMF
// out.warnings    what could not be modelled, and why
```

## Why the distribution and not the average

An average cannot tell a weapon that reliably does four damage from one that usually does nothing
and occasionally does twelve. The figure a player usually wants is the chance of killing the target
outright, and that figure is in the tail of the distribution.

## How it works

`run()` tries `runExact` first. When the target is too large to solve exactly, it calls
`runMonteCarlo` instead and adds a warning. You can force either one with `input.backend`.

| File | What it is |
|---|---|
| `pmf.ts` | Probability mass functions over non-negative integers, where `pmf[k] = P(X = k)`. It has convolution, mixtures, the binomial distribution and trimming. |
| `bivariate.ts` | The same over pairs, where `B[a][b] = P(A = a, B = b)`. |
| `dice.ts` | The parser for dice expressions such as `3`, `D6`, `2D6+2` and `D3+1`, and their distributions, with a re-roll of ones or of the whole roll. |
| `allocation.ts` | The defender as a mixed-radix state space, which records which models are alive and how many wounds each has left. |
| `exact.ts` | The exact solver, which walks that state space. |
| `mc.ts` | The sampler that runs when the exact solver would cost too much. |
| `rng.ts` | `mulberry32`, a seeded generator, so a Monte Carlo run can be repeated from its seed. |
| `work.ts` | Counters of the work the exact solver does: convolutions, table builds, events and the states those events read. Tests read them to check what a run costs. |
| `engine.test.ts` | About 1,100 lines of tests. They have cases worked out by hand, property-based tests with fast-check, Monte Carlo runs checked against the exact solver on targets small enough for both, and bounds on the work a run takes. |
| `work.test.ts` | Checks that each counter counts what it names. A cost test that read a counter which never moves would always pass. |

## Running it

```bash
npm install
npm test
```

`npm test` runs 51 tests.

## Implementation notes

### Where exact stops and sampling starts

`makeStateSpace` in `allocation.ts` encodes the defender's whole condition as one integer. The size
of that space is the product of the group sizes, so it grows quickly. `runExact` returns `null` when
the work would exceed its budget. The budget is measured from the size of the problem rather than
from a timeout, so the same input always takes the same path.

### Why hits and criticals are tracked together

A roll of 6 is both a hit and a critical hit, so the number of hits and the number of criticals are
not independent. Two separate distributions would count those rolls twice. `bivariate.ts` carries the
joint distribution through the sequence instead.

## What is not here

The engine holds no Warhammer 40,000 rules, datasheets, points or profiles. It takes numbers and
returns distributions. The code that knows what a keyword means is in the application, which is not
published.
