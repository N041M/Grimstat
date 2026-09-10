# apps/web — notes and requests for other packages

Status: Phase 3 web app (Vite + React 18 + TypeScript, offline PWA), the Phase 4 army builder ("Armies" section),
the Phase 5 army-level analyses ("Analyses" section), the Phase 6 additions (reverse mathhammer, what-if widget,
snapshot comparison, rules overrides) and the Phase 7 in-browser data import for the GitHub Pages deployment.
`pnpm typecheck` clean, `pnpm vitest run apps/web` green.

## Phase 7 — fetch from community sources in the browser (GitHub Pages) — what is where

- **Data page → "Fetch from community sources"** (`src/components/data/FetchSources.tsx`): the two sources whose hosts
  send `access-control-allow-origin: *` — `mfm-yaml` (raw.githubusercontent.com) and `bsdata-json` (api.github.com
  tree listing + raw files). Wahapedia sends no CORS header, so it stays CLI-only; the panel says so and shows
  `pnpm cli import --system wh40k-11e --out data/snapshots` plus a README link. Each source is a labelled checkbox with
  `SOURCES[id].role`, `attribution` and `licence` and a size hint; the optional BSData faction filter is a
  comma-separated, case-insensitive match on catalogue file names (passed to `fetchSource` as `filter`; libraries and
  the game-system file are always downloaded). Selection + filter persist in `settings` under `data.fetch.selection`.
  Progress list per source (waiting / downloading n/total files with a `<progress>` / parsing / parsed with counts,
  warning count and a `<details>` sample of the first 5 warnings / failed), then merge counts, build, and a result box
  with id, counts and the source refs (MFM version, BSData git SHA). Errors show a kind-specific hint (GitHub API quota
  for `api.github.com` 403/429, connectivity, other) with Retry and the CLI command.
- **Worker** `src/worker/import.worker.ts` (Comlink, `run(request, onEvent)` + `cancel()`), a mirror of
  `apps/cli/src/commands/import.ts`: `fetchSource` for every selected source (concurrently, one `AbortController`
  injected through the `fetchImpl` wrapper) → `adapter.parse(files, { gameSystemId, fetchedAt, ref, url })` →
  `mergeSources(parts)` → `buildSnapshot({ data, sources, conflicts, label })` (SHA-256 via WebCrypto in the worker).
  Overrides are *not* applied at build time — the app applies them when it reads a snapshot. Progress goes back through
  a `Comlink.proxy` callback (released in `finally`).
- **Client** `src/worker/importClient.ts`: one run at a time; `cancel()` terminates the worker (the only way to interrupt
  a synchronous parse) and rejects the pending run with `ImportCancelledError`; the worker is recreated lazily. A run
  survives navigating away from the Data page: the snapshot is still stored + activated and a notice is shown; the
  remounted panel shows a "still running" line with Cancel (`importClient().running`).
- **Pure model + tests**: `src/lib/importProgress.ts` (`BROWSER_SOURCES`, `catalogueFilter`, `importRequestFor`,
  `reduceProgress`, `classifyError`; label `Fetched <yyyy-mm-dd>[ · <filter>]`) with `importProgress.test.ts`, and
  `src/lib/attribution.ts` (`attributionFor`, `attributionSummary`: `snapshot.sources[].adapter` → `SOURCES` attribution
  + licence + collected refs, unknown adapters fall back to the id) with `attribution.test.ts`.
- **Attribution**: Data page panel (`src/components/data/SourceAttribution.tsx`) for the active (raw) snapshot and a
  credit line in the global footer (`footer.poweredBy`, e.g. "Powered by Wahapedia (…)" when a CLI snapshot with that
  source is active). About page gained a "Getting data" section (browser fetch / CLI for Wahapedia / stays on device).
