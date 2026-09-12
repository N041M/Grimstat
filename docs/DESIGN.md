# Warhammer 40k Statistics Dashboard + Army Builder — Design Plan

Working name (placeholder): **Grimstat**. Unofficial fan tool; no GW data shipped; free.

> **Live:** https://n041m.github.io/Grimstat/ (GitHub Pages, deployed from `master`).
>
> **Build status (11 Sep 2026):** The app has been rebuilt to the design handoff (light-first
> paper/ink palette, icon rail, context column, command palette, phone reduction) and the army
> builder gained Statistics and Arsenal tabs. Charts follow the visualisation rules: a shared hover
> readout rather than browser tooltips, a cumulative reading beside the density one, sequential
> ramps quantised so neighbouring classes stay separable, and status colour reserved for status.
>
> **Earlier status (10 Sep 2026, v1.x):** Phases 0–5, most of Phase 6, and the v1.x "Should" items are built and verified (270 tests, typecheck clean): schema, engine (exact + Monte Carlo), effects, 11e plugin (Tier-1 keywords, Tier-2 patterns, constraints, analyses), adapters (MFM YAML, BSData JSON, Wahapedia CSV), snapshot merge/overrides/diff, CLI, resolver + costing, the web calculator PWA, and the army builder (roster editor with autosave and history, DP/leader/enhancement validation, GW-app / New Recruit / Markdown exports with a round-tripping importer, printable reference pack, "open in calculator"). Miracle/Fate dice substitution is modelled exactly. A real local import produced 32 factions / 1,684 datasheets. Phase 5 core is in the plugin: matchup matrix, durability profile, efficiency ranking and a **joint turn optimiser** (exact chained evaluation, greedy + local search, CP budget). Phase 6 partly done: `packages/game-40k-10e` proves edition-level modularity via `createGameSystem`, and `plugin-host/src/modularity.test.ts` proves a third-party plugin can add a keyword/widget/archetype without touching core. The Analyses page (matrix heatmap, durability, efficiency, turn optimiser with manual overrides, reverse mathhammer), the calculator What-if widget, snapshot compare, and the rules **override editor** (promote text-only abilities to effect records, export/import packs) are built. 10th-edition data imports through Wahapedia's 10e export and runs under the 10e rules automatically. Remaining: worker sandbox for untrusted plugins, tournament-data import for meta-weighted efficiency, geometry-lite. The game tracker is built: the Play screen (`#/play`) tracks round, phase, score, command points and unit wounds during a real game, with the solver answering matchups at the table. Modelling assumptions: `docs/MODELLING-NOTES.md`. Extension points: `docs/PLUGINS.md`.

## Context

The user wants a Warhammer 40,000 app that is (a) a **statistics dashboard** for modelling interactions between models, units, armies and rules, and (b) an **army builder**, built so that new rules, editions, factions, dashboards and data sources **slot in as modules** without redesigning code. Before designing, three research passes covered the mathhammer tools, the list builders, and the data/rules-engine ecosystem (Sept 2026) to find what users value, what they complain about, and what nobody has built. The design below targets those gaps.

---

## Part 1 — Research findings

### R0. Edition status (this reshapes the design)
- **40k 11th edition launched 20 June 2026.** Core rules are a free PDF. Points (Munitorum Field Manual, MFM) are free and online at mfm.warhammer-community.com, updated in lockstep with the official app. Datasheets, detachment rules, stratagems and enhancements remain paywalled (codex code + Warhammer+).
- **10th-edition codexes are still legal**, 11e codexes roll out with stat inflation (Terminators T6, bolters S5). Two data generations coexist for ~2 years.
- **List building got structurally harder:** a **Detachment Points (DP)** pool (2 DP at 1000 pts, 3 DP at 2000 pts), each Detachment costs 1–3 DP, no two detachments may share a *Unique Tag*; **Force Dispositions** chosen at list time drive mission generation; per-size Enhancement caps (2 / 4); unit-duplication caps (2 / 3, doubled for Battleline); **Leader + Support** (max one each per unit, Support needs a Leader, each character has a structured joinable-units list).
- **Points are no longer a scalar:** tiered by *how many copies of the unit you already have* (Requisition Thresholds), by model count, plus per-item wargear costs.
- BattleScribe the app is dead (domain lapsed). BSData is alive with an active `wh40k-11e` repo, and now targets New Recruit.

