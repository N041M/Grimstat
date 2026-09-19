import { describe, expect, it } from "vitest";
import { HULL_SIZES, hullSizeFor, hullSizeOfModel } from "./hullSizes";

describe("hull sizes on record", () => {
  it("finds a kit by its datasheet name, whatever the case, and the family a variant belongs to", () => {
    expect(hullSizeFor("Leman Russ Battle Tank")?.length).toBe(120);
    expect(hullSizeFor("LEMAN RUSS VANQUISHER")?.length).toBe(120);
    expect(hullSizeFor("Chaos Rhino")?.kit).toContain("Rhino");
    expect(hullSizeFor("Shadowsword")?.kit).toContain("Baneblade");
    expect(hullSizeFor("Land Raider Redeemer")?.kit).toContain("Land Raider");
    expect(hullSizeFor("Intercessor Squad")).toBeUndefined();
  });

  it("keeps kits with a shared word apart", () => {
    expect(hullSizeFor("Hydra")?.kit).toBe("Hydra");
    expect(hullSizeFor("Hydra Platform")?.kit).toBe("Hydra Platform");
    expect(hullSizeFor("Manticore")?.kit).toBe("Manticore");
    expect(hullSizeFor("Manticore Platform")?.kit).toBe("Manticore Platform");
    expect(hullSizeFor("Taurox Prime")?.kit).toContain("Taurox");
    expect(hullSizeFor("Tauros Venator")?.kit).toContain("Tauros");
    expect(hullSizeFor("Triarch Stalker")?.kit).toBe("Triarch Stalker");
    expect(hullSizeFor("Stalker")?.kit).toContain("Stalker");
    expect(hullSizeFor("Bastion")?.kit).toContain("Bastion");
    expect(hullSizeFor("Big'ed Bossbunka")?.kit).toContain("Bossbunka");
  });

  it("does not tie a character, a squad or another faction's kit to a tank that shares its name", () => {
    expect(hullSizeFor("Imotekh The Stormlord")).toBeUndefined();
    expect(hullSizeFor("Stormlord")?.kit).toContain("Baneblade");
    expect(hullSizeFor("Triarch Praetorians")).toBeUndefined();
    expect(hullSizeFor("Vertus Praetors")).toBeUndefined();
    expect(hullSizeFor("Cerastus Knight Castigator")).toBeUndefined();
    expect(hullSizeFor("Dreadclaw Drop Pod")).toBeUndefined();
    expect(hullSizeFor("Medusa Carriage Battery")?.kit).toContain("Carriage");
    expect(hullSizeFor("Armageddon-pattern Medusa")?.kit).toContain("Medusa, Colossus");
  });

  it("ties a model to its own profile's kit before its datasheet's", () => {
    expect(hullSizeOfModel("Bike Squad", "ATTACK BIKE")?.kit).toBe("Attack Bike");
    expect(hullSizeOfModel("Outrider Squad", "INVADER ATV")?.kit).toBe("Invader ATV");
    expect(hullSizeOfModel("Bike Squad", "Space Marine Biker")).toBeUndefined();
    expect(hullSizeOfModel("Leman Russ Demolisher", "Leman Russ Demolisher")?.length).toBe(120);
  });

  it("holds sane sizes: every row has positive millimetres, a round row is as long as it is wide, and heights are under a metre", () => {
    for (const row of HULL_SIZES) {
      expect(row.length).toBeGreaterThan(0);
      expect(row.width).toBeGreaterThan(0);
      expect(row.height).toBeGreaterThan(0);
      expect(row.height).toBeLessThan(1000);
      if (row.round) expect(row.length).toBe(row.width);
      expect(row.source.length).toBeGreaterThan(0);
    }
  });
});
