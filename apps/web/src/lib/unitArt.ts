/**
 * A picture for a unit, chosen by what it is rather than who it is.
 *
 * This app ships no Games Workshop artwork, so no unit can have *its* picture. What every unit has
 * is keywords, and the keywords say what kind of thing stands on the table: a trooper, a tank, a
 * walker, a monster, a swarm. One generic silhouette per kind is honest, legally clean, and enough
 * to tell a list apart at a glance.
 *
 * The silhouettes are from game-icons.net under CC BY 3.0, vendored as path data by
 * `apps/web/scripts/unit-art.ts`; the authors are credited on the About page. The same rule
 * chooses the model's shape on the battle table (`silhouettes.ts`), so the two always agree.
 */

import { UNIT_ART_PATHS } from "./unitArtPaths";

export type UnitArtId = "infantry" | "character" | "vehicle" | "transport" | "walker" | "monster" | "beast" | "swarm" | "aircraft" | "bike" | "mounted" | "titanic" | "fortification";

export interface UnitArtCredit {
  /** The icon's name on game-icons.net. */
  readonly icon: string;
  readonly author: string;
  /** `author/icon` as the site addresses it. */
  readonly slug: string;
}

export const UNIT_ART_SOURCE = {
  name: "game-icons.net",
  url: "https://game-icons.net",
  licence: "CC BY 3.0",
  licenceUrl: "https://creativecommons.org/licenses/by/3.0/",
} as const;

export const UNIT_ART_CREDITS: Readonly<Record<UnitArtId, UnitArtCredit>> = {
  infantry: { icon: "Visored helm", author: "Lorc", slug: "lorc/visored-helm" },
  character: { icon: "Crested helmet", author: "Lorc", slug: "lorc/crested-helmet" },
  vehicle: { icon: "Battle tank", author: "Lorc", slug: "lorc/battle-tank" },
  transport: { icon: "APC", author: "Skoll", slug: "skoll/apc" },
  walker: { icon: "Battle mech", author: "Delapouite", slug: "delapouite/battle-mech" },
  monster: { icon: "Dinosaur rex", author: "Lorc", slug: "lorc/dinosaur-rex" },
  beast: { icon: "Wolf head", author: "Lorc", slug: "lorc/wolf-head" },
  swarm: { icon: "Ants", author: "Delapouite", slug: "delapouite/ants" },
  aircraft: { icon: "Jet fighter", author: "Delapouite", slug: "delapouite/jet-fighter" },
  bike: { icon: "Aero bike", author: "Delapouite", slug: "delapouite/aero-bike" },
  mounted: { icon: "Cavalry", author: "Delapouite", slug: "delapouite/cavalry" },
  titanic: { icon: "Megabot", author: "Lorc", slug: "lorc/megabot" },
  fortification: { icon: "Bunker", author: "Quoting", slug: "quoting/bunker" },
};

export const UNIT_ART_IDS = Object.keys(UNIT_ART_CREDITS) as readonly UnitArtId[];

/**
 * Which picture stands for a unit, from its keywords.
 *
 * Most specific first: a TITANIC VEHICLE is a titan before it is a vehicle, a WALKER is a mech
 * before it is a vehicle, a transport is a transport before it is a tank, and a CHARACTER on a BIKE
 * is a bike. INFANTRY is the default because, on most tables, most things are.
 */
export function unitArtFor(keywords: readonly string[]): UnitArtId {
  const have = new Set(keywords.map((k) => k.trim().toUpperCase()));
  const any = (...ks: string[]) => ks.some((k) => have.has(k));
  if (any("FORTIFICATION")) return "fortification";
  if (any("TITANIC")) return "titanic";
  if (any("AIRCRAFT")) return "aircraft";
  if (any("WALKER")) return "walker";
  if (any("TRANSPORT", "DEDICATED TRANSPORT")) return "transport";
  if (any("VEHICLE")) return "vehicle";
  if (any("MONSTER")) return "monster";
  if (any("BIKE", "BIKES")) return "bike";
  if (any("MOUNTED", "CAVALRY")) return "mounted";
  if (any("SWARM")) return "swarm";
  if (any("BEAST", "BEASTS")) return "beast";
  if (any("CHARACTER")) return "character";
  return "infantry";
}

/** The silhouette's path data, on a 512 × 512 canvas. Empty until the art has been vendored. */
export const unitArtPath = (id: UnitArtId): string => UNIT_ART_PATHS[id] ?? "";

/** Every author with a picture in use, once each, for the credit line. */
export function unitArtAuthors(): string[] {
  return [...new Set(UNIT_ART_IDS.map((id) => UNIT_ART_CREDITS[id].author))];
}
