import { describe, expect, it } from "vitest";
import { Datasheet, Enhancement, ModelProfile, PriceTier, Stratagem, WeaponProfile } from "./index";

const MODEL = { id: "mp:f:squad:trooper", name: "Trooper", T: 4, Sv: 3, W: 2 };
const WEAPON = { id: "wp:f:squad:bolter", name: "Bolter", kind: "ranged", range: 24, A: 2, skill: 3, S: 4, AP: 0, D: 1 };
const DATASHEET = { id: "ds:f:squad", gameSystemId: "wh40k-11e", factionId: "faction:f", name: "Squad", models: [MODEL] };

describe("model and weapon characteristics", () => {
  it("rejects a model with no wounds", () => {
    // A group of zero-wound models makes the engine's allocation read the group as already slain,
    // and the exact and Monte Carlo backends then disagree about a unit nothing has shot at.
    expect(ModelProfile.safeParse({ ...MODEL, W: 0 }).success).toBe(false);
    expect(ModelProfile.safeParse({ ...MODEL, W: -1 }).success).toBe(false);
    expect(ModelProfile.safeParse({ ...MODEL, W: 1.5 }).success).toBe(false);
    expect(ModelProfile.safeParse({ ...MODEL, W: 16 }).success).toBe(true);
  });

  it("keeps a zero-wound model out of a datasheet", () => {
    expect(Datasheet.safeParse(DATASHEET).success).toBe(true);
    expect(Datasheet.safeParse({ ...DATASHEET, models: [{ ...MODEL, W: 0 }] }).success).toBe(false);
  });

  it("rejects zero toughness, zero save and zero strength", () => {
    expect(ModelProfile.safeParse({ ...MODEL, T: 0 }).success).toBe(false);
    expect(ModelProfile.safeParse({ ...MODEL, Sv: 0 }).success).toBe(false);
    expect(WeaponProfile.safeParse({ ...WEAPON, S: 0 }).success).toBe(false);
  });

  it("takes the values a real source does emit", () => {
    // AP is stored as a magnitude, and AP 0 is the commonest weapon there is.
    expect(WeaponProfile.safeParse({ ...WEAPON, AP: 0 }).success).toBe(true);
    expect(WeaponProfile.safeParse({ ...WEAPON, AP: -1 }).success).toBe(false);
    // Sv 7 is how a model with no armour save is stored, and a melee weapon has no range.
    expect(ModelProfile.safeParse({ ...MODEL, Sv: 7, InvSv: null, M: null, Ld: null, OC: 0 }).success).toBe(true);
    expect(WeaponProfile.safeParse({ ...WEAPON, kind: "melee", range: null, skill: null }).success).toBe(true);
  });
});

describe("points and costs", () => {
  it("accepts a free upgrade and rejects a negative cost", () => {
    expect(PriceTier.safeParse({ models: 5, points: 0 }).success).toBe(true);
    expect(PriceTier.safeParse({ models: 5, points: -10 }).success).toBe(false);
    expect(Enhancement.safeParse({ id: "enh:f:d:relic", detachmentId: "det:f:d", name: "Relic", cost: 0 }).success).toBe(true);
    expect(Enhancement.safeParse({ id: "enh:f:d:relic", detachmentId: "det:f:d", name: "Relic", cost: -5 }).success).toBe(false);
    expect(Stratagem.safeParse({ id: "strat:boom", name: "Boom", cpCost: 0 }).success).toBe(true);
    expect(Stratagem.safeParse({ id: "strat:boom", name: "Boom", cpCost: -1 }).success).toBe(false);
    expect(Datasheet.safeParse({ ...DATASHEET, fallbackPoints: -60 }).success).toBe(false);
  });
});
