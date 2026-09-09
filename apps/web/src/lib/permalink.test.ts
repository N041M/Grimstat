import { describe, expect, it } from "vitest";
import type { Scenario } from "@grimstat/schema";
import { decodePermalink, encodePermalink, permalinkTokenFromHash, permalinkUrl } from "./permalink";

const scenario: Scenario = {
  id: "sc-1",
  name: "Test scenario",
  gameSystemId: "wh40k-11e",
  ownerId: "local",
  createdAt: "2026-09-09T10:00:00.000Z",
  updatedAt: "2026-09-09T10:00:00.000Z",
  revision: 0,
  attacker: {
    name: "Test Squad",
    keywords: ["INFANTRY"],
    models: [{ name: "Trooper", count: 5, T: 4, Sv: 3, InvSv: null, W: 2, fnp: null, isCharacter: false, keywords: [] }],
    weapons: [{ name: "Test rifle", count: 5, kind: "ranged", range: 24, A: "2", skill: 3, S: 4, AP: 1, D: "1", keywords: [{ name: "RAPID FIRE", value: 1, raw: "Rapid Fire 1" }], enabled: true }],
    effects: [],
    points: 90,
  },
  defender: {
    name: "Test Tank",
    keywords: ["VEHICLE"],
    models: [{ name: "Tank", count: 1, T: 11, Sv: 2, InvSv: null, W: 14, fnp: null, isCharacter: false, keywords: [] }],
    weapons: [],
    effects: [],
  },
  context: {
    rangeBand: "half",
    charged: false,
    stationary: true,
    inCover: false,
    snapShooting: false,
    phase: "shooting",
    flags: [],
    allocationPolicy: "protect-character",
    lethalChoice: "auto",
    weaponOrder: "heuristic",
    mcIterations: 20000,
    backend: "auto",
  },
  enabledToggles: ["plus1-hit", "-ability:defender:x"],
  extraEffects: [],
};

describe("permalink", () => {
  it("round-trips a scenario with a snapshot id", () => {
    const token = encodePermalink({ scenario, snapshotId: "snap-1" });
    expect(token).toMatch(/^[A-Za-z0-9+\-$]+$/);
    const back = decodePermalink(token);
    expect(back.scenario).toEqual(scenario);
    expect(back.snapshotId).toBe("snap-1");
  });

  it("round-trips without a snapshot id", () => {
    const back = decodePermalink(encodePermalink({ scenario }));
    expect(back.scenario).toEqual(scenario);
    expect(back.snapshotId).toBeUndefined();
  });

  it("rejects garbage", () => {
    expect(() => decodePermalink("not-a-token")).toThrow();
    expect(() => decodePermalink(encodePermalink({ scenario: { nope: true } as unknown as Scenario }))).toThrow();
  });

  it("builds and parses hash urls", () => {
    const url = permalinkUrl({ scenario, snapshotId: "snap-1" }, "https://example.test/");
    expect(url.startsWith("https://example.test/#s=")).toBe(true);
    const hash = url.slice(url.indexOf("#"));
    const token = permalinkTokenFromHash(hash);
    expect(token).toBeDefined();
    expect(decodePermalink(token!).snapshotId).toBe("snap-1");
    expect(permalinkTokenFromHash("#/calculator")).toBeUndefined();
    expect(permalinkTokenFromHash("#/calculator?s=abc")).toBe("abc");
  });
});
