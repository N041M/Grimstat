import { z } from "zod";

export const PluginKind = z.enum(["game-system", "adapter", "effects", "widgets", "exporter", "analysis"]);
export type PluginKind = z.infer<typeof PluginKind>;

export const PluginManifest = z.object({
  id: z.string(),
  name: z.string(),
  version: z.string(),
  /** Semver range of the host plugin API this plugin was written against. */
  apiVersion: z.string(),
  kind: PluginKind,
  requires: z.record(z.string()).optional(),
  /** Module specifier or URL. First-party plugins are imported in-process; third-party run in a worker sandbox. */
  entry: z.string(),
  trusted: z.boolean().default(false),
});
export type PluginManifest = z.infer<typeof PluginManifest>;

export const PLUGIN_API_VERSION = "0.1.0";
