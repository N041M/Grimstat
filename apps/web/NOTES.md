# apps/web — notes and requests for other packages

Status: Phase 3 web app (Vite + React 18 + TypeScript, offline PWA) plus the Phase 4 army builder ("Armies" section).
`pnpm typecheck` clean, `pnpm vitest run apps/web` green, `pnpm --filter @grimstat/web build` green.

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
