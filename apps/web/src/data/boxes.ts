/**
 * What comes in a boxed set.
 *
 * No data source this app reads knows this. Wahapedia's tables are abilities, datasheets, factions
 * and stratagems; the Munitorum Field Manual is points; BattleScribe's catalogues are roster data.
 * The community schema effort that set out to cover every game entity settles on faction, unit,
 * weapon and game version. None of them describe what is physically in a box, because the question
 * belongs to a shop rather than to a game.
 *
 * So this list is read off the publisher's own announcements, one box at a time, and every entry
 * carries the article it was read from. A box whose contents were not stated in full is not guessed
 * at: the line says what the announcement said, and `units` covers the entries written as "a Krieg
 * Command Squad" rather than as a number of models.
 *
 * A line is named as the datasheets name it, which is not always as the announcement does: a box
 * saying "Sternguard Veterans" is a Sternguard Veteran Squad, and one saying "Chaos Terminators"
 * means the Chaos Terminator Squad, the bare name being Emperor's Children's and World Eaters'. The
 * names below were checked against a full snapshot; a unit that is simply not in one is left as the
 * announcement wrote it and reported when it cannot be placed.
 *
 * It is deliberately a seed rather than a catalogue. Boxes are released faster than a list in a
 * repository can follow them, so the collection screen reads this and any box the player has
 * entered or imported through the same shape.
 */

export interface BoxLine {
  /**
   * The unit as the announcement names it. Resolved against the loaded snapshot rather than stored
   * as an id, because a box outlives any one snapshot and the names in an announcement are the
   * names on the datasheets.
   */
  readonly name: string;
  /** Models of that datasheet, where the announcement gives a number of models. */
  readonly models?: number;
  /**
   * Whole units, where it gives a number of units instead ("a Krieg Command Squad"). How many
   * models that is comes from the datasheet's own composition, which is where the answer lives.
   */
  readonly units?: number;
  /**
   * The other datasheets this kit builds. One sprue, one model, several things it could become, so
   * the count belongs to whichever one was actually built.
   */
  readonly or?: readonly string[];
  /**
   * The box gives the models but does not decide what they are, and the list of what they could be
   * is open rather than a choice of two or three. A box of Tau drones is the case: the sprues build
   * shield, gun or marker drones in whatever mix was glued, and only the person who glued them
   * knows. The count is theirs to label when they add the box, and until they do it belongs to no
   * datasheet — which is why this is not the same as a line whose unit is missing from the data.
   */
  readonly ownerNames?: true;
}

export type BoxKind = "combat-patrol" | "battleforce";

export interface BoxSet {
  readonly id: string;
  readonly name: string;
  readonly kind: BoxKind;
  readonly lines: readonly BoxLine[];
  /** The announcement the contents were read from. */
  readonly source: string;
}

const REVEALED = "https://www.warhammer-community.com/en-gb/articles/n5pspedx/new-warhammer-40000-battleforces-revealed/";
const SEVEN = "https://www.warhammer-community.com/en-gb/articles/tqw4l4sz/muster-mighty-forces-with-seven-new-warhammer-40000-battleforce-boxes/";
const IRON_WARRIORS = "https://www.warhammer-community.com/en-gb/articles/mnepgmud/revealed-combat-patrol-iron-warriors-and-heavily-armoured-battalions/";

