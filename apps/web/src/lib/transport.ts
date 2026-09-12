/**
 * Who is riding in what.
 *
 * A unit can start the battle inside a TRANSPORT, which the roster records as `embarkedIn` on the
 * passenger. The rules for it are thorough — capacity, keyword restrictions, models that take two
 * slots, characters riding with the unit they lead, reserves inherited from the transport — and all
 * of them live in the 11th-edition plugin, which reports what a transport is carrying as a
 * diagnostic. None of that was reachable: `embarkedIn` appeared nowhere in the app, so a list
 * imported with a squad in its Rhino showed the squad and the Rhino as two unrelated entries, and
 * there was no way to put one inside the other.
 *
 * These say only who is where. Every question with a rule behind it — does it fit, is it allowed,
 * how full is it — stays with the plugin, so there is one answer to each and it is the plugin's.
 */

import type { Datasheet, Roster, RosterUnit } from "@grimstat/schema";
import { parseTransportCapacity } from "@grimstat/game-40k-11e";

/**
 * Whether a datasheet can carry anything: it prints a transport capacity the plugin can read.
 *
 * Not to be confused with `isTransportSheet` in `roster.ts`, which asks whether a sheet is filed
 * under Dedicated Transports. That one sorts the list; this one is the rules question, and the two
 * do not always agree — a battle tank with a compartment carries models without being a dedicated
 * transport, and a dedicated transport whose capacity prose the parser cannot read carries nothing
 * it can check.
 */
export const carriesPassengers = (ds: Datasheet | undefined): boolean => !!ds && !!parseTransportCapacity(ds.transportCapacity);

/** Passengers of each transport, by the transport's roster-unit id, in roster order. */
export function loadsByTransport(roster: Roster): Map<string, RosterUnit[]> {
  const byId = new Map(roster.units.map((u) => [u.id, u] as const));
  const out = new Map<string, RosterUnit[]>();
  for (const u of roster.units) {
    const id = u.embarkedIn;
    // A unit attached to another travels with its host, so it is the host that is aboard, not it.
    if (!id || id === u.id || u.attachedTo || !byId.has(id)) continue;
    out.set(id, [...(out.get(id) ?? []), u]);
  }
  return out;
}

/** The transport a unit starts inside, or nothing. */
export function transportOf(unit: RosterUnit, roster: Roster): RosterUnit | undefined {
  if (!unit.embarkedIn || unit.attachedTo) return undefined;
  return roster.units.find((u) => u.id === unit.embarkedIn && u.id !== unit.id);
}

/**
 * Transports a unit could be put into: every transport in the army except itself.
 *
 * Deliberately unfiltered by capacity and keywords. The plugin already says, in words and against
 * the printed rule, that a Rhino cannot carry Terminators or that it is two models over — and it
 * says it about the list the player actually built. Hiding the option instead would replace that
 * explanation with a transport that is mysteriously missing from a menu.
 */
export function transportCandidates(unit: RosterUnit, roster: Roster, datasheets: Map<string, Datasheet>): RosterUnit[] {
  if (unit.attachedTo) return [];
  return roster.units.filter((u) => u.id !== unit.id && carriesPassengers(datasheets.get(u.datasheetId)));
}

/** Whether this unit is one that could ever be put in a transport: not a transport, not attached. */
export function canEmbark(unit: RosterUnit, datasheets: Map<string, Datasheet>): boolean {
  return !unit.attachedTo && !carriesPassengers(datasheets.get(unit.datasheetId));
}

/**
 * `embarkedIn` pointing at a unit that is no longer in the army.
 *
 * Removing a transport leaves its passengers pointing at nothing. The plugin reports that as an
 * error, which is honest but not useful — the player did not do anything wrong, the reference simply
 * outlived its target — so the editor clears it instead.
 */
export function withoutDanglingTransports(units: readonly RosterUnit[]): RosterUnit[] {
  const ids = new Set(units.map((u) => u.id));
  return units.map((u) => {
    if (!u.embarkedIn || ids.has(u.embarkedIn)) return u;
    const { embarkedIn: _gone, ...rest } = u;
    return rest;
  });
}
