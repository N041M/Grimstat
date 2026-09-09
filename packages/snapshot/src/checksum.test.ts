import { describe, expect, it } from "vitest";
import { canonicalJson, checksumOf, sha256Hex, sortKeys } from "./checksum";

describe("canonicalJson", () => {
  it("is independent of key order and drops undefined", () => {
    const a = { b: 1, a: { d: [1, { z: 1, y: 2 }], c: "x" }, u: undefined };
    const b = { a: { c: "x", d: [1, { y: 2, z: 1 }] }, b: 1 };
    expect(canonicalJson(a)).toBe(canonicalJson(b));
    expect(canonicalJson(a)).toBe('{"a":{"c":"x","d":[1,{"y":2,"z":1}]},"b":1}');
    expect(sortKeys({ b: null, a: 0 })).toEqual({ a: 0, b: null });
  });
  it("keeps array order (it is meaningful)", () => {
    expect(canonicalJson([2, 1])).not.toBe(canonicalJson([1, 2]));
  });
});

describe("sha256Hex", () => {
  it("matches the known test vector", async () => {
    expect(await sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(await sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });
  it("hashes canonical JSON so key order does not matter", async () => {
    expect(await checksumOf({ x: 1, y: [{ b: 2, a: 1 }] })).toBe(await checksumOf({ y: [{ a: 1, b: 2 }], x: 1 }));
  });
});
