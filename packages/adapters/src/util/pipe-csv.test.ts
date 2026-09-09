import { describe, expect, it } from "vitest";
import { parsePipeCsv } from "./pipe-csv";

describe("parsePipeCsv", () => {
  it("strips the BOM, drops the trailing empty column and keeps CRLF files intact", () => {
    const r = parsePipeCsv("﻿id|name|\r\n1|Alpha|\r\n2|Beta|\r\n");
    expect(r.header).toEqual(["id", "name"]);
    expect(r.rows).toEqual([
      { id: "1", name: "Alpha" },
      { id: "2", name: "Beta" },
    ]);
    expect(r.warnings).toEqual([]);
  });

  it("joins physical lines that belong to one multi-line field", () => {
    const text = "id|description|extra|\n1|first line\nsecond line\n\nfourth|x|\n2|single|y|\n";
    const r = parsePipeCsv(text);
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0]).toEqual({ id: "1", description: "first line\nsecond line\n\nfourth", extra: "x" });
    expect(r.rows[1]).toEqual({ id: "2", description: "single", extra: "y" });
  });

  it("ends a record only at a newline that follows the trailing delimiter", () => {
    // the description has exactly as many fields as the header before the newline, but no trailing pipe yet
    const text = "id|name|legend|faction|description|\n9|Scouts|fluff||<div>\n<p>more</p>|\n";
    const r = parsePipeCsv(text);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]!.description).toBe("<div>\n<p>more</p>");
  });

  it("honours quoted fields with doubled quotes only when the field starts with a quote", () => {
    const r = parsePipeCsv('id|text|\n1|"a|b ""quoted"""|\n2|say "hi"|\n');
    expect(r.rows[0]!.text).toBe('a|b "quoted"');
    expect(r.rows[1]!.text).toBe('say "hi"');
  });

  it("merges surplus columns into the last one and pads short rows", () => {
    const r = parsePipeCsv("id|text|\n1|a|b|\n2|\n");
    expect(r.rows[0]).toEqual({ id: "1", text: "a|b" });
    expect(r.rows[1]).toEqual({ id: "2", text: "" });
    expect(r.warnings).toHaveLength(2);
  });

  it("also parses files without trailing delimiters", () => {
    const r = parsePipeCsv("a|b\n1|x\n2|y\n");
    expect(r.rows).toEqual([
      { a: "1", b: "x" },
      { a: "2", b: "y" },
    ]);
  });

  it("supports another delimiter and skips blank lines", () => {
    const r = parsePipeCsv("a;b\n\n1;x\n\n", { delimiter: ";" });
    expect(r.rows).toEqual([{ a: "1", b: "x" }]);
  });
});
