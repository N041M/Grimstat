import type { Datasheet, Diagnostic, RosterUnit } from "@grimstat/schema";
import type { RosterContext } from "@grimstat/resolver";
import { companionHostOf, factionKeywordsOf, isOwnFaction } from "@grimstat/resolver";

/**
 * Which units from another faction an army may include, from the 11th-edition faction rules.
 *
 * Every faction rule with an allies clause is written out here with its limits. A unit from another
 * faction that no clause admits is reported as a warning rather than an error, since a faction rule
 * the app does not carry is a gap in the app before it is a fault in the list.
 *
 * Sources, as published on the faction pages:
 * - Agents of the Imperium, "Assigned Agents": an army whose every model has IMPERIUM may include
 *   Agents units, up to a number of RETINUE, CHARACTER and REQUISITIONED units set by the battle
 *   size. Their Dedicated Transports come as normal but must start with a unit embarked.
 * - Imperial Knights, "Freeblades": an army whose every model has IMPERIUM may include one TITANIC
 *   Imperial Knights model or up to three ARMIGER models. None may be the Warlord or take an
 *   Enhancement.
 * - Chaos Knights, "Dreadblades": the same for CHAOS armies, with one TITANIC model or up to three
 *   WAR DOG models.
 * - Chaos Daemons, "Daemonic Pact": an army whose every model has CHAOS KNIGHTS or HERETIC ASTARTES
 *   may include LEGIONES DAEMONICA units up to a points cost set by the battle size. None may be the
 *   Warlord or take an Enhancement, and for each god the non-Battleline units may not outnumber
 *   the Battleline ones.
 * - Genestealer Cults, "Brood Brothers" (Brood Brother Auxilia detachment): Astra Militarum units
 *   up to a points cost set by the battle size, with a list of banned keywords, and a Genestealer
 *   Cults Warlord.
 * - Imperial Knights, "Questor Forgepact" detachment: named Adeptus Mechanicus units up to 500 points.
 * - Chaos Knights, "Wretched Thralls" detachment: DAMNED units up to 500 points.
 * - Space Marines, Chapters: a unit's Chapter is its second Faction keyword, an army holds one
 *   Chapter, and Black Templars, Space Wolves and Deathwatch armies each leave out named units.
 */

type SizeKey = "incursion" | "strike-force" | "onslaught";

const AGENT_LIMITS: Record<SizeKey, { retinue: number; character: number; requisitioned: number }> = {
  incursion: { retinue: 1, character: 1, requisitioned: 1 },
  "strike-force": { retinue: 2, character: 2, requisitioned: 1 },
  onslaught: { retinue: 3, character: 3, requisitioned: 2 },
};
const DAEMON_POINTS: Record<SizeKey, number> = { incursion: 250, "strike-force": 500, onslaught: 750 };
const BROOD_POINTS: Record<SizeKey, number> = { incursion: 500, "strike-force": 1000, onslaught: 1500 };
const FORGEPACT_POINTS = 500;
const THRALLS_POINTS = 500;
const GODS = ["KHORNE", "TZEENTCH", "NURGLE", "SLAANESH"];
const BROOD_BANNED = ["AIRCRAFT", "COMMISSAR", "EPIC HERO", "MILITARUM TEMPESTUS", "OGRYN", "RATLING", "TECH-PRIEST ENGINSEER", "MINISTORUM PRIEST"];
const FORGEPACT_ALLOWED = ["TECH-PRIEST DOMINUS", "TECH-PRIEST MANIPULUS", "MARSHAL", "RANGERS", "VANGUARD"];
const TEMPLAR_VEHICLES = ["GLADIATOR LANCER", "GLADIATOR REAPER", "GLADIATOR VALIANT", "IMPULSOR", "REPULSOR", "REPULSOR EXECUTIONER"];
const WOLVES_BANNED = ["APOTHECARY", "DEVASTATOR SQUAD", "TACTICAL SQUAD"];
const DEATHWATCH_BANNED = ["ASSAULT SQUAD", "ASSAULT SQUAD WITH JUMP PACKS", "ATTACK BIKE SQUAD", "DEVASTATOR SQUAD", "LAND SPEEDER STORM", "RELIC TERMINATOR SQUAD", "SCOUT BIKE SQUAD", "SCOUT SQUAD", "SCOUT SNIPER SQUAD", "TACTICAL SQUAD", "TERMINATOR ASSAULT SQUAD", "TERMINATOR SQUAD"];
/** Faction keywords that name a family rather than a Chapter. */
const NOT_A_CHAPTER = new Set(["ADEPTUS ASTARTES", "AGENTS OF THE IMPERIUM"]);