### R1. Army builders — landscape (Sept 2026)
| Tool | Model | Data | Notable |
|---|---|---|---|
| Official GW app | free + Warhammer+ $8.49/mo *and* codex code per faction | official | 3.0★ (1.5K). Battle Forge, War Journal, opponent sync, BCP submit. No roster duplication, Legends missing, crashes, data drifts from print. |
| New Recruit | free (donation) | BSData at runtime | 4.9★. Offline, QR/link share w/o account, TO suite, imports .rosz. Gripes: sync conflicts lose work, wargear 4 menus deep. |
| GrimSlate | free, no ads | BSData + live MFM | Most feature-complete: DP validation, leader legality, transport capacity, reserves limits, **list analysis vs ~6.8k reference lists**, combat calc, battle tracker. 40k-only. |
| ListForge | freemium (list cap) | own | Clean UI, built-in Monte Carlo, VS mode. **Retroactively locked existing lists → "rugpull" reviews.** |
| Warscribe | free | own | Local-first, no account, print, damage calc with auras. |
| Tabletop Battles | free | – | Best game tracker; deliberately not a builder. |
| 40kCompactor, ButtScribe, 40 Carrot, game-datacards | misc | – | Exist because printing/reformatting lists is unsolved; **4+ incompatible text export dialects**. |

**Users value (ranked):** 1) data updated within days of a dataslate; 2) free, no retroactive paywall; 3) real offline at the table; 4) link/QR share viewable without an account; 5) shallow menus, mobile-first; 6) sync that never loses work; 7) multi-system in one tool; 8) export/portability ("in case the tool dies").

**Gripes (ranked):** stacked paywall (~$1.5k/edition for all factions); access decays as codexes release; crashes; rules drift; withheld free content (Legends); retroactive monetisation; sync data loss; menu depth / no roster duplication; community data lag; tool mortality.

**Wishlist:** roster duplication + versioning; ~~two-list side-by-side; meta context on a list~~ (built: the Meta tab compares a list with imported published lists of its faction); matchup context on a list; printable per-list reference pack; interoperable exports; deployment/reserve validation; stable non-subscription tier.

### R2. Mathhammer / stats tools — landscape
| Tool | Model | Notable |
|---|---|---|
| UnitCrunch (web) | freemium £3.75/mo since Apr 2026 | Category leader. Monte Carlo, full distributions. **Many-vs-Many (20×20 heatmap) paywalled.** v1.0 removed file import/export → cloud-only accounts. Open issues: PRECISION unsupported since 2024, single-die rerolls only fixed Sep 2026, Miracle/Fate dice, reroll-non-crit "fishing", "ignore first failed save". |
| Adept Roll (mobile) | $5.99/yr | Most complete rules model: FNP variants, −1 dmg, half dmg, AoC, 25v25, **points ROI + wasted damage + confidence-percentile slider**. Gripes: unintuitive profile loading, must download whole faction to pick a defender. |
| Tactical Cogitator, MathHammer.io, Tabletop Calculator, MetaHammer, GrimSlate, ListForge calcs | free | Mostly single matchup; some still 10e. Offline PWA + no account wins goodwill. Preset target archetypes (Guard/Marine/Terminator/Custodes/Rhino/Knight) are loved. |
| WarhammerStatsEngine (OSS) | dead | **No maintained open-source 40k engine exists.** |
| Stat Check, 40kstats, Listhammer, Hutber | free meta data | Faction/detachment/mission win rates. **Nobody publishes unit-level meta data.** |

