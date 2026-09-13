import { describe, expect, it } from "vitest";
import { ROUTES, hrefFor, isUnknownRoute, parseRouteInfo } from "./router";

describe("isUnknownRoute", () => {
  it("marks an address whose screen does not exist", () => {
    expect(isUnknownRoute("#/nonsense")).toBe(true);
    expect(isUnknownRoute("#/nonsense/42")).toBe(true);
    expect(isUnknownRoute("#/nonsense?a=b")).toBe(true);
    expect(isUnknownRoute("nonsense")).toBe(true);
  });

  it("leaves every real address alone", () => {
    for (const r of ROUTES) expect(isUnknownRoute(hrefFor(r))).toBe(false);
    expect(isUnknownRoute("#/armies/abc")).toBe(false);
    expect(isUnknownRoute("#/data/overrides")).toBe(false);
  });

  it("leaves an empty hash and a permalink alone, since neither is an address", () => {
    expect(isUnknownRoute("")).toBe(false);
    expect(isUnknownRoute("#")).toBe(false);
    expect(isUnknownRoute("#s=N4IgLg")).toBe(false);
    expect(isUnknownRoute("#/armies?r=N4IgLg")).toBe(false);
  });

  it("marks exactly the hashes that land somewhere other than where they point", () => {
    expect(parseRouteInfo("#/nonsense").route).toBe("calculator");
    expect(parseRouteInfo("#/armies/abc").route).toBe("armies");
  });
});
