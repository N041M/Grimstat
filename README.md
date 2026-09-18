# Grimstat (working name)

An **unofficial, fan-made, local-first** statistics dashboard and army builder for Warhammer 40,000.

**Live app:** https://grimstat.com (deployed from `master` by GitHub Actions, and it all runs in your browser with nothing uploaded). The earlier address at https://n041m.github.io/Grimstat/ stays open for a while so that data stored there can be carried across with a backup, and then closes.

- **Calculator** — one unit against another with exact probability distributions rather than averages: the whole damage curve, models slain, kill chance, damage per 100 points, and a what-if panel that ranks which single change moves the result most. Monte Carlo is the fallback, used only where an exact answer is out of reach.
- **Army builder** — 11th-edition validation while you type: Detachment Points, Leader and Support attachment, tiered unit costs, enhancements, transport capacity.
- **Codex** — every datasheet of your snapshot laid out like a codex page, and any two to six of them side by side with the best value in each row marked.
- **Battle table** — a 3D board with line of sight cast as real rays between model hulls, measurement that counts the vertical gap, per-model movement, and terrain.
- **Collection** — the models you own, counted per datasheet and filled in a box at a time from a catalogue of 223 boxed sets. What is on the shelf then shows up in the codex and beside the units in a list.
- **Meta** — an army measured against the published tournament lists of its faction: which units the field takes, where this list has more or fewer or none, and the lists it most resembles.
- Everything that changes with a codex, dataslate or edition lives in **data or a plugin** rather than in core code.

## What it looks like

These use the sample data this repository ships — invented units with invented profiles — because no Games Workshop data is published here. Loading your own snapshot replaces it.

**Calculator.** The damage distribution, models slain, the what-if ranking, and the rules toggles that change the roll.

![The calculator: expected damage, a damage distribution chart, a models-slain table, a what-if panel and a column of rules toggles](docs/screenshots/calculator.png)

**Battle table.** Two deployment zones, terrain, and eight units on a 60×44" board.

![The 3D battle table showing terrain blocks, a red and a blue deployment zone, and labelled units](docs/screenshots/battle.png)

**Codex.** Every datasheet of the active snapshot, grouped by role.

![The codex landing page showing datasheet cards grouped into characters, battleline and other datasheets](docs/screenshots/codex.png)

## Data policy

This repository contains **no Games Workshop rules text, datasheets, points or artwork**. The app ships only *importers*, and game data is fetched onto the user's own machine from community sources (BSData, the online Munitorum Field Manual, Wahapedia CSV export) on first run and cached locally. Imported data lives in `data/` which is git-ignored.

The one thing shipped here that describes a product is `apps/web/public/boxes.json`: 223 boxed sets from 1999 to 2026, 1113 lines and 5081 models, so a collection can be filled in a box at a time. It carries no rules, no points and no profiles — a line is a unit name and a number of models — and every entry names the published page its contents were read from. The unit names are checked against a real snapshot so they resolve against the data you load, and the lines that match nothing are reported rather than dropped.

Warhammer 40,000 and all associated marks are the property of Games Workshop Limited. This project is not affiliated with, endorsed by, or sponsored by Games Workshop.

## Licence

The source is published to be read and checked, not to be reused. [LICENSE](LICENSE) reserves all rights. You may read it, run it locally to audit what the app does with your data, use the hosted app for your own play, and send changes back. Without written permission you may not copy, adapt or redistribute the source or any substantial part of it, host or deploy a service derived from it, or fold any part of it into another product — whether that product is free or paid, published or not.

Both licences reserve the rights to mine this work for text or data, which covers bulk automated extraction and use as training, fine-tuning, validation or retrieval material for a machine-learning model. Reading the source, and a search engine indexing it, are not affected.

The boxed-set catalogue has separate terms in [LICENSE-DATA](LICENSE-DATA), which claim the compilation and not the facts in it. That a given box holds ten of a unit is a fact about a product somebody else sells, and facts are nobody's property. The compilation is also asserted as a database right in the EU and the UK.

Corrections and additions are welcome under both.

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
docs/SYNC.md           accounts, sync, hosting and phone app design plan
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
pnpm cli import --system wh40k-10e --out data/snapshots            # 10th edition (Wahapedia's 10e export, and 10e codexes stay legal)
pnpm cli show data/snapshots/<snapshot>.json "Intercessor Squad"
pnpm cli diff data/snapshots/<old>.json data/snapshots/<new>.json
```

The Data page's **Fetch from community sources** button reads MFM and BSData straight from GitHub,
which sends CORS headers. Wahapedia does not, and it is the only source carrying stratagems,
enhancements and rules text, so a snapshot built in the browser has none of them until a **mirror**
is pointed at. A mirror is a copy of Wahapedia's own CSV export in a dataset repository, which
`raw.githubusercontent.com` then serves to the browser like the other two. The one this app reads is
[N041M/grimstat-wahapedia](https://github.com/N041M/grimstat-wahapedia), which holds a workflow that
runs `pnpm cli mirror` from here and pushes the result to itself once a week.

To point the app at a dataset of your own, put its raw URL in **Wahapedia mirror URL** on the Data
page. A mirror that does not answer is reported before anything is downloaded, and a snapshot built
without the rules text says so on the Data page for as long as it is the active one. To publish a
dataset from this repository instead, `.github/workflows/wahapedia.yml` does the same job from this
side: create an empty public repository, set the repository variable `WAHAPEDIA_REPO` to `owner/name`
and the secret `WAHAPEDIA_TOKEN` to a token with contents read/write on it. Without the variable that
job does not run. The dataset is Wahapedia's export as it stands and carries their
attribution, which the mirror's README and the app both state. The same build runs locally:

```bash
pnpm cli mirror --system wh40k-11e --system wh40k-10e --out data/mirror
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
pnpm cli corpus --source minihq --since 2026-06-01 --out data/corpus     # names dropped, use --keep-names for a private copy
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

`.github/workflows/pages.yml` builds `apps/web` with `VITE_BASE=/<repo>/` and publishes it to GitHub Pages on every push to `master`. `ci.yml` runs the lint, the typecheck and the test suite. The app uses a hash router, so deep links work under the sub-path.

See `docs/DESIGN.md` for the research findings, architecture and roadmap, `docs/MODELLING-NOTES.md` for what the maths assumes, `docs/BATTLE-SIM.md` for the 3D battle simulator plan, `docs/SYNC.md` for accounts, sync and hosting, and `docs/PLUGINS.md` for extension points.
