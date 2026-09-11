import { describe, expect, it } from "vitest";
import { isZip, looksLikeRosterXml, rosterFileKind } from "./rosterFile";

const bytes = (s: string): Uint8Array => new TextEncoder().encode(s);
const withBom = (s: string): Uint8Array => new Uint8Array([0xef, 0xbb, 0xbf, ...bytes(s)]);

describe("recognising a zip", () => {
  it("knows the signature, whatever the file is called", () => {
    expect(isZip(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14]))).toBe(true);
    expect(isZip(new Uint8Array([0x50, 0x4b, 0x05, 0x06]))).toBe(true); // an empty archive
    expect(isZip(new Uint8Array([0x50, 0x4b, 0x07, 0x08]))).toBe(true); // a spanned one
  });

  it("is not fooled by text that happens to start with PK", () => {
    expect(isZip(bytes("PKZ Warband (2000 points)"))).toBe(false);
    expect(isZip(bytes(""))).toBe(false);
  });
});

describe("recognising roster XML", () => {
  it("takes a declaration or a bare roster element", () => {
    expect(looksLikeRosterXml('<?xml version="1.0"?><roster/>')).toBe(true);
    expect(looksLikeRosterXml('<roster name="Warband">')).toBe(true);
    expect(looksLikeRosterXml("  \n <ROSTER>")).toBe(true);
  });

  it("sees past a byte-order mark, which BattleScribe writes", () => {
    expect(looksLikeRosterXml('﻿<?xml version="1.0"?>')).toBe(true);
  });

  it("rejects a text list, and XML that is not a roster", () => {
    expect(looksLikeRosterXml("Warband (2000 points)\n\nChar1: Captain")).toBe(false);
    expect(looksLikeRosterXml("<html><body>")).toBe(false);
    expect(looksLikeRosterXml("")).toBe(false);
  });
});

describe("choosing what to do with a file", () => {
  it("sorts the three shapes apart", () => {
    expect(rosterFileKind(new Uint8Array([0x50, 0x4b, 0x03, 0x04]))).toBe("zip");
    expect(rosterFileKind(bytes('<?xml version="1.0"?><roster/>'))).toBe("xml");
    expect(rosterFileKind(withBom("<roster/>"))).toBe("xml");
    expect(rosterFileKind(bytes("Warband (2000 points)"))).toBe("text");
  });

  it("does not need the whole file to decide", () => {
    const long = bytes(`<?xml version="1.0"?><roster>${"<selection/>".repeat(5000)}</roster>`);
    expect(rosterFileKind(long)).toBe("xml");
  });
});
