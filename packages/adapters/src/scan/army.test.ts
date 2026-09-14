import { describe, expect, it } from "vitest";
import { loadSyntheticSnapshot } from "@grimstat/snapshot";
import { anchor } from "./anchors";
import { detachmentsFrom, idsInFaction, readArmy, sizeFor, voteFaction } from "./army";
import { scanIndexOf } from "./names";
import { tokenise } from "./tokens";

const snapshot = loadSyntheticSnapshot();
const index = scanIndexOf(snapshot);
const WARDENS = "faction:ashen-wardens";
const spansOf = (text: string) => anchor(tokenise(text), index);

describe("voteFaction", () => {
  it("picks the faction most of the units belong to", () => {
    const vote = voteFaction(snapshot, spansOf("Warden Squad\nWarden Captain\nAshen Crusher\nThornlings"));
    expect(vote.factionId).toBe(WARDENS);
    expect(vote.tied).toBe(false);
    expect(vote.votes.map((v) => [v.name, v.units])).toEqual([["Ashen Wardens", 3], ["Verdant Swarm", 1]]);
  });

  /* The overlay's list is Imperial Knights with three units from elsewhere in it, and the vote has
     to get that right without being told. This is the same shape in the synthetic vocabulary. */
  it("picks the host faction of a list holding allies", () => {
    const vote = voteFaction(snapshot, spansOf(["Warden Squad", "Warden Squad", "Warden Captain", "Ashen Crusher", "Thornlings", "Spine Drake"].join("\n")));
    expect(vote.factionId).toBe(WARDENS);
    expect(vote.votes[0]?.units).toBe(4);
    expect(vote.votes[1]?.units).toBe(2);
  });

  it("calls a close vote a tie rather than guessing", () => {
    const vote = voteFaction(snapshot, spansOf("Warden Squad\nWarden Captain\nThornlings\nSpine Drake"));
    expect(vote.tied).toBe(true);
    expect(vote.factionId).toBeUndefined();
    expect(vote.votes).toHaveLength(2);
  });

  it("has no opinion about a list holding no units", () => {
    expect(voteFaction(snapshot, spansOf("by Travis Knights, 3-0 at OP RTT"))).toMatchObject({ factionId: undefined, tied: false, votes: [] });
  });
});

describe("detachmentsFrom", () => {
  it("recovers the detachment from an enhancement alone", () => {
    // The detachment is never named; only the enhancement it offers is.
    const { detachmentIds } = detachmentsFrom(snapshot, spansOf("Warden Captain - Ember Blade"), WARDENS);
    expect(detachmentIds).toEqual(["det:ashen-wardens:ember-vanguard"]);
  });

  it("takes a detachment that was named outright", () => {
    expect(detachmentsFrom(snapshot, spansOf("Ember Vanguard"), WARDENS).detachmentIds).toEqual(["det:ashen-wardens:ember-vanguard"]);
  });

  it("reads the force disposition and the detachment that offers it", () => {
    const out = detachmentsFrom(snapshot, spansOf("HOLD THE RIDGE"), WARDENS);
    expect(out.forceDisposition).toBe("HOLD THE RIDGE");
    expect(out.detachmentIds).toEqual(["det:ashen-wardens:ember-vanguard"]);
  });

  it("keeps the disposition but drops a detachment from another faction", () => {
    const out = detachmentsFrom(snapshot, spansOf("SEIZE THE GROVE"), WARDENS);
    expect(out.forceDisposition).toBe("SEIZE THE GROVE");
    expect(out.detachmentIds).toEqual([]);
  });

  it("names each detachment once when the list writes it twice", () => {
    expect(detachmentsFrom(snapshot, spansOf("Ember Vanguard\nWarden Captain - Ember Blade"), WARDENS).detachmentIds).toEqual(["det:ashen-wardens:ember-vanguard"]);
  });
});

describe("idsInFaction", () => {
  it("gathers the datasheets, detachments and enhancements of one faction", () => {
    const ids = idsInFaction(snapshot, WARDENS);
    expect(ids.has("ds:ashen-wardens:warden-squad")).toBe(true);
    expect(ids.has("det:ashen-wardens:ember-vanguard")).toBe(true);
    expect(ids.has("enh:ashen-wardens:ember-blade")).toBe(true);
    expect(ids.has("ds:verdant-swarm:thornlings")).toBe(false);
    expect(idsInFaction(snapshot, undefined).size).toBe(0);
  });
});

describe("sizeFor", () => {
  it("takes the smallest standard size the total fits inside", () => {
    expect(sizeFor(480)).toEqual({ battleSize: "combat-patrol", pointsLimit: 500 });
    expect(sizeFor(1000)).toEqual({ battleSize: "incursion", pointsLimit: 1000 });
    expect(sizeFor(1985)).toEqual({ battleSize: "strike-force", pointsLimit: 2000 });
    expect(sizeFor(2400)).toEqual({ battleSize: "onslaught", pointsLimit: 3000 });
  });
});

describe("readArmy", () => {
  it("reads the units, the faction and the detachment out of a bulleted list", () => {
    const list = ["Ember Vanguard - HOLD THE RIDGE", "Characters", "Warden Captain - Relic blade (Ember Blade)", "Squads", "2 x 5 Warden Squad", "Vehicles", "Ashen Crusher"].join("\n");
    const { army, spans } = readArmy(snapshot, tokenise(list));
    expect(army.factionId).toBe(WARDENS);
    expect(army.detachmentIds).toEqual(["det:ashen-wardens:ember-vanguard"]);
    expect(army.forceDisposition).toBe("HOLD THE RIDGE");
    expect(spans.filter((s) => s.entry.kind === "datasheet")).toHaveLength(3);
  });

  it("reads the same army out of a stream whose columns were interleaved", () => {
    const written = ["Warden Captain 80", "Relic blade", "Warden Squad 90", "Flux carbine", "Ashen Crusher 150", "Fusion beamer", "Thornlings 60"].join("\n");
    const read = ["Thornlings 60", "Warden Captain 80", "Fusion beamer", "Relic blade", "Ashen Crusher 150", "Flux carbine", "Warden Squad 90"].join("\n");
    const a = readArmy(snapshot, tokenise(written));
    const b = readArmy(snapshot, tokenise(read));
    expect(b.army.factionId).toBe(a.army.factionId);
    expect(b.spans.map((s) => s.entry.name).sort()).toEqual(a.spans.map((s) => s.entry.name).sort());
  });

  it("leaves the faction open when the units do not agree", () => {
    const { army } = readArmy(snapshot, tokenise("Warden Squad\nThornlings"));
    expect(army.factionId).toBeUndefined();
    expect(army.tied).toBe(true);
  });
});
