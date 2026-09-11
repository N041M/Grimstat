# Grimstat (working name)

An **unofficial, fan-made, local-first** statistics dashboard and army builder for Warhammer 40,000.

**Live app:** https://n041m.github.io/Grimstat/ (deployed from `master` by GitHub Actions; everything runs in your browser, nothing is uploaded).

- Models unit-vs-unit and army-vs-army interactions with exact probability distributions (Monte Carlo fallback).
- Army builder with 11th-edition validation (Detachment Points, Leader/Support, tiered points).
- A Codex: every datasheet of your snapshot laid out like a codex page, and any two to six side by side with the best value of each row marked.
- Everything that changes with a codex, dataslate or edition lives in **data or a plugin** rather than in core code.

## Data policy

This repository contains **no Games Workshop rules text, datasheets, points or artwork**. The app ships *importers*; game data is fetched onto the user's own machine from community sources (BSData, the online Munitorum Field Manual, Wahapedia CSV export) on first run and cached locally. Imported data lives in `data/` which is git-ignored.

Warhammer 40,000 and all associated marks are the property of Games Workshop Limited. This project is not affiliated with, endorsed by, or sponsored by Games Workshop.

## Layout

```
packages/schema        canonical data model (Zod) — no GW text
packages/engine        pure probability engine (exact PMF + Monte Carlo)
packages/board         3D battle-board geometry kernel (true line of sight, cover, measurement, movement)
packages/effects       Tier-1 keyword / Tier-2 effect record registry
packages/game-40k-11e  40k 11th edition game-system plugin (keywords, patterns, constraints, analyses)
packages/resolver      roster legality runner + costing (shared by UI, CLI, tests)
packages/game-40k-10e  10th edition as rule-parameter overrides on the same pipeline
packages/adapters      importers (MFM YAML, BSData JSON, Wahapedia CSV) and exporters
packages/snapshot      merge, overrides, immutable snapshots, diffs
packages/entitlements  feature gating abstraction (local: everything unlocked)
packages/plugin-host   plugin manifest loader + registration API
apps/cli               node CLI: import → snapshot → simulate
apps/web               Vite + React offline PWA (the Battle table is three.js, code-split)
docs/DESIGN.md         full design & research document
docs/BATTLE-SIM.md     3D battle simulator design plan
```

## Getting started

```bash
corepack enable
pnpm install
pnpm lint          # eslint (flat config, typescript-eslint + react-hooks)
pnpm test          # engine golden cases, MC-vs-exact, rules plugin, adapters, resolver, board geometry, web
pnpm dev           # calculator PWA at http://localhost:5173 (use "Load sample data" on the Data page)
```

Import real game data onto your own machine (never committed), then load the resulting JSON on the Data page:

```bash
pnpm cli import --system wh40k-11e --out data/snapshots            # MFM points + BSData structure + Wahapedia text
pnpm cli import --system wh40k-10e --out data/snapshots            # 10th edition (Wahapedia's 10e export; 10e codexes stay legal)
pnpm cli show data/snapshots/<snapshot>.json "Intercessor Squad"
pnpm cli diff data/snapshots/<old>.json data/snapshots/<new>.json
```

Gather published tournament lists onto your own machine. The CLI reads the feed directly but does not
fetch article pages, because their publishers gate them. Open the ones you want, save the page, and
point `--dir` at the folder:

```bash
pnpm cli competitive --feed https://<publication>/tag/competitive-innovations/feed/
pnpm cli competitive --dir ~/Downloads/write-ups --out data/competitive
```

Each list is stored as published, with the player, faction, detachments, Force Disposition, placing
and the URL it came from. The lists belong to the players named in them, and the file records that.

The web app reads the same files without the CLI. Drop saved write-up pages, or the corpus file, on
the Data page. **Paste a list** stores a single list from a tournament platform, a write-up or a
friend, together with where it was seen. **Load a feed** takes a saved copy of the feed and lists its
write-ups, marking each one once its lists are stored. The browser fetches neither the feed nor the
pages, because the publisher sends no CORS headers and puts a bot challenge in front of its pages.
**Fetch the published corpus** brings in a dataset built by a weekly relay: `.github/workflows/corpus.yml`
reads [MiniHeadQuarters](https://miniheadquarters.com), a tournament platform whose pages a machine
may read (its robots.txt restricts nothing and its terms say nothing about automated access), one
request a second under a named user agent, and pushes the ended tournaments' lists and placings to a
separate dataset repository as monthly files. Player names are removed before publishing. To run the
relay yourself, create an empty public repository for the dataset, set the repository variable
`CORPUS_REPO` to `owner/name` and the secret `CORPUS_TOKEN` to a token with contents read/write on
it; the app's Corpus URL setting points at the dataset. The same build runs locally:

```bash
pnpm cli corpus --source minihq --since 2026-06-01 --out data/corpus     # names dropped; --keep-names for a private copy
```

An army's **Meta** tab then measures it against the placing lists of its faction —
which units the field takes and how often, where this list has more or fewer or none, the placing
lists it most resembles by points in common, and any one of them laid beside it unit by unit. The
published lists are resolved against your own snapshot, so a corpus gathered under one points update
still reads correctly under the next.

Scenarios built from a 10th-edition snapshot run under the 10th-edition rules model automatically (`scenario.gameSystemId`).

The Battle table's layout library can fetch the published 11th-edition terrain layouts (every Force
Disposition matchup, three cards each) from the community [40kdc-data](https://github.com/wn-mitch/40kdc-data)
dataset (CC BY 4.0) onto your device, credited, in the same way the Data page fetches BSData. Nothing
of it ships in this repository.

## Deployment

`.github/workflows/pages.yml` builds `apps/web` with `VITE_BASE=/<repo>/` and publishes it to GitHub Pages on every push to `master`; `ci.yml` runs the lint, the typecheck and the test suite. The app uses a hash router, so deep links work under the sub-path.

See `docs/DESIGN.md` for the research findings, architecture and roadmap, `docs/MODELLING-NOTES.md` for what the maths assumes, `docs/BATTLE-SIM.md` for the 3D battle simulator plan, and `docs/PLUGINS.md` for extension points.
