# @grimstat/engine

The probability engine behind [Grimstat](https://grimstat.com)'s calculator. It answers "what does
this attack do to that target" with the whole damage distribution, computed exactly where the state
space allows and by sampling where it does not.

MIT licensed, with no dependencies.

```ts
import { run } from "./src/index";

const out = run(input);
// out.damage      the full damage PMF: damage[k] = P(exactly k damage)
// out.slain       the models-slain PMF
// out.warnings    what could not be modelled, and why
```

## Why the distribution and not the average

An average cannot separate a weapon that reliably does four damage from one that does nothing most of
the time and twelve occasionally. The figure a player usually wants is the chance of killing the
target outright, which lives in the tail of the distribution.

The engine therefore computes probability mass functions and convolves them, and falls back to
sampling only when the exact state space is too large to walk.

## How it works

`run()` tries `runExact` first and drops to `runMonteCarlo` when the target is too large, adding a
warning when it does. You can force either with `input.backend`.

| File | What it is |
|---|---|
| `pmf.ts` | Probability mass functions over non-negative integers. `pmf[k] = P(X = k)`. Convolution, mixtures, binomial, trimming. Pure, zero-dependency, allocation-light. |
| `bivariate.ts` | The same over pairs, `B[a][b] = P(A = a, B = b)`. Needed because a hit roll can produce ordinary hits and critical hits at once, and the two are not independent. |
| `dice.ts` | Parsing and distributions for `3`, `D6`, `2D6+2`, `D3+1`. |
| `allocation.ts` | The defender as a mixed-radix state space: which models are alive and on how many wounds. This is the part that decides whether exact is affordable. |
| `exact.ts` | The exact solver, walking that state space. |
| `mc.ts` | The sampler used when it is not affordable. |
| `rng.ts` | `mulberry32`, so a Monte Carlo run is reproducible from a seed. |
| `engine.test.ts` | 900 lines. Golden cases worked by hand, plus property-based tests with fast-check, plus Monte Carlo checked against exact on targets small enough for both. |

## Running it

```bash
npm install
npm test
```

## Implementation notes

**The exact/sampled boundary.** `makeStateSpace` in `allocation.ts` encodes the defender's whole
condition as one integer. The size of that space is the product of the group sizes, so it grows
quickly. `runExact` returns nothing when the work would exceed its budget, which is measured from the
size of the problem rather than from a timeout.

**Bivariate because criticals are not independent.** A roll of 6 is both a hit and a critical hit.
Tracking hits and criticals as two separate distributions would double-count, so `bivariate.ts`
carries the joint distribution through the sequence.

**Monte Carlo is checked against exact.** The tests run both backends on targets small enough to
solve exactly and assert that they agree within tolerance.

## What is not here

The engine holds no Warhammer 40,000 rules, datasheets, points or profiles. It takes numbers and
returns distributions. Everything that knows what a keyword means lives in the application, which is
not published.
