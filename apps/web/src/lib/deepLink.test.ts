import { describe, expect, it } from "vitest";
import { appLinkFor } from "./deepLink";

const SITE = "https://grimstat.com";

describe("appLinkFor", () => {
  it("passes a sign-in link and a share link on as the hash they carry", () => {
    expect(appLinkFor("https://grimstat.com/#/profile?code=abc123", SITE)).toEqual({ kind: "hash", hash: "#/profile?code=abc123" });
    expect(appLinkFor("https://grimstat.com/#s=token", SITE)).toEqual({ kind: "hash", hash: "#s=token" });
    expect(appLinkFor("https://grimstat.com/#/armies?r=token", SITE)).toEqual({ kind: "hash", hash: "#/armies?r=token" });
  });

  it("turns a public page into its screen, in lower case as the site does", () => {
    expect(appLinkFor("https://grimstat.com/u/Karel", SITE)).toEqual({ kind: "hash", hash: "#/u/karel" });
    expect(appLinkFor("https://grimstat.com/u/karel/", SITE)).toEqual({ kind: "hash", hash: "#/u/karel" });
  });

  it("names a short link, which the server has to be asked about", () => {
    expect(appLinkFor("https://grimstat.com/l/abcd1234", SITE)).toEqual({ kind: "short", id: "abcd1234" });
  });

  it("does nothing with the bare site, another site or a broken address", () => {
    expect(appLinkFor("https://grimstat.com/", SITE)).toBeUndefined();
    expect(appLinkFor("https://grimstat.com/#", SITE)).toBeUndefined();
    expect(appLinkFor("https://evil.example/l/abcd1234", SITE)).toBeUndefined();
    expect(appLinkFor("https://grimstat.com/about", SITE)).toBeUndefined();
    expect(appLinkFor("not a url", SITE)).toBeUndefined();
    expect(appLinkFor("https://grimstat.com/l/x", "")).toBeUndefined();
  });
});