- **Verified 2026-09-10** in the production build (`VITE_BASE=/Grimstat/ pnpm --filter @grimstat/web build && preview`,
  opened at `http://localhost:4173/Grimstat/#/data`): filter "Necrons" → 10 BSData files + 31 MFM files, 12.0 s wall
  time; BSData parsed 67 datasheets · 203 abilities · 12 detachments · 33 enhancements · 66 price rules (14 warnings),
  MFM 1,361 datasheet stubs · 348 detachments · 1,193 enhancements · 1,751 price rules (62 warnings); merge 25
  conflicts · 1,297 unmatched (the MFM stubs of the other factions) · 31 warnings; snapshot `snap_20260910_03aeea17`
  = 30 factions · 67 datasheets · 201 abilities · 270 detachments · 0 stratagems · 84 price rules, stored and active,
  label "Fetched 2026-09-10 · Necrons", refs `mfm-v1.4@2026-09-02` / BSData tree SHA. Nothing downloaded is committed.
- **Sizes** (from the tree listing): the full BSData set is ~50 MB of JSON, the always-included libraries + game system
  alone ~14 MB, Space Marines 5 MB, Necrons 1.5 MB; the MFM is ~1 MB. `api.github.com` allows 60 anonymous
  requests/hour/IP and the tree listing costs one.
- **Base-path audit** (`/Grimstat/`): nothing in `src/` builds absolute `/` URLs — permalinks use
  `location.origin + location.pathname`, both workers use `new URL("./x.worker.ts", import.meta.url)`, routes are hash
  links. Vite rewrites the two icon links in `index.html`; the manifest's `start_url`/`scope` come from `base`; the SW is
  registered at `${base}sw.js` with scope `base` and its precache entries are relative to `sw.js` (so
  `navigateFallback: "index.html"` resolves to `/Grimstat/index.html`). `vite preview` answers 404 for `/Grimstat`
  without the trailing slash (GitHub Pages redirects to `/Grimstat/`). The in-app browser pane refuses service-worker
  registration ("An unknown error occurred when fetching the script") although `sw.js` is served with 200 —
  an artefact of that sandbox, not of the build.

## Phase 6 — reverse, what-if, compare, overrides — what is where

