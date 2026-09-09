import { Snapshot } from "@grimstat/schema";

export interface JsonExportOptions {
  /** Pretty-print with this indent (default 2). Pass 0 for compact output. */
  indent?: number;
  /** Validate with the Zod schema before serialising (default true). */
  validate?: boolean;
}

/** Serialise a snapshot to JSON. The default output is pretty-printed and schema-validated. */
export function exportJson(snapshot: Snapshot, opts: JsonExportOptions = {}): string {
  const value = opts.validate === false ? snapshot : Snapshot.parse(snapshot);
  const indent = opts.indent ?? 2;
  return JSON.stringify(value, null, indent > 0 ? indent : undefined) + "\n";
}

/** Parse a JSON document previously produced by `exportJson` (schema-validated). */
export function importJson(text: string): Snapshot {
  return Snapshot.parse(JSON.parse(text));
}

export interface Exporter<T = string> {
  id: string;
  export(snapshot: Snapshot): T;
  mediaType: string;
  extension: string;
}

export const jsonExporter: Exporter = {
  id: "json",
  export: (s) => exportJson(s),
  mediaType: "application/json",
  extension: ".json",
};
