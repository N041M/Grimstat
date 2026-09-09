import { PluginHost, type PluginModule } from "@grimstat/plugin-host";
import { plugin as game, manifest as gameManifest, gameSystem, archetypes, type GameSystemPluginApi } from "@grimstat/game-40k-11e";
import { coreWidgetsPlugin } from "./widgets";

/** The single plugin host for the web app. First-party plugins load in-process. */
export const host = new PluginHost();

const gameModule: PluginModule = {
  manifest: gameManifest,
  activate(ctx) {
    ctx.registerGameSystem(gameSystem.id, game);
    for (const a of archetypes) ctx.registerArchetype(a);
  },
};

/** Resolves once every first-party plugin is registered; main.tsx awaits it before rendering. */
export const pluginsReady: Promise<void> = (async () => {
  await host.load(gameModule);
  await host.load(coreWidgetsPlugin);
})();

export function gameApi(): GameSystemPluginApi {
  const api = host.registries.gameSystems.get(gameSystem.id);
  if (!api) throw new Error(`Game system ${gameSystem.id} is not registered`);
  return api as GameSystemPluginApi;
}