- **Reverse tab** (`#/analyses`, `src/components/analyses/ReverseTab.tsx`): one target (`UnitSetPicker single`), a
  candidate set (attack-capable archetypes / army / datasheets / calculator), metric (P(kill) / E[damage] / E[slain]),
  threshold (`null` = auto: 0.8 for P(kill), the target's total wounds for E[damage], its model count for E[slain]),
  combination size 1–3, range/phase/cover/charged. Runs `reverseMathhammer` in the worker (`SimClient.reverse`).
  Table: ranked rows, points, meets/short badge, the chosen metric bolded, the cheapest meeting row highlighted,
  "Open in calculator" for single-candidate rows (`replaceScenario` + navigate). Persists under
  `analyses.reverse.{target,candidates,options}`.
- **What-if widget** (`src/widgets/WhatIf.tsx`, id `core.what-if`, in the default calculator layout after the weapon
  breakdown): 400 ms after every main result it runs `sensitivity(scenario, { snapshot })` in the worker
  (`SimClient.sensitivity`, same sequencing → a newer main run supersedes it). Signed `HBarChart` (new `signed` and
  `onSelect` props; negative bars red, positive green) grouped attacker/defender + a Δslain / ΔP(kill) table. Clicking a
  variant applies it from its `SensitivityVariantDef` (`context` fields set / reset to `ScenarioContext` defaults,
  `toggles` switched with `setToggle`); clicking an active variant removes it.
- **Compare snapshots** (Data page, `src/components/data/SnapshotCompare.tsx`): two stored snapshots →
  `diffSnapshots` on the main thread (memoised). Per-entity added/removed/changed counts, points list (old → new,
  Δ badge, "price rules only" when only the rules changed), added/removed/changed lists (capped at 40 + "more"),
  a name filter and a faction select. The faction of an entity is derived across both snapshots
  (`factionIndex`): datasheet → `factionId`; ability → `factionId`, else the carrying datasheets / detachment rules
  (an ability carried by several factions matches every faction); enhancement → detachment; stratagem → own or
  detachment faction; wargear price → datasheet; publications never match a faction filter.
- **Rules overrides** (`#/data/overrides`, `src/pages/OverridesPage.tsx`, `src/components/overrides/*`,
  pure model + tests in `src/lib/overrides.ts` / `overrides.test.ts`):
  - Dexie **v3** adds `overrides` (`&key, entity, id, updatedAt`; `key = entity:id`; record = schema `Override` +
    `ownerId/createdAt/updatedAt`). The export-all bundle gained `stores.overrides`.
  - `AppContext` now exposes `rawSnapshot` (as stored) and `snapshot` = `effectiveSnapshot(raw, overrides)` (memoised),
    `overrides`, `overrideStatus {applied, missing}`, `refreshOverrides()` and `withOverrides(s)` for snapshots loaded
    directly from Dexie (roster editor, army source of the unit-set picker, unit-set resolution, armies list). The
    effective snapshot keeps the id but its `checksum` gets a `+ov<fnv1a>` suffix so the worker cache
    (`id|checksum|updatedAt`) never serves un-patched data.
  - Effect editor: ability search over the raw snapshot (name/id, carriers listed, tier badge from
    `abilityEffects` of the *effective* ability), effect form (stage/side/op/target from `CHANNEL_INFO` or free text,
    value by kind: number / re-roll policy / boolean / text-dice, optional condition), edit/remove pending effects,
    note, save → `{ entity: "ability", id, patch: { effects }, note }`. Quick actions: Feel No Pain X+
    (`patch: { coreKeyword: "FEEL NO PAIN", coreValue: X, effects: null }`) and "no combat effect"
    (`patch: { effects: [] }`). List with edit (abilities → the editor; anything else / missing ids → inline JSON patch
    editor), delete, export pack (plain `Override[]`), import pack (file → `Override.safeParse` each → merge by
    `entity + id`, later entries win, `createdAt` kept).
  - Coverage widget: "N override(s) applied" pill, "Add override" link (`#/data/overrides?q=<name>`) next to every
    unmodelled *ability*, and abilities whose effective `effects` is an explicit `[]` are reclassified from tier 3 to
    tier 1 ("marked as no combat effect") — see the request below.
- Worker: `reverse` and `sensitivity` were added to `SimWorkerApi` / `SimClient`. `src/lib/gameExtras.ts` re-exports
  them (with `CHANNEL_INFO`, `SENSITIVITY_VARIANTS` and the types) from `@grimstat/game-40k-11e`; the temporary local
  shim that lived there was deleted once the package exported them. **No shims remain.**

## Analyses (Phase 5) — what is where

- Route: `#/analyses` (`src/pages/AnalysesPage.tsx`), four tabs — Matrix, Durability, Efficiency, Turn optimiser
  (`src/components/analyses/{MatrixTab,DurabilityTab,EfficiencyTab,TurnTab}.tsx`). The active tab and every
  tab's inputs persist in Dexie `settings` (`analyses.tab`, `analyses.<tab>.<set>` for unit sets,
  `analyses.<tab>.options` for controls).
