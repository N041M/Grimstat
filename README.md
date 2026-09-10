# Grimstat (working name)

An **unofficial, fan-made, local-first** statistics dashboard and army builder for Warhammer 40,000.

- Models unit-vs-unit and army-vs-army interactions with exact probability distributions (Monte Carlo fallback).
- Army builder with 11th-edition validation (Detachment Points, Leader/Support, tiered points).
- Everything that changes with a codex, dataslate or edition is **data or a plugin** — never core code.

## Data policy

This repository contains **no Games Workshop rules text, datasheets, points or artwork**. The app ships *importers*; game data is fetched onto the user's own machine from community sources (BSData, the online Munitorum Field Manual, Wahapedia CSV export) on first run and cached locally. Imported data lives in `data/` which is git-ignored.

Warhammer 40,000 and all associated marks are the property of Games Workshop Limited. This project is not affiliated with, endorsed by, or sponsored by Games Workshop.

## Layout

```
packages/schema        canonical data model (Zod) — no GW text
packages/engine        pure probability engine (exact PMF + Monte Carlo)
packages/effects       Tier-1 keyword / Tier-2 effect record registry
packages/game-40k-11e  40k 11th edition game-system plugin (keywords, patterns, constraints, analyses)
packages/resolver      roster legality runner + costing (shared by UI, CLI, tests)
packages/game-40k-10e  10th edition as rule-parameter overrides on the same pipeline
packages/adapters      importers (MFM YAML, BSData JSON, Wahapedia CSV) and exporters
packages/snapshot      merge, overrides, immutable snapshots, diffs
packages/entitlements  feature gating abstraction (local: everything unlocked)
packages/plugin-host   plugin manifest loader + registration API
apps/cli               node CLI: import → snapshot → simulate
apps/web               Vite + React offline PWA
docs/DESIGN.md         full design & research document
```

## Getting started

```bash
corepack enable
pnpm install
pnpm test          # 204 tests: engine golden cases, MC-vs-exact, rules plugin, adapters, resolver, web
pnpm dev           # calculator PWA at http://localhost:5173 (use "Load sample data" on the Data page)
```

Import real game data onto your own machine (never committed), then load the resulting JSON on the Data page:

```bash
pnpm cli import --system wh40k-11e --out data/snapshots            # MFM points + BSData structure + Wahapedia text
pnpm cli import --system wh40k-10e --out data/snapshots            # 10th edition (Wahapedia's 10e export; 10e codexes stay legal)
pnpm cli show data/snapshots/<snapshot>.json "Intercessor Squad"
pnpm cli diff data/snapshots/<old>.json data/snapshots/<new>.json
```

Scenarios built from a 10th-edition snapshot run under the 10th-edition rules model automatically (`scenario.gameSystemId`).

See `docs/DESIGN.md` for the research findings, architecture and roadmap.