**Users value:** distributions not averages (loudest theme); roster import to kill manual entry; durability analysis for list building; free/offline/no-account; preset archetypes; ROI & wasted-damage metrics.

**Gripes:** multi-unit analysis paywalled; account required; **rerolls are the hardest thing to express in every tool** (ordered, conditional, single-die, fishing); single-target comparisons mislead; edition churn breaks tools.

**Gaps nobody has built (ranked):** 1) whole-turn, whole-army target-allocation optimiser (Many-vs-Many today = independent pairwise heatmap); 2) CP-aware stratagem economy across a turn; 3) an opponent who plays well (defender-chosen save allocation, attacker's optional Lethal Hits); 4) meta-weighted efficiency; 5) damage-per-point / wounds-per-point leaderboards; 6) army-level overkill accounting; 7) geometry-aware modelling; 8) shareable permalink results; 9) maintained OSS engine; 10) local-first, no account; 11) "what changed" migration between dataslates/editions.

### R3. 11th-edition mechanics the engine must model (precise)
- **Sequence:** Attacks → Hit (unmod 1 fails, unmod 6 = crit) → Wound (S vs T table; unmod 6 = crit) → Allocate → Save (invuln vs *unmodified* roll; else AP-modified armour; unmod 6 always saves) → Damage (lowest save resolved first) → FNP per wound → Mortal wounds resolved *after* the sequence.
- **Two separately-capped modifier channels:** hit-*roll* modifiers capped ±1; **BS/WS *stat* modifiers uncapped and stack on top.** Cover in 11e = −1 BS stat (not +1 save). Stealth = Benefit of Cover, non-stacking. PSYCHIC ignores all hit/BS penalties. Almost no 10e tool models this.
- **Weapon abilities:** Lethal Hits (**optional per attack**, forfeits Devastating Wounds), Sustained Hits X, Devastating Wounds (**verify text**: NR wiki says MW = Damage, max one model per crit wound; Wargamer says ignores saves), Anti-X (incl. 5+), Blast, **Cleave X (new melee blast)**, Torrent (auto-hit, bypasses Snap Shooting), Twin-linked, Melta X, Lance, Heavy (tightened), Rapid Fire X, Assault, Hazardous (**fails on 1–2**), Indirect Fire (Snap Shooting unless spotter), Ignores Cover, Precision, Conversion, Close-Quarters, Extra Attacks.
- **Defensive:** invuln (now a datasheet column), FNP X+ (also vs MW; psychic-only variants), −1 Damage (min 1), Half Damage, AP reduction, Deadly Demise, heal/restore, "ignore first failed save".
- **Fast rolling:** all saves rolled at once, defender assigns results in roll order → needs an **allocation policy** model.
- **Stratagems:** one per unit per phase; Command Re-roll on 7 roll types; Overwatch = Snap Shooting; Crushing Impact; Epic Challenge grants Precision.

### R4. Data sources & prior art (what to import, what to copy)
| Source | Licence | Format | Best for | Caveats |
|---|---|---|---|---|
| `BSData/wh40k-11e-mfm` | **MIT** (data © GW) | YAML, daily scrape of official MFM | **Points authority**: tiered `pricing[].range`, wargear costs, `dp`, `unique`, `leaderTo/supportTo`, `legends` | points only |
| `BSData/wh40k-11e` | none | **JSON** (BattleScribe object model; NR extensions `associations`, `flatten`…) | **Buildable structure**: wargear option trees, unit-size bands, constraints, leader `associations` | no releases → pin git SHA; library graph must be resolved; rules are free text; 3 maintainers |
| Wahapedia CSV export | permission-style terms ("powered by Wahapedia") | 19 pipe-delimited CSVs, `/wh40k11ed/<Table>.csv`, ~15 min freshness | **Reference text**: datasheets, models (M/T/Sv/inv/W/Ld/OC/base), wargear profiles, abilities, keywords, leader joins, stratagems (phase/turn/cp), enhancements, detachment abilities, sources/errata | HTML in descriptions; options are prose; points not 11e-tiered |
| `game-datacards/datasources` | none | JSON, 8 locales | **Schema to copy**: abilities bucketed core/faction/other/invul/damaged; stratagems decomposed into when/target/effect/restrictions; `forceDisposition`, `detachmentPoints` | derived; one maintainer |
| Rosterizer `.rulebook` | none | JSON DSL | **Rule-DSL ideas**: `{self}/{roster}` path queries, `failState: pass|error`, `order`, `dependencies` by URL | incomplete |
| `tessera-engine` (AGPL), `auspex`, `sirvalerius/new40k-list-builder`, `depot` (MIT) | various | TS/JS | Patterns: engine free of GW text; single `rules.ts` resolver shared by UI+tests; YAML override layer; ETL→typed JSON→PWA+IndexedDB | |

**Consensus in the wild:** nobody made ability text machine-executable in general. Working projects use **three tiers**: Tier-1 enumerable keywords implemented natively; Tier-2 parameterised patterns as small effect records; Tier-3 text + manual toggle.

### R5. Legal / IP (drives the data strategy)
- GW sent BattleScribe takedowns (2011, 2020), Wahapedia a C&D (2021, survives on .ru). BSData *data* repos have **no licence**. GW IP guidelines: unofficial, no copied art/text, **non-commercial**.
- Survivable pattern: **the app ships importers and no data.** Data is fetched on the user's device from upstream URLs, cached locally and not rehosted. Free, no ads, no donations tied to the app. Engine and schemas contain no GW text (OSS-publishable). Attribution everywhere. Design for any upstream vanishing on 14 days' notice (pluggable adapters = legal risk mitigation).

---

## Part 2 — Product design

### Positioning (what makes it worth building)
1. **Army-level, not unit-level.** Joint target-allocation across a whole turn, CP budget, overkill accounting, durability-per-point leaderboards. Nobody does this; UnitCrunch paywalls even the pairwise grid.
2. **Distributions and an opponent who plays well.** Exact PMFs, percentiles, kill probabilities; defender allocation policies; optional Lethal Hits choice; sensitivity sliders.
3. **Honest coverage.** Every ability is Tier-1/2/3; a coverage meter says "N of M abilities modelled, 3 need manual toggles." No silent "does nothing" imports.
4. **Snapshots and diffs.** Rosters pin a data snapshot; "MFM 1.4 available: your list is now 2025 pts"; points history per unit; 10e→11e re-scoring.
5. **Local-first, free, portable.** No account, offline PWA, export-everything JSON, permalinks that encode the scenario/roster.
6. **Modular by construction.** Even "40k 11e" is a plugin; 10e, Kill Team, AoS, homebrew slot in as data + plugins.

### Feature set (MoSCoW)

**Must (v1)**
- *Data:* importers for MFM YAML (points), BSData 11e JSON (structure), Wahapedia CSV (reference text); merge by precedence with conflict log; immutable checksummed **snapshots** pinning upstream refs; YAML **override** layer; snapshot **diff** ("what changed for my faction").
- *Engine:* 11e attack pipeline with two-channel modifier caps; Tier-1 keyword set (all weapon abilities in R3); rerolls (ones, failed, all, non-crit "fishing", single die, Command Re-roll); crits & Anti-X; Sustained/Lethal(optional)/Devastating; Blast/Cleave; Torrent/Snap Shooting; Hazardous; Melta/Rapid Fire by range band; invuln/FNP/−1D/half-D/AP reduction; multi-wound allocation with overkill; **exact PMF** where feasible, **Monte Carlo** fallback with CI; outputs: damage PMF, models-slain PMF, P(kill), P(≥k), percentiles, wasted damage, damage-per-point.
- *Scenario:* attacker unit (+leader/support, +toggles: stratagems, army/detachment rules, range band, moved/stationary, charged) vs defender unit (+cover, +toggles, allocation policy); **preset target archetypes**; save/share scenarios; permalink.
- *Army builder:* detachments with DP budget & unique tags; units/models/wargear from BSData option trees; leader/support associations; enhancements; tiered points; validation diagnostics with fix hints (points, DP, Rule of 3/Battleline, enhancement caps, leader legality, transport capacity, allies, Legends flag); roster duplicate/version/diff; import GW-app text / New Recruit text / .rosz; export GW-app text, NR_TOURNAMENT, WTC, JSON, Markdown, print pack (only this list's datasheets/strats).
- *Dashboard:* grid of widgets bound to current roster/scenario/snapshot: Unit Card, 1v1 Distribution, Kill Curve, Matchup Matrix heatmap (Many-vs-Many, free), Durability Radar vs archetypes, Efficiency Leaderboard, Validation Panel, Coverage Meter, What-Changed. Saved dashboard layouts.
- *Platform:* offline PWA, IndexedDB, no account, export-all.

**Should (v1.x)**
- Joint **turn optimiser**: attackers→targets assignment maximising expected kills / P(kill) under CP budget and one-strat-per-unit-per-phase; report the whole-turn distribution; army-level overkill.
- **Sensitivity / what-if** sliders (+1 to wound, −1 AP…) with deltas.
- **Reverse mathhammer**: "what in my list kills X with ≥80%?" and "cheapest unit that does".
- Tier-2 **effect editor** (visual) + regex pattern library to promote Tier-3 abilities; community-shareable override packs.
- Two-list compare; list "capability profile" (anti-tank/anti-infantry/anti-elite/durability/OC) vs archetype set; points history chart.
- 40k 10e plugin (second game system proves the plugin API).

**Could (later)**
- Meta-weighted efficiency built on the published corpus (the weekly MiniHeadQuarters relay; BCP forbids automated access by contract and Tabletop Battles gates its pages, so neither is a source) to build the empirical T/Sv/W target distribution.
- Game tracker (VP/CP/secondaries) that feeds back real outcomes.
- Geometry-lite: range/cover/HIDDEN toggles per scenario (full LoS out of scope).
- Kill Team / AoS plugins; Tauri desktop wrapper; optional CRDT sync (Yjs) with no server-side data.

**Won't**
- Bundle or rehost GW datasheets/rules text; require an account for any local feature; retroactively lock content a user already created; sell access to data; GW artwork/icons.

### Future-public / paid-tier readiness (build the seams now, not the features)
Scope today is a personal local tool, but the architecture must let a public web app and paid tiers be added without redesign:
- **Server-optional by construction.** Every feature works fully offline against IndexedDB. A future backend only *adds*: permalink relay (short links), cross-device sync, accounts, shared override packs, hosted heavy compute (turn optimiser). Web app talks to it through a `services/` interface with a local no-op implementation.
- **Entitlements abstraction.** `packages/entitlements`: `can(feature) → boolean` with a `LocalAllUnlocked` provider now and a server-backed provider later. Widgets/analyses declare `requires?: FeatureKey`. Nothing in `engine`/`resolver` ever checks entitlements (keeps them OSS-publishable).
- **What could ever be paid** (per research on what users punish vs accept): convenience and compute — sync, cloud storage, hosted optimiser runs, team/TO features. Data access, the pairwise matrix (the differentiator vs UnitCrunch) and anything already free stay unpaid. Legal note from R5: GW's guidelines are non-commercial for fan content and the Wahapedia C&D cited monetisation, so a paid tier must charge for *software services* with user-imported data, and should get a solicitor's review before launch.
- **Identity-ready data model.** Every stored record carries `ownerId` (local: `"local"`), `createdAt`, `updatedAt`, `revision` so a CRDT/sync layer can be added later without migration.
- **Privacy defaults.** No telemetry in v1; if added later, opt-in only.
- **i18n groundwork.** All user-facing strings through an i18n layer; data strings already arrive as locale maps from GDC-style sources.
- **Deployability.** `apps/web` builds to static assets (any CDN); optional `apps/api` (Hono + Postgres) added in a later phase without touching packages.

---

## Part 3 — Architecture

### Guiding principle
Everything that changes when GW publishes a codex, dataslate, FAQ or edition lives in **data or a plugin** rather than in core code. The core is a generic *dice pipeline + constraint solver + widget host*. Rule text from GW never enters `engine`, `effects`, `resolver` or `schema` (tests use synthetic fixtures).

### Layers & packages (pnpm monorepo, TypeScript)
```
packages/
  schema/        Zod schemas + types: canonical game data, PriceRule, Snapshot, Roster, Scenario,
                 EffectRecord, Diagnostic, PluginManifest. No GW text.
  engine/        Pure, zero-dep, isomorphic. Pipeline runner over distributions; exact PMF ops
                 (convolution, binomial thinning, order statistics for single-die rerolls);
                 allocation DP (Markov over models×wounds) with policy hooks; Monte Carlo backend
                 sharing the same stage defs; optimisers (joint allocation, CP budget).
  effects/       Effect registry: Tier-1 keyword impls registered by game-system plugins;
                 Tier-2 EffectRecord interpreter {when, if, op, target, value, source};
                 Tier-3 manual toggles; coverage accounting.
  resolver/      Roster legality: constraint evaluators (points, DP, unique tags, Rule of 3,
                 enhancements, associations/leader+support, transport, allies, Legends).
                 ONE module shared by UI, CLI and tests. Emits Diagnostic[].
  adapters/      Importers: mfm-yaml, bsdata-json, bsdata-xml (10e/KT/AoS), wahapedia-csv,
                 gdc-json, gw-app-text, newrecruit-text, rosz. Exporters: gw-app-text,
                 nr-tournament, wtc, json, markdown, print-html, permalink.
  snapshot/      Precedence merge (MFM > BSData > Wahapedia > GDC for each field class),
                 conflict log, override layer (YAML keyed by stable id), immutable snapshot
                 with checksum + upstream refs, diff engine.
  plugin-host/   Manifest loader, apiVersion negotiation, registration API, worker sandbox
                 (postMessage RPC) for third-party plugins, lifecycle hooks.
  ui/            Design system + widget SDK (React): WidgetDef {id, inputs, render, settings}.
  widgets-core/  Built-in widgets listed above.
  game-40k-11e/  GAME-SYSTEM PLUGIN: stat definitions, phases, pipeline stage config,
                 modifier channels + cap policy, Tier-1 keyword set, Tier-2 pattern library,
                 roster constraint set, archetype presets, export dialect specifics.
  game-40k-10e/  (v1.x) same shape; proves the API.
apps/
  web/           Vite + React PWA; Dexie/IndexedDB; engine in Web Worker; service worker offline.
  cli/           Node: import → snapshot → validate → simulate → JSON. Drives tests & scripting.
```

### Plugin API (the "slot-in" mechanism)
```ts
interface PluginManifest { id; version; apiVersion; kind: 'game-system'|'adapter'|'effects'|'widgets'|'exporter'|'analysis'; requires?: Record<string,string>; entry }
interface PluginContext {
  registerGameSystem(def)         // stats, phases, pipeline stages, modifier channels + caps
  registerStage(stage)            // add/replace a pipeline step (e.g. 'hazardous', 'fnp')
  registerKeyword(name, impl)     // Tier-1 (e.g. 'SUSTAINED HITS', 'CLEAVE')
  registerEffectOp(name, impl)    // Tier-2 ops: reroll | modify | set | cap | substitute | fnp | ...
  registerPattern(regex, build)   // Tier-2 text→EffectRecord curation
  registerConstraint(kind, eval)  // list-building rule
  registerImporter(def); registerExporter(def)
  registerWidget(def); registerAnalysis(def); registerArchetype(profile)
  on('snapshot:loaded'|'roster:changed'|'scenario:run', handler)
}
```
Semver `apiVersion`; first-party plugins in-process, third-party in a Worker sandbox. A new edition = a new `game-*` plugin + adapters; a new weapon keyword = one `registerKeyword` in that plugin; a new dashboard = one `registerWidget`.

### Attack pipeline (engine)
- Pipeline = ordered stage list from the game-system plugin: `attacks → hit → wound → allocate → save → damage → fnp → mortal → hazardous`.
- Each stage transforms a **distribution state** (`{pmf, context}`) and reads a **ModifierSet** collected from unit/weapon/scenario toggles: `{channel, op, value, condition, source}`. Channels (`hit-roll`, `bs-stat`, `wound-roll`, `ap`, `damage`, `save`, `attacks`…) carry cap policies from the plugin. Precedence: set → multiply → add → divide → subtract → round (configurable).
- **Exact path:** per-attack categorical → binomial/convolution over attack count (itself a dice-expression PMF, +Blast/Cleave); rerolls as analytic per-die adjustments; single-die reroll via order statistics; damage allocation via DP over (models left, wounds on current model) with policy; FNP as binomial thinning. State-space guard → automatic **Monte Carlo** fallback (shared stage defs) with reported CI. MC doubles as cross-validation in tests.
- Outputs: damage PMF, models-slain PMF, P(kill), P(≥k), mean/percentiles, wasted damage, per-point metrics, and a **trace** (per-stage expected values) for the UI.

### Effects tiers (data and plugins; nothing is hardcoded per unit)
- Ability row: `{ id, text, coreKeyword?, effects?: EffectRecord[] , manualToggle? }`. Tier-3 has only `text`; promoting to Tier-2 is a data change (override pack), no migration.
- `EffectRecord = { when: {phase?, stage, side}, if?: Condition (keywords, range band, charged, stationary, target keyword…), op, target: channel, value, cap?, source }`.

### Data flow
`Adapters → canonical staging → Overrides → Snapshot (immutable, pinned refs, checksum) → Roster.pins(snapshotId) → Scenario(rosterUnits, toggles, snapshotId) → Engine → Widgets`.
Points computed from `PriceRule{copyRange, tiers[{models, points}]}` + `WargearPrice` + `EnhancementPrice` + `DetachmentCost{dp}` — never a flat `points: number` on a unit.

### Storage & sharing
- Dexie/IndexedDB stores: snapshots, rosters (versioned), scenarios, dashboards, overrides. Export-all JSON; import restores.
- Permalink: compressed (lz-string) roster/scenario + snapshot ref in URL fragment; opening a link with a missing snapshot offers to fetch the same upstream refs.

---

## Part 4 — Tech stack
- **TypeScript** everywhere; **pnpm** workspaces; **Vite** + **React** (web), **Zod** (schemas), **Dexie** (IndexedDB), **Comlink** (worker RPC), **react-grid-layout** (dashboard), **Vitest** (+ fast-check property tests), **Playwright** (e2e), **tsup** for packages.
- Engine is dependency-free so it can later be published on npm or ported to Rust/WASM if profiling demands.
- Confirmed: web PWA first (Tauri later), local-only in v1 with server-optional seams, 11e as primary game system.
- Repo additions for future-public readiness: `packages/entitlements`, `apps/web/src/services/` (local no-op implementations of relay/sync/auth), i18n layer from day one.

---

## Part 5 — Implementation phases

**Phase 0 — Scaffold (repo, schema, CLI skeleton)**
- Monorepo, lint/test/CI, `schema` package with all canonical entities from R4 (every record with `ownerId`/`revision`/timestamps), `cli` that loads a snapshot and prints it. Synthetic fixture data pack (`fixtures/`), no GW text. `entitlements` package with the local all-unlocked provider; `services/` interfaces with local no-op relay/sync/auth; i18n layer stub.

**Phase 1 — Data pipeline**
- `adapters/mfm-yaml` (MIT, simplest, official points) → `adapters/bsdata-json` (resolve `catalogueLinks` library graph, keep selection-entry tree in staging, parse `associations`) → `adapters/wahapedia-csv` (pipe-delimited, strip HTML, parse `Datasheets_leader`, stratagem phase/turn).
- `snapshot`: precedence merge + conflict log + overrides + checksum + diff. CLI: `grimstat import --source ... && grimstat diff a b`.
- Name normalisation table for joining sources.

**Phase 2 — Engine core + 11e plugin (Tier-1)**
- Pipeline runner, PMF ops, modifier channels/caps, rerolls, crits, all R3 weapon/defensive abilities, allocation DP + policies, MC backend, outputs & trace.
- Golden tests against hand-computed cases (e.g. 10× BS3+ S4 AP0 D1 vs T4 Sv3+ → E[unsaved]=1.11) and MC-vs-exact property tests.

**Phase 3 — 1v1 calculator UI + scenario model + core widgets**
- Unit picker from snapshot, leader/support attach, toggles (stratagems/army rules as Tier-2/3), archetype presets, Distribution/Kill-Curve/Unit-Card widgets, coverage meter, permalinks, save scenarios. Web Worker execution.

**Phase 4 — Army builder + resolver + import/export**
- Roster editor (detachments/DP, units, wargear from option trees, leaders, enhancements, tiered points), diagnostics panel, duplicate/version/diff, importers (GW-app text, NR text, .rosz), exporters (GW-app, NR_TOURNAMENT, WTC, JSON, Markdown, print pack).

**Phase 5 — Army-level analytics**
- Many-vs-Many matrix, Durability Radar vs archetypes, Efficiency Leaderboard, list capability profile, What-Changed widget, sensitivity sliders, joint turn optimiser with CP budget, overkill accounting, reverse mathhammer.

**Phase 6 — Modularity proof + polish**
- `game-40k-10e` plugin via `bsdata-xml`; third-party plugin sandbox; PWA offline hardening; export-all; docs for writing a game-system/adapter/widget plugin.

---

## Part 6 — Verification
- **Engine:** Vitest golden tests (hand-computed expectations for each keyword in isolation and in combination), fast-check property tests (MC within tolerance of exact; monotonicity: +1 to hit never lowers expected damage; caps respected), regression fixtures for allocation/overkill and Precision.
- **Resolver:** fixture rosters (legal/illegal per rule) with expected `Diagnostic[]`; DP/unique-tag/Rule-of-3/enhancement/leader-support cases.
- **Adapters:** snapshot tests on synthetic fixtures in the repo; a local, git-ignored real import (`grimstat import`) run manually, with a checksum + conflict-log review; round-trip tests for text exports (export → import → equal).
- **UI/e2e:** Playwright flows: import snapshot → build list → validate → run scenario → view matrix → export; offline reload; permalink open.
- **Modularity check:** adding a fake keyword and a fake widget via a test plugin without touching core packages must pass CI.

## Decisions (confirmed with the user, 2026-09-09)
1. **Stack:** TypeScript web PWA (Vite + React), engine in Web Worker + Node CLI, Tauri optional later.
2. **Audience:** personal local tool now; infrastructure prepared for a future public web app and potential paid tiers (see "Future-public / paid-tier readiness"). No backend in v1.
3. **v1 vertical slice:** stats engine + 1v1 calculator first (Phases 0–3), army builder next (Phase 4), army-level analytics after (Phase 5).
4. **Primary game system:** 40k 11th edition; 10e as the second plugin to prove modularity.
