import { describe, expect, it } from "vitest";
import type { Datasheet, Roster, RosterUnit } from "@grimstat/schema";
import { loadSyntheticSnapshot } from "@grimstat/snapshot";
import { canEmbark, carriesPassengers, loadsByTransport, transportCandidates, transportOf, withoutDanglingTransports } from "./transport";

const snapshot = loadSyntheticSnapshot();
const sheets = new Map(snapshot.data.datasheets.map((d) => [d.id, d] as const));

/** A datasheet that carries, and one that does not, without inventing a real one. */
const carrier: Datasheet = { ...sheets.get("ds:ashen-wardens:ashen-crusher")!, id: "ds:carrier", name: "Carrier", transportCapacity: "This model has a transport capacity of 10 ASHEN WARDENS INFANTRY models." };
const walker: Datasheet = { ...sheets.get("ds:ashen-wardens:warden-squad")!, id: "ds:walker", name: "Walkers" };
const all = new Map<string, Datasheet>([...sheets, [carrier.id, carrier], [walker.id, walker]]);

const unit = (id: string, datasheetId: string, over: Partial<RosterUnit> = {}): RosterUnit => ({ id, datasheetId, models: [{ modelProfileId: "mp", count: 5, wargear: [] }], isWarlord: false, ...over });

const now = new Date().toISOString();
const roster = (units: RosterUnit[]): Roster => ({
  id: "r", ownerId: "local", createdAt: now, updatedAt: now, revision: 0, name: "t",
  gameSystemId: snapshot.gameSystemId, snapshotId: snapshot.id, factionId: "faction:ashen-wardens",
  battleSize: "incursion", pointsLimit: 1000, detachments: [], units,
});

describe("what a datasheet can carry", () => {
  it("asks the rules, not the section the sheet is filed under", () => {
    expect(carriesPassengers(carrier)).toBe(true);
    expect(carriesPassengers(walker)).toBe(false);
    expect(carriesPassengers(undefined)).toBe(false);
  });
});

describe("who is riding in what", () => {
  it("groups passengers under their transport, in roster order", () => {
    const r = roster([unit("t1", carrier.id), unit("a", walker.id, { embarkedIn: "t1" }), unit("b", walker.id, { embarkedIn: "t1" })]);
    expect(loadsByTransport(r).get("t1")?.map((u) => u.id)).toEqual(["a", "b"]);
    expect(transportOf(r.units[1]!, r)?.id).toBe("t1");
  });

  it("ignores a reference to a unit that is not in the army, or to itself", () => {
    const r = roster([unit("a", walker.id, { embarkedIn: "ghost" }), unit("b", walker.id, { embarkedIn: "b" })]);
    expect(loadsByTransport(r).size).toBe(0);
    expect(transportOf(r.units[0]!, r)).toBeUndefined();
  });

  /** An attached character travels with the unit it leads, so the host is aboard and it is not. */
  it("leaves an attached character out, since it rides with its host", () => {
    const r = roster([
      unit("t1", carrier.id),
      unit("squad", walker.id, { embarkedIn: "t1" }),
      unit("cpt", walker.id, { embarkedIn: "t1", attachedTo: { unitId: "squad", role: "leader" } }),
    ]);
    expect(loadsByTransport(r).get("t1")?.map((u) => u.id)).toEqual(["squad"]);
    expect(transportOf(r.units[2]!, r)).toBeUndefined();
  });
});

describe("choosing a ride", () => {
  it("offers every transport in the army except the unit itself", () => {
    const r = roster([unit("t1", carrier.id), unit("t2", carrier.id), unit("squad", walker.id)]);
    expect(transportCandidates(r.units[2]!, r, all).map((u) => u.id)).toEqual(["t1", "t2"]);
    expect(transportCandidates(r.units[0]!, r, all).map((u) => u.id)).toEqual(["t2"]);
  });

  it("offers nothing to a character that is attached to another unit", () => {
    const r = roster([unit("t1", carrier.id), unit("squad", walker.id), unit("cpt", walker.id, { attachedTo: { unitId: "squad", role: "leader" } })]);
    expect(transportCandidates(r.units[2]!, r, all)).toEqual([]);
    expect(canEmbark(r.units[2]!, all)).toBe(false);
  });

  it("does not offer to put a transport inside something", () => {
    expect(canEmbark(unit("t1", carrier.id), all)).toBe(false);
    expect(canEmbark(unit("squad", walker.id), all)).toBe(true);
  });
});

describe("clearing a ride that no longer exists", () => {
  it("drops a reference to a removed transport and leaves the rest alone", () => {
    const units = [unit("squad", walker.id, { embarkedIn: "gone" }), unit("other", walker.id, { embarkedIn: "squad" })];
    const out = withoutDanglingTransports(units);
    expect(out[0]!.embarkedIn).toBeUndefined();
    expect(out[1]!.embarkedIn).toBe("squad");
    // The surviving unit is the same object, so a list with nothing dangling costs nothing.
    expect(out[1]).toBe(units[1]);
  });
});
