# apps/web — notes and requests for other packages

Status: Phase 3 web app (Vite + React 18 + TypeScript, offline PWA). `pnpm typecheck` clean, `pnpm vitest run apps/web` green, `pnpm --filter @grimstat/web build` green.

## Requests / hand-offs

### packages/snapshot
- **`loadSyntheticSnapshot()` is wired** (`apps/web/src/lib/snapshotSource.ts`) but guarded: at the time of writing
  `packages/snapshot/src/synthetic/snapshot.json` is `{}` and `Snapshot.parse` throws, so the Data page falls back to the
  local stand-in in `apps/web/src/lib/sampleSnapshot.ts` (label "Synthetic sample (built-in)"). As soon as the fixture is
  populated the real one is used automatically; then delete `sampleSnapshot.ts` and the try/catch.
- `checksum.ts` reaches `node:crypto` only through a variable-specifier dynamic import (WebCrypto first), which keeps the
  browser bundle clean — please keep it that way (no static `node:*` imports anywhere reachable from the package index).
- The stand-in computes `checksum` with FNV-1a. The Data page displays checksums but does not verify them; a sync
  `checksumOf`-style verifier (or an async one the page can await) would let it flag tampered/corrupt imports.
- Snapshots produced by the CLI must be plain JSON that passes `Snapshot.parse` from `@grimstat/schema`; the Data page shows
  the first 15 zod issues on failure.

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
- Dexie stores: `snapshots`, `scenarios`, `layouts`, `settings` (db name `grimstat`, version 1). Export-all / import-all
  bundle format: `{ format: "grimstat-export", version: 1, exportedAt, stores: {...} }`.
- Permalinks: `#s=<lz-string compressToEncodedURIComponent({ v: 1, scenario, snapshotId? })>`; opening one replaces the
  hash with `#/calculator` after loading. Missing snapshot → notice; still runs when both units carry inline stats.
- Worker client caches snapshots by `id|checksum|updatedAt`; a superseded run that hogs the worker > 2.5 s terminates and
  respawns the worker (the only true cancellation for synchronous work).
- Dev server: `pnpm dev` (note: `pnpm --filter @grimstat/web dev -- --port N` forwards the `--` to vite; pass flags directly).
- The `react-resizable` handle CSS is inlined in `styles.css` because pnpm's strict layout does not expose it to apps/web.