const clean = (k: string): string => k.trim().toUpperCase();
const hasKeyword = (ds: Datasheet, k: string): boolean => ds.keywords.some((x) => clean(x) === k);
const hasFactionKeyword = (ds: Datasheet, k: string): boolean => ds.factionKeywords.some((x) => clean(x) === k);
const hasAnyKeyword = (ds: Datasheet, k: string): boolean => hasKeyword(ds, k) || hasFactionKeyword(ds, k);
const titleCase = (k: string): string => k.toLowerCase().replace(/(^|[\s-])([a-z])/g, (m, sep: string, c: string) => `${sep}${c.toUpperCase()}`);

/** Which row of a battle-size table applies. Combat Patrol reads the Incursion row; a custom size goes by its points. */
function sizeKey(ctx: RosterContext): SizeKey {
  const size = ctx.roster.battleSize;
  if (size === "incursion" || size === "strike-force" || size === "onslaught") return size;
  if (size === "combat-patrol") return "incursion";
  return ctx.roster.pointsLimit <= 1000 ? "incursion" : ctx.roster.pointsLimit <= 2000 ? "strike-force" : "onslaught";
}

const SIZE_NAME: Record<SizeKey, string> = { incursion: "Incursion", "strike-force": "Strike Force", onslaught: "Onslaught" };

interface Entry {
  unit: RosterUnit;
  ds: Datasheet;
}

