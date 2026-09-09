# Extending Grimstat without touching the core

Everything that changes with a codex, dataslate or edition is data or a plugin. This page shows the four extension points and what each one costs.

## 1. A new weapon keyword (Tier-1)

Register a handler in the game-system plugin. Handlers translate a keyword into modifiers on named channels; the engine never sees the keyword itself.

```ts
// packages/game-40k-11e/src/keywords.ts
r.register("SHRED", (_kw, c) => {
  // re-roll failed wound rolls against INFANTRY
  if (c.targetKeywords.has("INFANTRY")) c.mods.add({ channel: CH.rerollWound, op: "reroll", value: "failed", source: "Shred" });
});
```

Channels and their caps live in `channels.ts` (`hit-roll` is capped ±1, `skill` is the uncapped BS/WS stat channel, and so on). Keywords with no effect on the maths go in `registerInert(...)` so they do not show up as unmodelled.

## 2. A new unit ability (Tier-2, no code)

Ability rows carry `effects: EffectRecord[]`. Add them in an override pack (YAML merge patch keyed by ability id) and re-import; nothing else changes.

```yaml
- entity: ability
  id: wahapedia:ability:1234
  patch:
    effects:
      - when: { stage: wound, side: attacker }
        if: { targetKeyword: VEHICLE }
        op: add
        target: wound-roll
        value: 1
        source: "Tank hunters"
```

Generic phrasings ("re-roll a hit roll of 1", "-1 Damage", "Feel No Pain 5+") are already recognised by the pattern library in `patterns.ts`; add a regex there when a phrasing recurs across many datasheets.

## 3. A new data source

An adapter is a function that parses upstream files into `Partial<SnapshotData>` plus a `SourceRef`. Register it in `packages/adapters/src/sources.ts` with its licence and attribution, and give it a precedence rank in `packages/snapshot` so conflicts resolve deterministically. Adapters never bundle upstream data; they fetch it on the user's machine.

## 4. A new dashboard widget

```ts
host.registries.widgets.set("kill-curve", {
  id: "kill-curve",
  title: "Kill probability",
  inputs: ["result"],
  defaultSize: { w: 6, h: 4 },
  render: KillCurve, // a React component receiving { result, scenario, snapshot }
});
```

Widgets read the shared selection context (current scenario, result, snapshot, roster) and never call the engine themselves; the worker does.

## 5. A new edition of 40k

Another edition is a set of rule constants plus keyword differences on the same pipeline. `packages/game-40k-10e` is the worked example and is 30 lines:

```ts
export const plugin = createGameSystem({
  manifest, gameSystem,
  rules: RULES_10E,                       // cover as a save bonus, mandatory Lethal Hits, Hazardous on 1s, no auto-6 saves
  keywords: (registry) => registry.register("CLEAVE", (_kw, c) => c.warnings.push("CLEAVE is not a 10th-edition ability.")),
});
```

`RulesParams` (in `manifest.ts`) lists every edition-level switch. Add a field there when a new edition needs a new switch; the 11e and 10e defaults live side by side.

## 6. A different game system

Copy `packages/game-40k-11e` to `packages/game-<system>` and change `manifest.ts` (ids, rules), `keywords.ts` and `patterns.ts` (vocabulary), `constraints.ts` (list-building rules) and `archetypes.ts`. The engine (`packages/engine`) takes probabilities and distributions only, so it is shared unchanged. The plugin host checks `apiVersion` compatibility on load; `packages/plugin-host/src/modularity.test.ts` shows a third-party plugin adding a keyword, a widget and an archetype through the public API only.

## Guarantees the core keeps

- `engine`, `effects`, `resolver` and `schema` contain no publisher text and have no dependency on any game plugin.
- A plugin that registers a fake keyword and a fake widget must pass the test suite without modifying any core package (this is a CI check in Phase 6).