- Worker: `src/worker/sim.worker.ts` gained `matrix`, `durability`, `efficiency`, `optimiseTurn`, `evaluateTurnPlan`
  (thin wrappers over `runMatrix`, `durabilityProfile`, `efficiencyRanking`, `optimiseTurn`, `evaluateTurnPlan`).
  `SimClient` (`src/worker/client.ts`) sequences *every* call through one `call()` helper, so the existing stale-run
  rule (only the newest request's result is delivered; a superseded run hogging the worker > 2.5 s is terminated)
  now covers the analyses too. `src/hooks/useWorkerTask.ts` is the button-triggered counterpart of `useSimulation`
  (running flag, elapsed ms, error). Matrix cells are stripped of `SimResult.finalState` before crossing the worker
  boundary (it is only needed for chaining and can be large).
- Unit-set picker (`src/components/analyses/UnitSetPicker.tsx`, model in `src/lib/unitSet.ts`, persistence in
  `src/hooks/useUnitSet.ts`): sources are an army from Dexie `rosters` (hosts only — attached characters are
  folded in by `unitFromRosterUnit`), archetypes (multi-select), datasheets of the active snapshot
  (`unitFromDatasheet`, default model count) and the calculator's attacker/defender. Only the *sources* are stored
  (`{ source, optionId?, weight? }[]`); units are rebuilt on load and vanished sources are dropped silently.
- Pure, tested helpers: `src/lib/heatmap.ts` (metric extraction, totals, `heatColour` colour scale using
  `color-mix` on `--accent`), `src/lib/matrixCsv.ts` (long-form CSV, RFC 4180 escaping), `src/lib/unitSet.ts`.
  Tests: `heatmap.test.ts`, `unitSet.test.ts`, `widgets/registry.test.ts`.
- Widgets: `src/widgets/analyses.tsx` registers eight widgets (`analysis.*`) built from the same components the page
  renders. They declare `requires: "analyses.<key>"`; `Dashboard` filters with `widgetAvailable()` on
  `WidgetProps.analyses` (new optional field, `AnalysisInputs`), so the calculator dashboard is unchanged until a
  dashboard provides those inputs.
- Turn optimiser UI: per-attacker stratagem select ("let the optimiser choose" = all `DEFAULT_TURN_OPTIONS`, a
  specific option = only that one), per-target priority weight 0.5–3, CP budget (default 3, 0 disables), objective,
  range band + phase. Editing a target/stratagem in the plan table calls `evaluateTurnPlan` with the *full* option
  list and shows the score delta against the optimised plan. Any warning mentioning Monte Carlo / fallback is
  surfaced with an "approximate" badge; all warnings are listed.
- No shims remain: `src/lib/turn.ts` re-exports the optimiser from `@grimstat/game-40k-11e`.


## Army builder (Phase 4) — what is where

- Routes: `#/armies` (list) and `#/armies/<rosterId>` (editor); `src/router.ts` now parses a path param and a query
  (`useRouteInfo()`), `navigate(route, replace, param)`.
- Storage: Dexie **v2** adds `rosters` (keyed by id; indexes name/factionId/snapshotId/updatedAt) and `rosterVersions`
  (`{id: "<rosterId>:<revision>", rosterId, revision, updatedAt, json}`, capped at 30 per roster in
  `saveRosterWithVersion`). The export-all bundle gained an optional `stores.rosters`.
- Pure helpers + tests: `src/lib/roster.ts` / `roster.test.ts` (model-count distribution, composition bounds,
  loadout-based wargear prefill, section classification, revision diff, diagnostic paths) and
  `src/lib/rosterPermalink.ts` (`#/armies?r=<lz-string of {v, roster, snapshotId}>`).
- Editor state: `src/hooks/useRosterEditor.ts` (autosave debounced 300 ms → `revision++`, `updatedAt`, version record;
  flush on unmount/pagehide) and `useRosterSnapshot` (roster's own snapshot from Dexie, active snapshot as fallback).
- UI: `src/pages/ArmiesPage.tsx`, `src/pages/RosterEditorPage.tsx`, `src/components/roster/*` (detachments, units +
  add-unit picker, unit inspector, diagnostics, export drawer, history).
- Consumed from other packages: `validateRoster`, `rosterSummary`, `UnitCost` (`@grimstat/resolver`);
  `constraints11e`, `BATTLE_SIZES`, `pointsFor`, `baseWeaponName`, `unitFromRosterUnit` (`@grimstat/game-40k-11e`);
  `exportRosterText`, `importRosterText`, `exportRosterPrintHtml`, `RosterTextDialect` (`@grimstat/adapters`).
  No local shims remain.

## Requests / hand-offs

### packages/adapters (browser import)
- `fetchSource` downloads files strictly one after another; BSData catalogues are 1–5 MB each. A `concurrency`
  option (and an `AbortSignal` in `FetchSourceOptions` instead of callers wrapping `fetchImpl`) would cut the wall time.
- The GitHub tree API returns `size` per blob; passing `bytes`/`totalBytes` through `onProgress` would allow a real
  byte-based progress bar instead of file counts (the UI shows "n/total files" today).
- A `listBsdataCatalogues(fetchImpl)` helper (tree listing only, no downloads) would let the Data page offer a
  catalogue checklist instead of the free-text file-name filter; it costs the same single `api.github.com` request.
- Documenting the sizes in `SOURCES` (or a `sizeHint`) would remove the hard-coded "about 14 MB / 50 MB" strings in
  `en.ts`.

### packages/snapshot (browser import)
- With a BSData catalogue filter, the MFM still contributes factions, detachments and enhancements for *every*
  faction while only the filtered datasheets survive `dropStubs`: a Necrons-only fetch yields 30 factions and 270
  detachments for 67 datasheets. A policy flag such as `dropFactionsWithoutDatasheets` (cascading to detachments,
  enhancements and price rules) would keep filtered snapshots tidy; the UI shows the counts as they are.
- `mergeSources` and `buildSnapshot` are ~1–2 s of synchronous CPU for a one-faction snapshot; fine inside the worker,
  noticeable if they ever ran on the main thread.

### packages/snapshot
- **`loadSyntheticSnapshot()` is wired** (`apps/web/src/lib/snapshotSource.ts`) and, now that
  `packages/snapshot/src/synthetic/snapshot.json` is populated (label "synthetic fixture": 2 factions, 6 datasheets,
  2 detachments, enhancements, wargear prices), "Load sample data" stores that fixture. The guarded fallback to
  `apps/web/src/lib/sampleSnapshot.ts` is still in place for safety; it can be deleted together with the try/catch
  once the fixture is considered stable. Users who loaded the old built-in sample keep it as a second stored snapshot.
- `checksum.ts` reaches `node:crypto` only through a variable-specifier dynamic import (WebCrypto first), which keeps the
  browser bundle clean — please keep it that way (no static `node:*` imports anywhere reachable from the package index).
- The stand-in computes `checksum` with FNV-1a. The Data page displays checksums but does not verify them; a sync
  `checksumOf`-style verifier (or an async one the page can await) would let it flag tampered/corrupt imports.
- Snapshots produced by the CLI must be plain JSON that passes `Snapshot.parse` from `@grimstat/schema`; the Data page shows
  the first 15 zod issues on failure.

### packages/game-40k-11e (analyses)
- `efficiencyRanking` evaluates every attacker under one context (default shooting), so melee-only units rank at 0.
  The worker partitions melee-only attackers and ranks them with `phase: "fight", charged: true` before merging;
  `durabilityProfile` already auto-detects melee archetypes — the same auto-detection inside `efficiencyRanking`
  would remove that workaround.
- `runMatrix` cells carry the full `SimResult` (incl. `finalState`); the web worker strips `finalState`. A
  `{ slim?: boolean }` option (or omitting `finalState` unless requested) would avoid shipping it at all.
- `TurnAssignment.order` is 0-based; the UI shows the row position instead. Worth documenting on the type.
- `DEFAULT_TURN_OPTIONS` labels are inconsistent about stating the CP cost ("+1 to wound (1 CP)" vs
  "Command Re-roll (one hit roll)"); the UI appends "(n CP)" only when the label does not already mention CP.
  Consistent labels (without the cost) would let the UI format them uniformly.
- Nice-to-have: `MatrixCell` could expose `attackerPoints` / `defenderPoints` directly (they are on the nested
  `SimResult` today) so consumers do not need the unit list to label headers.

### packages/game-40k-11e (reverse / sensitivity / overrides)
- **`abilityEffects` ignores an explicit empty `effects: []`** (`if (ability.effects && ability.effects.length)`), so
  an override that marks an ability as "no combat effect" still lands in tier 3 and `coverageFor` keeps listing it.
  The coverage widget reclassifies such abilities to tier 1 on the UI side as a stopgap; please treat an explicit
  empty array as "modelled, no effect" (tier 1, like the core no-op keywords) so `SimResult.coverage` agrees.
- `reverseMathhammer` evaluates every candidate under the one `context` it is given; melee-only candidates score 0
  in the shooting phase (the UI's context controls always send a phase). `runMatrix` has a `phaseFor()` that
  switches melee-only attackers to `phase: "fight", charged: true` when no phase is given — the same auto-detection
  in `reverseMathhammer` (when `context.phase` is absent) would let mixed candidate sets rank sensibly; the UI would
  then stop sending `phase` unless the user picked one.
- `ReverseRow.points` is 0 when no candidate has points (a warning is emitted); an `undefined` would let the UI show
  "–" without guessing. The UI currently prints "–" for 0.
- `SENSITIVITY_VARIANTS` labels are shown verbatim (not translated), like the toggle labels.
- Nice-to-have: `sensitivity` appends `v.toggles` to `enabledToggles` even when that toggle is already on (harmless)
  or explicitly disabled with `-id` (the `-id` then still wins in `activeToggleEffects`); a `setToggle`-style merge
  would make the variant reflect "as if on".

### packages/snapshot
- `applyOverrides` is applied on the main thread for every snapshot read from Dexie (active + roster snapshots);
  fine at current sizes. If snapshots grow, an incremental version (only the patched collections cloned) would help.
- `diffSnapshots` runs on the main thread from the Data page (memoised per pair); the synthetic fixtures diff in
  well under a frame. A worker wrapper is easy to add if real snapshots make it noticeable.

### packages/game-40k-11e (army builder)
- **`constraints11e` `units.size` mis-handles multi-line compositions.** For a datasheet whose `composition` has one
  line per model profile (fixture: Warden Squad = `[{min 1, max 1}, {min 4, max 9}]`) it takes `max(...mins)` /
  `max(...maxs)` = 4 / 9, so a legal 10-model squad is reported as "maximum is 9". The web app's
  `compositionBounds()` sums the lines (5–10) and clamps the model-count control accordingly, so the UI and the
  diagnostic currently disagree at the top of the range. Suggested fix: sum mins/maxs when every line carries numbers.
- `unitFromRosterUnit` → `applyWargearSelection` keeps a weapon disabled when it was not in the default loadout even if
  the roster unit's `wargear` names it (fixture: adding "Fusion beamer" to the Ashen Crusher yields
  `Fusion beamer: count 1, enabled false`). A wargear selection should probably enable that profile (and disable the
  loadout default it replaces).
- `pointsFor(ds, snapshot, n)` only looks at the price rule covering copy #1; the add-unit picker uses it for the
  "from N pts" hint, which is fine, but the per-copy cost shown in rows comes from `rosterSummary`.
- Nice-to-have: `BATTLE_SIZES` has no entry for `"custom"`; the app mirrors the constraint's assumption (Strike Force
  DP budget) in `detachmentPointsFor()`. Exporting a `sizeRulesFor(roster)` helper would remove that duplication.

### packages/adapters (army builder)
- `importRosterText(text, snapshot, { name })`: `opts.name` is only a fallback; a "Name (N points)" header line in the
  text wins. The list page labels the field "Name (optional)" accordingly.
- The importer returns ids like `roster_xxx` / `u1`; the web app re-keys the roster id (`newId("roster")`) and keeps the
  unit ids as-is (they only need to be unique within the roster).
- `exportRosterPrintHtml` output is opened via a Blob URL in a new tab (`src/lib/download.ts#openHtmlInNewTab`), never
  via `document.write`.

### packages/schema (army builder)
- `RosterModelGroup` and `RosterDetachment` are exported only as zod values, not as types (`export type … = z.infer`
  is missing). The web app derives `ModelGroup = RosterUnit["models"][number]`; please add the type exports.

### packages/game-40k-11e
- Consumed exactly as `api.ts` describes: `plugin`, `runScenario`, `unitFromDatasheet`, `resolveScenarioUnit`, `listToggles`,
  `coverageFor`, `archetypes`, `gameSystem`, `manifest`, `GENERIC_TOGGLES`. Nothing else is imported.
- `runScenario` runs inside a Web Worker (`src/worker/sim.worker.ts`); it must stay free of DOM access (it is).
- Nice-to-have: the ability toggle ids `ability:<side>:<abilityId>` are stable across reloads only while the datasheet's
  `abilityIds` are stable — fine for now, but an override pack that renames ability ids would silently drop `-ability:*`
  disables from saved scenarios.
- Nice-to-have: a `UnitFromDatasheetOptions.weaponNames` UI is not exposed; the picker edits `enabled`/`count` on the
  returned `ScenarioWeapon[]` instead, which is sufficient.

### packages/plugin-host
- `WidgetDef.render` is opaque (`TProps`); the web app narrows it to a React component in `src/widgets/registry.ts`.
  Built-in widgets are registered through a `PluginModule` ("widgets-core") so third-party widget packs use the same door.
- The 40k plugin exports a `GameSystemPluginApi` object, not a `PluginModule`; `src/plugin.ts` wraps it with a small
  `activate()` that calls `registerGameSystem` + `registerArchetype`. If the plugin package later exports a `PluginModule`,
  drop that wrapper.

### apps/cli
- The Data page's "Import snapshot JSON…" expects the file the CLI writes for a snapshot (`Snapshot` JSON). Please keep the
  CLI output as a single `Snapshot` object (not wrapped) so it round-trips.

## Local decisions worth knowing
- Overrides are global (not keyed by snapshot): every stored snapshot gets the same override list; ones whose entity id
  is not in a snapshot are counted as "missing" for that snapshot and left untouched. The Data page keeps showing the
  *raw* snapshot's checksum.
- `#/data/overrides?q=<ability name>` pre-selects the exact-name match in the editor (that is what the coverage widget
  links to).
- Threshold default for E[slain] is the target's model count (the task said "total wounds" for every non-P(kill)
  metric; a wound count is unreachable as a slain count, so slain uses models). Users can type any threshold; "Use
  default" returns to auto.
