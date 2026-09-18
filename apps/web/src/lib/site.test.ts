import { describe, expect, it } from "vitest";
import { onSite, siteFrom } from "./site";

describe("siteFrom", () => {
  it("is empty for the website's own build", () => {
    expect(siteFrom(undefined)).toBe("");
    expect(siteFrom("  ")).toBe("");
  });

  it("keeps the origin and drops a path or a trailing slash", () => {
    expect(siteFrom("https://grimstat.com/")).toBe("https://grimstat.com");
    expect(siteFrom("https://grimstat.com/some/path")).toBe("https://grimstat.com");
    expect(siteFrom("http://localhost:5173")).toBe("http://localhost:5173");
  });

  it("refuses anything that is not a web address", () => {
    expect(siteFrom("grimstat.com")).toBe("");
    expect(siteFrom("javascript:alert(1)")).toBe("");
  });
});

describe("onSite", () => {
  it("leaves paths alone on the website", () => {
    expect(onSite("/api/sync", "")).toBe("/api/sync");
    expect(onSite("/wahapedia", "")).toBe("/wahapedia");
  });

  it("joins a path to the site in the phone app", () => {
    expect(onSite("/api/sync", "https://grimstat.com")).toBe("https://grimstat.com/api/sync");
    expect(onSite("/wahapedia/wh40k-11e/", "https://grimstat.com")).toBe("https://grimstat.com/wahapedia/wh40k-11e/");
  });

  it("does not touch an address that is already absolute", () => {
    expect(onSite("https://raw.githubusercontent.com/x/y", "https://grimstat.com")).toBe("https://raw.githubusercontent.com/x/y");
  });
});