export function checkAllies(ctx: RosterContext): Diagnostic[] {
  const out: Diagnostic[] = [];
  const { roster, snapshot } = ctx;
  const name = (u: RosterUnit) => u.customName ?? ctx.datasheet(u.datasheetId)?.name ?? u.datasheetId;
  const path = (u: RosterUnit) => `/units/${roster.units.indexOf(u)}`;
  const error = (u: RosterUnit, code: string, message: string, fix?: string) => out.push({ severity: "error", code, message, path: path(u), ...(fix ? { fix } : {}) });
  const factionName = (id: string) => snapshot.data.factions.find((f) => f.id === id)?.name ?? id;
  const army = factionName(roster.factionId);

  const known: Entry[] = [];
  for (const unit of roster.units) {
    const ds = ctx.datasheet(unit.datasheetId);
    if (ds) known.push({ unit, ds });
  }
  const core = factionKeywordsOf(snapshot, roster.factionId);
  const own = known.filter((e) => isOwnFaction(e.ds, roster, snapshot));
  const allies = known.filter((e) => !isOwnFaction(e.ds, roster, snapshot));
  const everyModel = (k: string) => known.every((e) => hasAnyKeyword(e.ds, k));
  const detachments = roster.detachments.map((d) => (ctx.detachment(d.detachmentId)?.name ?? "").toLowerCase());
  const hasDetachment = (re: RegExp) => detachments.some((n) => re.test(n));
  const size = sizeKey(ctx);
  const points = (list: Entry[]) => list.reduce((s, e) => s + ctx.unitCost(e.unit).total, 0);
  const notWarlordNoEnhancement = (list: Entry[], rule: string) => {
    for (const e of list) {
      if (e.unit.isWarlord) error(e.unit, "allies.warlord", `${name(e.unit)} joins under ${rule} and cannot be the Warlord.`, "Mark a unit of the army's own faction as Warlord.");
      if (e.unit.enhancementId) error(e.unit, "allies.enhancement", `${name(e.unit)} joins under ${rule} and cannot take an Enhancement.`, "Remove the Enhancement.");
    }
  };

  const agents: Entry[] = [];
  const knights: Entry[] = [];
  const dreadblades: Entry[] = [];
  const daemons: Entry[] = [];
  const brood: Entry[] = [];
  const forgepact: Entry[] = [];
  const thralls: Entry[] = [];
  for (const e of allies) {
    if (hasFactionKeyword(e.ds, "AGENTS OF THE IMPERIUM") && !core.has("AGENTS OF THE IMPERIUM")) agents.push(e);
    else if (hasFactionKeyword(e.ds, "IMPERIAL KNIGHTS")) knights.push(e);
    else if (hasFactionKeyword(e.ds, "CHAOS KNIGHTS")) dreadblades.push(e);
    else if (hasFactionKeyword(e.ds, "LEGIONES DAEMONICA")) daemons.push(e);
    else if (hasFactionKeyword(e.ds, "ASTRA MILITARUM") && core.has("GENESTEALER CULTS")) brood.push(e);
    else if (hasFactionKeyword(e.ds, "ADEPTUS MECHANICUS") && core.has("IMPERIAL KNIGHTS")) forgepact.push(e);
    else if (hasKeyword(e.ds, "DAMNED") && core.has("CHAOS KNIGHTS")) thralls.push(e);
    else out.push({ severity: "warn", code: "allies.unknown", message: `${name(e.unit)} is from ${factionName(e.ds.factionId)}. No ally rule the app knows admits it into a ${army} army.`, path: path(e.unit), fix: "Check the faction's allies rule." });
  }

  // ---- Assigned Agents ----
  if (agents.length) {
    if (!everyModel("IMPERIUM")) for (const e of agents) error(e.unit, "allies.agents.imperium", `${name(e.unit)} can only join an army in which every model has the IMPERIUM keyword.`, "Remove the units without IMPERIUM.");
    const limits = AGENT_LIMITS[size];
    const requisitioned = agents.filter((e) => hasKeyword(e.ds, "REQUISITIONED"));
    const retinue = agents.filter((e) => !hasKeyword(e.ds, "REQUISITIONED") && hasKeyword(e.ds, "RETINUE"));
    const characters = agents.filter((e) => !hasKeyword(e.ds, "REQUISITIONED") && !hasKeyword(e.ds, "RETINUE") && hasKeyword(e.ds, "CHARACTER"));
    const transports = agents.filter((e) => hasKeyword(e.ds, "DEDICATED TRANSPORT"));
    const over = (list: Entry[], limit: number, what: string) => {
      for (const e of list.slice(limit)) error(e.unit, "allies.agents.count", `${list.length} Agents of the Imperium ${what} units; ${SIZE_NAME[size]} allows ${limit}.`, `Keep ${limit} at most.`);
    };
    over(retinue, limits.retinue, "RETINUE");
    over(characters, limits.character, "CHARACTER");
    over(requisitioned, limits.requisitioned, "REQUISITIONED");
    for (const e of transports) {
      if (!roster.units.some((u) => u.embarkedIn === e.unit.id)) out.push({ severity: "warn", code: "allies.agents.transport", message: `${name(e.unit)} must start the battle with a unit embarked, or it counts as destroyed.`, path: path(e.unit), fix: "Embark a unit in it." });
    }
  }

  // ---- Freeblades and Dreadblades ----
  const knightHousehold = (list: Entry[], rule: string, family: string, small: string) => {
    if (!list.length) return;
    if (!everyModel(family)) for (const e of list) error(e.unit, "allies.knights.family", `${name(e.unit)} can only join an army in which every model has the ${family} keyword.`, `Remove the units without ${family}.`);
    const titanic = list.filter((e) => hasKeyword(e.ds, "TITANIC"));
    const smalls = list.filter((e) => !hasKeyword(e.ds, "TITANIC") && hasKeyword(e.ds, small));
    const others = list.filter((e) => !hasKeyword(e.ds, "TITANIC") && !hasKeyword(e.ds, small));
    if (titanic.length && smalls.length) for (const e of smalls) error(e.unit, "allies.knights.mix", `${rule} allows one TITANIC model or up to three ${small} models, not both.`, `Keep the TITANIC model or the ${small} models.`);
    for (const e of titanic.slice(1)) error(e.unit, "allies.knights.titanic", `${rule} allows one TITANIC model; the army has ${titanic.length}.`, "Keep one.");
    for (const e of smalls.slice(3)) error(e.unit, "allies.knights.small", `${rule} allows up to three ${small} models; the army has ${smalls.length}.`, "Keep three at most.");
    for (const e of others) error(e.unit, "allies.knights.kind", `${name(e.unit)} is neither TITANIC nor ${small}, so ${rule} does not admit it.`, "Remove the unit.");
    notWarlordNoEnhancement(list, rule);
  };
  knightHousehold(knights, "Freeblades", "IMPERIUM", "ARMIGER");
  knightHousehold(dreadblades, "Dreadblades", "CHAOS", "WAR DOG");

  // ---- Daemonic Pact ----
  if (daemons.length) {
    const mortals = known.filter((e) => !daemons.includes(e));
    if (!mortals.every((e) => hasAnyKeyword(e.ds, "CHAOS KNIGHTS") || hasAnyKeyword(e.ds, "HERETIC ASTARTES"))) {
      for (const e of daemons) error(e.unit, "allies.daemons.family", `${name(e.unit)} can only join an army in which every model has the CHAOS KNIGHTS or HERETIC ASTARTES keyword.`, "Remove the units without either keyword.");
    }
    const spent = points(daemons);
    const limit = DAEMON_POINTS[size];
    if (spent > limit) for (const e of daemons) error(e.unit, "allies.daemons.points", `Legiones Daemonica units cost ${spent} points; Daemonic Pact allows ${limit} at ${SIZE_NAME[size]}.`, "Remove a daemon unit.");
    notWarlordNoEnhancement(daemons, "Daemonic Pact");
    for (const god of GODS) {
      const line = daemons.filter((e) => hasKeyword(e.ds, god) && hasKeyword(e.ds, "BATTLELINE")).length;
      const rest = daemons.filter((e) => hasKeyword(e.ds, god) && !hasKeyword(e.ds, "BATTLELINE"));
      if (rest.length > line) for (const e of rest.slice(line)) error(e.unit, "allies.daemons.battleline", `${rest.length} ${titleCase(god)} units that are not Battleline for ${line} that are; Daemonic Pact allows no more of the first than of the second.`, `Add a ${titleCase(god)} Battleline unit or remove one that is not.`);
    }
  }

  // ---- Brood Brothers ----
  if (brood.length) {
    if (!hasDetachment(/brood brother/)) for (const e of brood) error(e.unit, "allies.brood.detachment", `${name(e.unit)} needs the Brood Brother Auxilia detachment to join a Genestealer Cults army.`, "Add the detachment or remove the unit.");
    const spent = points(brood);
    const limit = BROOD_POINTS[size];
    if (spent > limit) for (const e of brood) error(e.unit, "allies.brood.points", `Astra Militarum units cost ${spent} points; Brood Brothers allows ${limit} at ${SIZE_NAME[size]}.`, "Remove an Astra Militarum unit.");
    for (const e of brood) {
      const banned = BROOD_BANNED.find((k) => hasKeyword(e.ds, k));
      if (banned) error(e.unit, "allies.brood.keyword", `${name(e.unit)} has the ${banned} keyword, which Brood Brothers does not admit.`, "Remove the unit.");
      if (e.unit.isWarlord) error(e.unit, "allies.warlord", `${name(e.unit)} joins under Brood Brothers; the Warlord must be a Genestealer Cults model.`, "Mark a Genestealer Cults character as Warlord.");
    }
  }

  // ---- Questor Forgepact ----
  if (forgepact.length) {
    if (!hasDetachment(/questor forgepact/)) for (const e of forgepact) error(e.unit, "allies.forgepact.detachment", `${name(e.unit)} needs the Questor Forgepact detachment to join an Imperial Knights army.`, "Add the detachment or remove the unit.");
    for (const e of forgepact) if (!FORGEPACT_ALLOWED.some((k) => hasKeyword(e.ds, k))) error(e.unit, "allies.forgepact.kind", `${name(e.unit)} is not one of the Adeptus Mechanicus units Questor Forgepact admits.`, `Questor Forgepact admits ${FORGEPACT_ALLOWED.map(titleCase).join(", ")} units.`);
    const spent = points(forgepact);
    if (spent > FORGEPACT_POINTS) for (const e of forgepact) error(e.unit, "allies.forgepact.points", `Adeptus Mechanicus units cost ${spent} points; Questor Forgepact allows ${FORGEPACT_POINTS}.`, "Remove an Adeptus Mechanicus unit.");
  }

  // ---- Wretched Thralls ----
  if (thralls.length) {
    if (!hasDetachment(/wretched thralls/)) for (const e of thralls) error(e.unit, "allies.thralls.detachment", `${name(e.unit)} needs the Wretched Thralls detachment to join a Chaos Knights army.`, "Add the detachment or remove the unit.");
    const spent = points(thralls);
    if (spent > THRALLS_POINTS) for (const e of thralls) error(e.unit, "allies.thralls.points", `Damned units cost ${spent} points; Wretched Thralls allows ${THRALLS_POINTS}.`, "Remove a Damned unit.");
  }

  // ---- Chapters ----
  if (core.has("ADEPTUS ASTARTES")) {
    const chapterOf = (ds: Datasheet): string | undefined => ds.factionKeywords.map(clean).find((k) => !NOT_A_CHAPTER.has(k));
    const armyChapter = [...core].find((k) => !NOT_A_CHAPTER.has(k));
    const astartes = own.filter((e) => hasFactionKeyword(e.ds, "ADEPTUS ASTARTES"));
    const chapters = [...new Set(astartes.map((e) => chapterOf(e.ds)).filter((c): c is string => !!c))];
    if (armyChapter) {
      for (const e of astartes) {
        const chapter = chapterOf(e.ds);
        if (chapter && chapter !== armyChapter) error(e.unit, "chapter.mixed", `${name(e.unit)} belongs to the ${titleCase(chapter)} Chapter; this army is ${titleCase(armyChapter)}.`, "An army holds one Chapter's units.");
      }
    } else if (chapters.length > 1) {
      out.push({ severity: "error", code: "chapter.mixed", message: `Units from more than one Chapter: ${chapters.map(titleCase).join(", ")}.`, fix: "An army holds one Chapter's units." });
    }
    const inArmy = (chapter: string) => armyChapter === chapter || chapters.includes(chapter);
    if (inArmy("BLACK TEMPLARS")) {
      for (const e of astartes) {
        if (hasKeyword(e.ds, "PSYKER")) error(e.unit, "chapter.templars", `${name(e.unit)} is a PSYKER; a Black Templars army cannot include one.`, "Remove the unit.");
        const vehicle = TEMPLAR_VEHICLES.find((k) => hasKeyword(e.ds, k));
        if (vehicle && !hasFactionKeyword(e.ds, "BLACK TEMPLARS")) error(e.unit, "chapter.templars", `${name(e.unit)} needs the BLACK TEMPLARS keyword to join a Black Templars army.`, "Use the Black Templars datasheet.");
      }
    }
    if (inArmy("SPACE WOLVES")) {
      for (const e of astartes) {
        const banned = WOLVES_BANNED.find((k) => hasKeyword(e.ds, k));
        if (banned) error(e.unit, "chapter.wolves", `A Space Wolves army cannot include ${titleCase(banned)} units.`, "Remove the unit.");
      }
    }
    if (inArmy("DEATHWATCH")) {
      for (const e of astartes) {
        const banned = DEATHWATCH_BANNED.find((k) => hasKeyword(e.ds, k));
        if (banned) error(e.unit, "chapter.deathwatch", `A Deathwatch army cannot include ${titleCase(banned)} units.`, "Remove the unit.");
      }
      for (const e of agents) {
        if (hasFactionKeyword(e.ds, "DEATHWATCH") && !hasKeyword(e.ds, "KILL TEAM CASSIUS")) error(e.unit, "chapter.deathwatch", `A Deathwatch army cannot include Agents of the Imperium DEATHWATCH units other than Kill Team Cassius.`, "Remove the unit.");
      }
    }
  }

  return out;
}

