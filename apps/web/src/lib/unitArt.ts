/**
 * A picture for a unit, chosen by what it is and, for foot troops, whose it is.
 *
 * This app ships no Games Workshop artwork, so no unit can have *its* picture. What every unit has
 * is keywords, and the keywords say what kind of thing stands on the table: a trooper, a tank, a
 * walker, a monster, a swarm. One generic silhouette per class is honest, legally clean, and enough
 * to tell a list apart at a glance.
 *
 * Infantry is the one class that says too little on its own, because on most tables most things
 * are infantry. So a plain infantry unit takes its faction's picture instead: an orc head, a
 * scarab, an elf helm. These are generic fantasy and sci-fi motifs, one per faction, chosen to
 * stay readable at the 18 px the app draws them. Characters keep the character picture, so a leader
 * can still be told from the squad it leads, and every other class keeps its own. Factions with no
 * foot troops, such as the Knight houses, fall through to the class.
 *
 * The pictures are from game-icons.net under CC BY 3.0, vendored as path data by
 * `apps/web/scripts/unit-art.ts`; the authors are credited on the About page. The class rule also
 * chooses the model's shape on the battle table (`silhouettes.ts`), so the two always agree.
 */

import { UNIT_ART_PATHS } from "./unitArtPaths";

/** What a unit is. Every class has a picture and a figure on the table. */
export type UnitClassId = "infantry" | "character" | "vehicle" | "transport" | "walker" | "monster" | "beast" | "swarm" | "aircraft" | "bike" | "mounted" | "titanic" | "fortification";

/** Whose a unit is. Only factions that field infantry have one. */
export type UnitFactionId =
  | "space-marines"
  | "astra-militarum"
  | "adepta-sororitas"
  | "adeptus-custodes"
  | "adeptus-mechanicus"
  | "grey-knights"
  | "imperial-agents"
  | "chaos-space-marines"
  | "death-guard"
  | "thousand-sons"
  | "world-eaters"
  | "emperors-children"
  | "chaos-daemons"
  | "aeldari"
  | "drukhari"
  | "genestealer-cults"
  | "leagues-of-votann"
  | "necrons"
  | "orks"
  | "tau-empire"
  | "tyranids";

export type UnitArtId = UnitClassId | UnitFactionId;

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

