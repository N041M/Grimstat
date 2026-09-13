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
  /** Smallest size the panel stays legible at, in grid units. Defaults are derived when omitted. */
  minSize?: { w: number; h: number };
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

interface Version {
  major: number;
  minor: number;
  patch: number;
}

function parseVersion(v: string): Version | undefined {
  const m = /^(\d+)\.(\d+)(?:\.(\d+))?$/.exec(v.trim());
  if (!m) return undefined;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3] ?? "0") };
}

function compareVersions(a: Version, b: Version): number {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}

/**
 * Does the host API satisfy the range a manifest was written against? `^`, `~`, `>=` and a bare version
 * are understood; anything else is treated as incompatible. A bare version must match the host's major,
 * and its minor too while the API is pre-1.0, where every minor release may break plugins.
 */
export function compatible(apiVersion: string): boolean {
  const host = parseVersion(PLUGIN_API_VERSION);
  const range = /^\s*(\^|~|>=)?\s*(.*)$/.exec(apiVersion);
  const want = range ? parseVersion(range[2] ?? "") : undefined;
  if (!host || !want) return false;
  const op = range?.[1];
  if (op === ">=") return compareVersions(host, want) >= 0;
  // `^`, `~` and a bare version all need a host that is at least as new as the version asked for.
  if (compareVersions(host, want) < 0) return false;
  if (op === "~") return host.major === want.major && host.minor === want.minor;
  if (op === "^") return want.major === 0 ? host.major === 0 && host.minor === want.minor : host.major === want.major;
  return host.major === want.major && (host.major !== 0 || host.minor === want.minor);
}

export class PluginHost {
  readonly registries = createRegistries();
  /** Which plugin registered each `${kind}:${id}`, so a collision can name the plugin that holds the id. */
  private readonly owners = new Map<string, string>();

  async load(mod: PluginModule): Promise<void> {
    const m = mod.manifest;
    if (!compatible(m.apiVersion)) throw new Error(`Plugin ${m.id}@${m.version} targets API ${m.apiVersion}; host is ${PLUGIN_API_VERSION}`);
    if (this.registries.manifests.has(m.id)) throw new Error(`Plugin ${m.id} already loaded`);
    // Registrations are staged and committed once activate() resolves, so a plugin that throws part of the
    // way through leaves the registries as they were and can be loaded again.
    const staged = createRegistries();
    /**
     * An id already registered stays with the plugin that registered it first. The second plugin is
     * refused, which fails its load and leaves the first one whole. Letting the second one win would
     * disable part of the first with nothing to show for it. The refusal is recorded as well as thrown,
     * so a plugin that catches the error during activate() still fails to load.
     */
    const refused: string[] = [];
    const claim = <V>(kind: string, id: string, into: Map<string, V>): void => {
      const owner = this.owners.get(`${kind}:${id}`);
      const clash = owner ? `plugin ${owner} registered it first` : into.has(id) ? "it registered that id already" : undefined;
      if (!clash) return;
      const message = `Plugin ${m.id} cannot register ${kind} "${id}": ${clash}`;
      refused.push(message);
      throw new Error(message);
    };
    const ctx: PluginContext = {
      registerGameSystem: (id, api) => {
        claim("game system", id, staged.gameSystems);
        staged.gameSystems.set(id, api);
      },
      registerWidget: (def) => {
        claim("widget", def.id, staged.widgets);
        staged.widgets.set(def.id, def);
      },
      registerAnalysis: (def) => {
        claim("analysis", def.id, staged.analyses);
        staged.analyses.set(def.id, def);
      },
      registerArchetype: (a) => {
        claim("archetype", a.id, staged.archetypes);
        staged.archetypes.set(a.id, a);
      },
    };
    await mod.activate(ctx);
    if (refused.length) throw new Error(refused[0]);
    const r = this.registries;
    const commit = <V>(kind: string, from: Map<string, V>, to: Map<string, V>): void => {
      for (const [id, v] of from) {
        to.set(id, v);
        this.owners.set(`${kind}:${id}`, m.id);
      }
    };
    commit("game system", staged.gameSystems, r.gameSystems);
    commit("widget", staged.widgets, r.widgets);
    commit("analysis", staged.analyses, r.analyses);
    commit("archetype", staged.archetypes, r.archetypes);
    r.manifests.set(m.id, m);
  }
}
