import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { exportJson, importJson, jsonExporter } from "./index";
import { SYNTHETIC_DIR } from "../test-utils";

describe("json exporter", () => {
  const text = readFileSync(join(SYNTHETIC_DIR, "snapshot.json"), "utf8");
  it("round-trips the synthetic snapshot", () => {
    const snap = importJson(text);
    expect(exportJson(snap)).toBe(text);
    expect(jsonExporter.export(snap)).toBe(text);
    expect(jsonExporter.extension).toBe(".json");
  });
  it("validates on export", () => {
    const snap = importJson(text);
    expect(() => exportJson({ ...snap, checksum: 5 as unknown as string })).toThrow();
    expect(exportJson(snap, { indent: 0 })).not.toContain("\n  ");
  });
});