export const UNIT_CLASS_CREDITS: Readonly<Record<UnitClassId, UnitArtCredit>> = {
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

export const UNIT_FACTION_CREDITS: Readonly<Record<UnitFactionId, UnitArtCredit>> = {
  "space-marines": { icon: "Visored helm", author: "Lorc", slug: "lorc/visored-helm" },
  "astra-militarum": { icon: "Brodie helmet", author: "Skoll", slug: "skoll/brodie-helmet" },
  "adepta-sororitas": { icon: "Candle flame", author: "Lorc", slug: "lorc/candle-flame" },
  "adeptus-custodes": { icon: "Warlord helmet", author: "Caro Asercion", slug: "caro-asercion/warlord-helmet" },
  "adeptus-mechanicus": { icon: "Cog", author: "Lorc", slug: "lorc/cog" },
  "grey-knights": { icon: "Templar shield", author: "Delapouite", slug: "delapouite/templar-shield" },
  "imperial-agents": { icon: "Hood", author: "Lorc", slug: "lorc/hood" },
  "chaos-space-marines": { icon: "Spiked halo", author: "Lorc", slug: "lorc/spiked-halo" },
  "death-guard": { icon: "Plague doctor profile", author: "Delapouite", slug: "delapouite/plague-doctor-profile" },
  "thousand-sons": { icon: "Ankh", author: "Lorc", slug: "lorc/ankh" },
  "world-eaters": { icon: "Battle axe", author: "Lorc", slug: "lorc/battle-axe" },
  "emperors-children": { icon: "Lyre", author: "Lorc", slug: "lorc/lyre" },
  "chaos-daemons": { icon: "Daemon skull", author: "Lorc", slug: "lorc/daemon-skull" },
  aeldari: { icon: "Elf helmet", author: "Kier Heyl", slug: "kier-heyl/elf-helmet" },
  drukhari: { icon: "Barbed star", author: "Lorc", slug: "lorc/barbed-star" },
  "genestealer-cults": { icon: "Alien stare", author: "Lorc", slug: "lorc/alien-stare" },
  "leagues-of-votann": { icon: "Dwarf helmet", author: "Kier Heyl", slug: "kier-heyl/dwarf-helmet" },
  necrons: { icon: "Scarab beetle", author: "Lorc", slug: "lorc/scarab-beetle" },
  orks: { icon: "Orc head", author: "Delapouite", slug: "delapouite/orc-head" },
  "tau-empire": { icon: "Ray gun", author: "Lorc", slug: "lorc/ray-gun" },
  tyranids: { icon: "Alien bug", author: "Delapouite", slug: "delapouite/alien-bug" },
};

export const UNIT_ART_CREDITS: Readonly<Record<UnitArtId, UnitArtCredit>> = { ...UNIT_CLASS_CREDITS, ...UNIT_FACTION_CREDITS };

export const UNIT_CLASS_IDS = Object.keys(UNIT_CLASS_CREDITS) as readonly UnitClassId[];
export const UNIT_FACTION_IDS = Object.keys(UNIT_FACTION_CREDITS) as readonly UnitFactionId[];
export const UNIT_ART_IDS: readonly UnitArtId[] = [...UNIT_CLASS_IDS, ...UNIT_FACTION_IDS];

/**
 * Which class a unit is, from its keywords.
 *
 * Most specific first: a TITANIC VEHICLE is a titan before it is a vehicle, a WALKER is a mech
 * before it is a vehicle, a transport is a transport before it is a tank, and a CHARACTER on a BIKE
 * is a bike. INFANTRY is the default because, on most tables, most things are.
 */
export function unitClassFor(keywords: readonly string[]): UnitClassId {
  const have = new Set(keywords.map(normalise));
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

/**
 * Faction keyword → faction picture, most specific first: a Death Guard sheet is Death Guard before
 * it is Heretic Astartes, a daemon of any legion is a daemon, a chapter is a Space Marine, and the
 * Aeldari craftworlds, masques and reborn share one picture while the Drukhari have their own.
 */
const FACTION_BY_KEYWORD: readonly (readonly [UnitFactionId, readonly string[]])[] = [
  ["death-guard", ["DEATH GUARD"]],
  ["thousand-sons", ["THOUSAND SONS"]],
  ["world-eaters", ["WORLD EATERS"]],
  ["emperors-children", ["EMPERORS CHILDREN"]],
  ["chaos-daemons", ["LEGIONES DAEMONICA", "PLAGUE LEGIONS", "BLOOD LEGIONS", "LEGIONS OF EXCESS", "SCINTILLATING LEGIONS", "CHAOS DAEMONS"]],
  ["chaos-space-marines", ["HERETIC ASTARTES", "CHAOS SPACE MARINES"]],
  ["grey-knights", ["GREY KNIGHTS"]],
  ["adeptus-custodes", ["ADEPTUS CUSTODES"]],
  ["adepta-sororitas", ["ADEPTA SORORITAS"]],
  ["adeptus-mechanicus", ["ADEPTUS MECHANICUS"]],
  ["astra-militarum", ["ASTRA MILITARUM"]],
  ["imperial-agents", ["AGENTS OF THE IMPERIUM", "IMPERIAL AGENTS"]],
  ["space-marines", ["ADEPTUS ASTARTES", "SPACE MARINES"]],
  ["drukhari", ["DRUKHARI"]],
  ["aeldari", ["ASURYANI", "HARLEQUINS", "YNNARI", "AELDARI"]],
  ["genestealer-cults", ["GENESTEALER CULTS"]],
  ["tyranids", ["TYRANIDS"]],
  ["necrons", ["NECRONS"]],
  ["orks", ["ORKS"]],
  ["tau-empire", ["TAU EMPIRE"]],
  ["leagues-of-votann", ["LEAGUES OF VOTANN"]],
];

/** Whose a unit is, from its faction keywords; `undefined` for a faction with no picture. */
export function unitFactionFor(factionKeywords: readonly string[]): UnitFactionId | undefined {
  const have = new Set(factionKeywords.map(normalise));
  return FACTION_BY_KEYWORD.find(([, ks]) => ks.some((k) => have.has(k)))?.[0];
}

/** Which picture stands for a unit: its faction's for plain infantry, its class's for everything else. */
export function unitArtFor(keywords: readonly string[], factionKeywords: readonly string[] = []): UnitArtId {
  const cls = unitClassFor(keywords);
  return (cls === "infantry" && unitFactionFor(factionKeywords)) || cls;
}

/** Upper case, trimmed, apostrophes dropped: the data writes T’AU with a curly one. */
const normalise = (k: string): string => k.replace(/[’']/g, "").trim().toUpperCase();

/** The picture's path data, on a 512 × 512 canvas. Empty until the art has been vendored. */
export const unitArtPath = (id: UnitArtId): string => UNIT_ART_PATHS[id] ?? "";

/** Every author with a picture in use, once each, for the credit line. */
export function unitArtAuthors(): string[] {
  return [...new Set(UNIT_ART_IDS.map((id) => UNIT_ART_CREDITS[id].author))];
}