export const BOX_SETS: readonly BoxSet[] = [
  {
    id: "cp-iron-warriors",
    name: "Combat Patrol: Iron Warriors",
    kind: "combat-patrol",
    source: IRON_WARRIORS,
    lines: [
      { name: "Chaos Terminator Squad", models: 5 },
      { name: "Havocs", models: 5 },
      { name: "Legionaries", models: 10 },
      { name: "Warpsmith", models: 1 },
    ],
  },
  {
    id: "bf-astra-militarum-platoon",
    name: "Battleforce: Astra Militarum Platoon",
    kind: "battleforce",
    source: REVEALED,
    lines: [
      { name: "Cadian Command Squad", units: 1 },
      { name: "Commissar", models: 1 },
      { name: "Cadian Shock Troops", models: 10 },
      { name: "Field Ordnance Battery", units: 1 },
      { name: "Basilisk", models: 1 },
      { name: "Rogal Dorn Battle Tank", models: 1 },
    ],
  },
  {
    id: "bf-tyranid-swarm",
    name: "Battleforce: Tyranid Swarm",
    kind: "battleforce",
    source: REVEALED,
    lines: [
      { name: "Lictor", models: 1 },
      { name: "Von Ryan's Leapers", models: 3 },
      { name: "Hormagaunts", models: 10 },
      { name: "Termagants", models: 10 },
      { name: "Tyranid Warriors", models: 3, ownerNames: true },
      { name: "Hive Tyrant", models: 1, or: ["The Swarmlord", "Hive Tyrant with Wings"] },
    ],
  },
  {
    id: "bf-chaos-space-marines-warband",
    name: "Battleforce: Chaos Space Marines Warband",
    kind: "battleforce",
    source: REVEALED,
    lines: [
      { name: "Lord Discordant on Helstalker", models: 1 },
      { name: "Obliterators", models: 2 },
      { name: "Venomcrawler", models: 1 },
      { name: "Cultist Mob", models: 20 },
      { name: "Legionaries", models: 10 },
    ],
  },
  {
    id: "bf-necron-host",
    name: "Battleforce: Necron Host",
    kind: "battleforce",
    source: REVEALED,
    lines: [
      { name: "Catacomb Command Barge", models: 1 },
      { name: "Canoptek Doomstalker", models: 1 },
      { name: "Ophydian Destroyers", models: 3 },
      { name: "Flayed Ones", models: 5 },
      { name: "Necron Warriors", models: 20 },
      { name: "Canoptek Scarab Swarms", models: 6 },
    ],
  },
  {
    id: "bf-blissbound-warband",
    name: "Battleforce: Blissbound Warband",
    kind: "battleforce",
    source: SEVEN,
    lines: [
      { name: "Fulgrim", models: 1 },
      { name: "Flawless Blades", models: 6 },
      { name: "Noise Marines", models: 6 },
    ],
  },
  {
    id: "bf-cthonian-prospect",
    name: "Battleforce: Cthonian Prospect",
    kind: "battleforce",
    source: SEVEN,
    lines: [
      // The Iron-master's datasheet is the Iron-master, an Ironkin Assistant and three E-COGs, so
      // the box's two lines are one unit and its composition is what counts them.
      { name: "Brôkhyr Iron-master", units: 1 },
      { name: "Brôkhyr Thunderkyn", models: 3 },
      { name: "Cthonian Earthshakers", models: 2 },
      { name: "Cthonian Beserks", models: 10 },
      { name: "Kapricus Defender", models: 1, or: ["Kapricus Carrier"] },
    ],
  },
  {
    id: "bf-crusher-stampede",
    name: "Battleforce: Crusher Stampede",
    kind: "battleforce",
    source: SEVEN,
    lines: [
      // The two Neuroloids in the box are the Neurotyrant's Neuroloids ability rather than a unit,
      // so there is no datasheet for a shelf counted per datasheet to put them against.
      { name: "Neurotyrant", models: 1 },
      { name: "Screamer-Killer", models: 1 },
      { name: "Tyrannofex", models: 1, or: ["Tervigon"] },
      { name: "Haruspex", models: 1, or: ["Exocrine"] },
      { name: "Maleceptor", models: 1, or: ["Toxicrene"] },
    ],
  },
  {
    id: "bf-farsight-cadre",
    name: "Battleforce: Farsight Cadre",
    kind: "battleforce",
    source: SEVEN,
    lines: [
      { name: "Commander Farsight", models: 1 },
      { name: "Riptide Battlesuit", models: 1 },
      { name: "Broadside Battlesuit", models: 1 },
      // Both kits build several datasheets apiece, and which ones is settled at the painting table.
      { name: "Crisis Battlesuits", models: 3, ownerNames: true },
      { name: "Drones", models: 8, ownerNames: true },
    ],
  },
  {
    id: "bf-iron-halo-strike-force",
    name: "Battleforce: Iron Halo Strike Force",
    kind: "battleforce",
    source: SEVEN,
    lines: [
      { name: "Captain", models: 1 },
      // The announcement names the retinue without counting it, so the datasheet counts it.
      { name: "Company Heroes", units: 1 },
      { name: "Sternguard Veteran Squad", models: 5 },
      { name: "Hellblaster Squad", models: 5 },
      { name: "Ballistus Dreadnought", models: 1 },
      { name: "Redemptor Dreadnought", models: 1 },
    ],
  },
  {
    id: "bf-hellforged-warband",
    name: "Battleforce: Hellforged Warband",
    kind: "battleforce",
    source: SEVEN,
    lines: [
      { name: "Lord Discordant on Helstalker", models: 1 },
      { name: "Venomcrawler", models: 1 },
      { name: "Obliterators", models: 2 },
      { name: "Havocs", models: 5 },
      { name: "Legionaries", models: 10 },
      { name: "Chaos Rhino", models: 1 },
    ],
  },
  {
    id: "bf-krieg-siege-platoon",
    name: "Battleforce: Krieg Siege Platoon",
    kind: "battleforce",
    source: SEVEN,
    lines: [
      // The announcement says Lord Commissar, which no longer has a sheet of its own.
      { name: "Commissar", models: 1 },
      { name: "Krieg Command Squad", units: 1 },
      { name: "Death Korps of Krieg", models: 20 },
      { name: "Krieg Combat Engineers", units: 1 },
      { name: "Krieg Heavy Weapons Squad", units: 2 },
    ],
  },
];
