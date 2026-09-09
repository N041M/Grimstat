import { PLUGIN_API_VERSION, type Archetype, type PluginManifest } from "@grimstat/schema";

/**
 * Minimal plugin host: registries + manifest validation. First-party plugins register in-process;
 * a worker sandbox for third-party plugins is a later phase (see docs/DESIGN.md Phase 6).
 */
export interface WidgetDef<TProps = unknown> {
  id: string;
  title: string;
  description?: string;
  /** Which inputs this widget consumes. */
  inputs: Array<"scenario" | "result" | "snapshot" | "roster">;
  defaultSize: { w: number; h: number };
  /** Framework-specific render token (e.g. a React component). Kept opaque here. */
  render: TProps;
  requires?: string;
}

export interface AnalysisDef {
  id: string;
  title: string;
  description?: string;
  run: (...args: unknown[]) => unknown;
}

export interface Registries {
  widgets: Map<string, WidgetDef>;
  analyses: Map<string, AnalysisDef>;
  archetypes: Map<string, Archetype>;
  gameSystems: Map<string, unknown>;
  manifests: Map<string, PluginManifest>;
}

export function createRegistries(): Registries {
  return { widgets: new Map(), analyses: new Map(), archetypes: new Map(), gameSystems: new Map(), manifests: new Map() };
}

export interface PluginContext {
  registerGameSystem(id: string, api: unknown): void;
  registerWidget(def: WidgetDef): void;
  registerAnalysis(def: AnalysisDef): void;
  registerArchetype(a: Archetype): void;
}

export interface PluginModule {
  manifest: PluginManifest;
  activate(ctx: PluginContext): void | Promise<void>;
}

function majorOf(v: string): number {
  return Number(v.split(".")[0] ?? "0");
}

export function compatible(apiVersion: string): boolean {
  // pre-1.0: exact major AND minor must match; post-1.0: major must match
  const [hMaj, hMin] = PLUGIN_API_VERSION.split(".").map(Number);
  const [pMaj, pMin] = apiVersion.split(".").map(Number);
  if ((hMaj ?? 0) === 0) return hMaj === pMaj && hMin === pMin;
  return majorOf(PLUGIN_API_VERSION) === majorOf(apiVersion);
}

export class PluginHost {
  readonly registries = createRegistries();

  async load(mod: PluginModule): Promise<void> {
    const m = mod.manifest;
    if (!compatible(m.apiVersion)) throw new Error(`Plugin ${m.id}@${m.version} targets API ${m.apiVersion}; host is ${PLUGIN_API_VERSION}`);
    if (this.registries.manifests.has(m.id)) throw new Error(`Plugin ${m.id} already loaded`);
    const r = this.registries;
    const ctx: PluginContext = {
      registerGameSystem: (id, api) => r.gameSystems.set(id, api),
      registerWidget: (def) => r.widgets.set(def.id, def),
      registerAnalysis: (def) => r.analyses.set(def.id, def),
      registerArchetype: (a) => r.archetypes.set(a.id, a),
    };
    await mod.activate(ctx);
    r.manifests.set(m.id, m);
  }
}