- Analyses persist per tab in `settings`: `analyses.tab`, `analyses.matrix.{attackers,defenders,options}`,
  `analyses.durability.{defender,options}`, `analyses.efficiency.{attackers,options}`,
  `analyses.turn.{attackers,targets,options}`. Unit sets store sources, not units.
- Matrix "totals" sum additive metrics and average P(kill). The CSV export is long-form (one row per pair, every
  metric) rather than one grid per metric.
- Clicking a heatmap cell copies the pair (and the matrix context) into the calculator via `replaceScenario`, so the
  pickers re-sync exactly like a permalink open.
- Dexie stores: `snapshots`, `scenarios`, `layouts`, `settings` (v1) + `rosters`, `rosterVersions` (v2; db name
  `grimstat`). Export-all / import-all bundle format: `{ format: "grimstat-export", version: 1, exportedAt,
  stores: {..., rosters?} }`. The Armies page's "Export all" writes `{ format: "grimstat-rosters", version: 1, rosters }`.
- Roster permalinks: `#/armies?r=<token>`. Opening one stores the embedded roster (a copy named "… (from link)" when a
  different roster with the same id already exists locally) and replaces the hash with `#/armies/<id>`.
- Roster editor: the units list groups by section via `sectionOf()` in `src/lib/roster.ts` (flags → `role` text →
  keywords) rather than the adapters' `sectionOf`, so imports with only keywords still land in the right group; the
  export/print side keeps using the adapters' classification.
- New units get one model per leading profile and the remainder on the last profile (single profile = composition
  minimum), each group prefilled with the weapon base names (text before " – ") found in `datasheet.loadout`.
  The model-count control redistributes with `distributeModelCount()`; per-group counts are not edited directly.
- Version history stores full roster JSON per autosave (≤30 per roster); "Restore" writes a *new* revision.
- Permalinks: `#s=<lz-string compressToEncodedURIComponent({ v: 1, scenario, snapshotId? })>`; opening one replaces the
  hash with `#/calculator` after loading. Missing snapshot → notice; still runs when both units carry inline stats.
- Worker client caches snapshots by `id|checksum|updatedAt`; a superseded run that hogs the worker > 2.5 s terminates and
  respawns the worker (the only true cancellation for synchronous work).
- Dev server: `pnpm dev` (note: `pnpm --filter @grimstat/web dev -- --port N` forwards the `--` to vite; pass flags directly).
- The `react-resizable` handle CSS is inlined in `styles.css` because pnpm's strict layout does not expose it to apps/web.