/**
 * A model that comes with another unit needs that unit in the army. Sir Hekhtur without Canis Rex
 * is a model with no points and no way onto the table.
 */
export function checkCompanions(ctx: RosterContext): Diagnostic[] {
  const out: Diagnostic[] = [];
  const name = (u: RosterUnit) => u.customName ?? ctx.datasheet(u.datasheetId)?.name ?? u.datasheetId;
  for (const unit of ctx.roster.units) {
    const ds = ctx.datasheet(unit.datasheetId);
    const host = ds && companionHostOf(ctx.snapshot, ds);
    if (!host) continue;
    const hosts = ctx.copies(host.id).length;
    const copies = ctx.copies(ds.id);
    if (!hosts) out.push({ severity: "error", code: "units.companion", message: `${name(unit)} comes with ${host.name}, which is not in the army.`, path: `/units/${ctx.roster.units.indexOf(unit)}`, fix: `Add ${host.name} or remove ${name(unit)}.` });
    else if (copies.indexOf(unit) >= hosts) out.push({ severity: "error", code: "units.companion", message: `${copies.length} ${ds.name} for ${hosts} ${host.name}; each comes with one.`, path: `/units/${ctx.roster.units.indexOf(unit)}`, fix: `Remove a ${ds.name}.` });
  }
  return out;
}
