# Synthetic fixtures

Invented factions, units, numbers and rules text used by the adapter, snapshot and CLI tests.
Nothing here is Games Workshop content. The three input folders mirror the real upstream formats:

- `mfm/` — BSData/wh40k-11e-mfm style YAML (points authority)
- `wahapedia/` — pipe-delimited CSV export with a BOM, trailing pipes and HTML in descriptions
- `bsdata/` — BattleScribe JSON (game system + a thin catalogue importing a library + a self-contained catalogue)

`snapshot.json` is generated from them by `pnpm cli synthetic` (verified by `pnpm cli synthetic --check`
and the CLI tests); a copy lives in `packages/snapshot/src/synthetic/snapshot.json` for the browser bundle.
