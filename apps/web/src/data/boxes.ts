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
  /**
   * As the box is sold. Names come back: a Battleforce called Tyranid Swarm has been sold more than
   * once with different models inside, so a name alone does not say which box somebody owns and the
   * date has to be shown beside it.
   */
  readonly name: string;
  readonly kind: BoxKind;
  /**
   * The day the contents below were announced, as YYYY-MM-DD.
   *
   * The announcement rather than the release, because that is the date on the page the contents were
   * read from. A box usually reaches shops within a month or two of it, which is near enough to sort
   * by and to tell two boxes of the same name apart, and it is the date this list can stand behind.
   */
  readonly announced: string;
  readonly lines: readonly BoxLine[];
  /** The announcement the contents were read from. */
  readonly source: string;
}

const REVEALED = "https://www.warhammer-community.com/en-gb/articles/n5pspedx/new-warhammer-40000-battleforces-revealed/";
const SEVEN = "https://www.warhammer-community.com/en-gb/articles/tqw4l4sz/muster-mighty-forces-with-seven-new-warhammer-40000-battleforce-boxes/";
const IRON_WARRIORS = "https://www.warhammer-community.com/en-gb/articles/mnepgmud/revealed-combat-patrol-iron-warriors-and-heavily-armoured-battalions/";
const CHRISTMAS = "https://www.warhammer-community.com/en-gb/articles/bzezbhjo/saturday-pre-order-start-your-next-army-with-new-christmas-battleforces/";
const CHAOS_GODS = "https://www.warhammer-community.com/en-gb/articles/errixp3a/new-battleforce-boxes-pit-the-chaos-gods-against-each-other/";
const KROOT_CORSAIRS = "https://www.warhammer-community.com/en-gb/articles/5zzqwaml/four-new-combat-patrols-bring-kroot-corsairs-and-chaos-to-the-battlefield/";
const FIVE_PATROLS = "https://www.warhammer-community.com/2022/01/10/the-tau-empire-leads-the-charge-as-five-combat-patrols-prepare-to-land/";
const MECHANICUS_NECRONS = "https://www.warhammer-community.com/en-gb/articles/KbUjKYHp/exert-mechanical-supremacy-with-new-combat-patrol-boxes-for-the-adeptus-mechanicus-and-necrons/";
const THREE_PATROLS = "https://www.warhammer-community.com/en-gb/articles/vbojdl9z/saturday-pre-orders-three-new-combat-patrols-inbound/";

export const BOX_SETS: readonly BoxSet[] = [
  {
    id: "bf-penitent-crusade-host",
    name: "Battleforce: Penitent Crusade Host",
    kind: "battleforce",
    announced: "2024-11-16",
    source: CHRISTMAS,
    lines: [
      { name: "Ministorum Priest", models: 1 },
      { name: "Penitent Engines", models: 2, or: ["Mortifiers"] },
      // A Repentia Squad is a Superior and four to nine Sisters, so the box's two lines are one
      // unit of ten rather than a squad and a character standing next to it.
      { name: "Repentia Squad", models: 10 },
      { name: "Arco-flagellants", models: 10 },
      { name: "Sororitas Rhino", models: 2 },
    ],
  },
  {
    id: "bf-valourstrike-lance",
    name: "Battleforce: Valourstrike Lance",
    kind: "battleforce",
    announced: "2024-11-16",
    source: CHRISTMAS,
    lines: [
      { name: "Knight Paladin", models: 1, or: ["Knight Errant"] },
      // One Armiger kit builds a Helverin or a Warglaive, so which four were built is their owner's.
      { name: "Armigers", models: 4, ownerNames: true },
    ],
  },
  {
    id: "bf-hypercrypt-legion",
    name: "Battleforce: Hypercrypt Legion",
    kind: "battleforce",
    announced: "2024-11-16",
    source: CHRISTMAS,
    lines: [
      { name: "Overlord with Translocation Shroud", models: 1 },
      { name: "C'tan Shard of the Void Dragon", models: 1 },
      { name: "Triarch Praetorians", models: 10, or: ["Lychguard"] },
      { name: "Necron Warriors", models: 10 },
      { name: "Canoptek Scarab Swarms", models: 3 },
    ],
  },
  {
    id: "bf-retaliation-cadre",
    name: "Battleforce: Retaliation Cadre",
    kind: "battleforce",
    announced: "2024-11-16",
    source: CHRISTMAS,
    lines: [
      { name: "Commander in Coldstar Battlesuit", models: 1, or: ["Commander in Enforcer Battlesuit"] },
      { name: "Riptide Battlesuit", models: 1 },
      { name: "Ghostkeel Battlesuit", models: 1 },
      { name: "Broadside Battlesuits", models: 1 },
      // The announcement says the box holds specialist drones without saying how many.
    ],
  },
  {
    id: "bf-inner-circle-task-force",
    name: "Battleforce: Inner Circle Task Force",
    kind: "battleforce",
    announced: "2024-11-16",
    source: CHRISTMAS,
    lines: [
      { name: "Chaplain in Terminator Armour", models: 1 },
      { name: "Inner Circle Companions", models: 6 },
      { name: "Deathwing Knights", models: 10 },
    ],
  },
  {
    id: "bf-lords-of-excess",
    name: "Battleforce: Lords of Excess",
    kind: "battleforce",
    announced: "2026-01-01",
    source: CHAOS_GODS,
    lines: [
      { name: "Noise Marines", models: 12 },
      { name: "Tormentors", models: 10 },
      { name: "Daemon Prince of Slaanesh", models: 1, or: ["Daemon Prince of Slaanesh with Wings"] },
      { name: "Infractors", models: 10 },
    ],
  },
  {
    id: "bf-khorne-daemonkin",
    name: "Battleforce: Khorne Daemonkin",
    kind: "battleforce",
    announced: "2026-01-01",
    source: CHAOS_GODS,
    lines: [
      { name: "Lord on Juggernaut", models: 1 },
      { name: "Bloodcrushers", models: 6 },
      { name: "Khorne Berzerkers", models: 10 },
      { name: "Bloodletters", models: 20 },
    ],
  },
  {
    id: "bf-sekhmet-coven",
    name: "Battleforce: Sekhmet Coven",
    kind: "battleforce",
    announced: "2026-01-01",
    source: CHAOS_GODS,
    lines: [
      { name: "Infernal Master", models: 1 },
      { name: "Exalted Sorcerers", models: 3 },
      { name: "Scarab Occult Terminators", models: 10 },
      { name: "Mutalith Vortex Beast", models: 1 },
    ],
  },
  {
    id: "bf-vile-vectorium",
    name: "Battleforce: Vile Vectorium",
    kind: "battleforce",
    announced: "2026-01-01",
    source: CHAOS_GODS,
    lines: [
      // Lord Felthius and his Tainted Cohort have no sheet of their own any more. The four models
      // are Blightlord Terminators, which is the kit they come from and what they are fielded as.
      { name: "Blightlord Terminators", models: 4 },
      { name: "Deathshroud Terminators", models: 3 },
      { name: "Foetid Bloat-drones", models: 3 },
      { name: "Poxwalkers", models: 20 },
    ],
  },
  {
    id: "cp-tau-empire",
    name: "Combat Patrol: T'au Empire",
    kind: "combat-patrol",
    announced: "2022-01-10",
    source: FIVE_PATROLS,
    lines: [
      { name: "Cadre Fireblade", models: 1 },
      { name: "Ethereal", models: 1 },
      { name: "Ghostkeel Battlesuit", models: 1 },
      { name: "Stealth Battlesuits", models: 3 },
      { name: "Strike Team", models: 10 },
    ],
  },
  {
    id: "cp-aeldari-corsairs",
    name: "Combat Patrol: Aeldari Corsairs",
    kind: "combat-patrol",
    announced: "2026-02-23",
    source: KROOT_CORSAIRS,
    lines: [
      { name: "Kharseth", models: 1 },
      { name: "Corsair Voidreavers", models: 10 },
      { name: "Corsair Skyreavers", models: 5 },
      { name: "Wave Serpent", models: 1 },
    ],
  },
  {
    id: "cp-red-corsairs",
    name: "Combat Patrol: Red Corsairs",
    kind: "combat-patrol",
    announced: "2026-02-23",
    source: KROOT_CORSAIRS,
    lines: [
      { name: "Red Corsairs Reave-Captain", models: 1 },
      { name: "Red Corsairs Raiders", models: 5 },
      { name: "Fellgor Beastmen", models: 10 },
      { name: "Chaos Rhino", models: 1 },
    ],
  },
  {
    id: "cp-kroot",
    name: "Combat Patrol: Kroot",
    kind: "combat-patrol",
    announced: "2026-02-23",
    source: KROOT_CORSAIRS,
    lines: [
      { name: "Kroot Farstalkers", models: 10 },
      { name: "Kroot Hounds", models: 2 },
      { name: "Kroot Lone-spear", models: 1 },
      { name: "Krootox Rampagers", models: 3 },
      { name: "Krootox Rider", models: 1 },
    ],
  },
  {
    id: "cp-night-lords",
    name: "Combat Patrol: Night Lords",
    kind: "combat-patrol",
    announced: "2026-02-23",
    source: KROOT_CORSAIRS,
    lines: [
      { name: "Chaos Lord with Jump Pack", models: 1 },
      { name: "Chosen", models: 5 },
      { name: "Legionaries", models: 10 },
      { name: "Chaos Rhino", models: 1 },
    ],
  },
  {
    id: "cp-adeptus-mechanicus",
    name: "Combat Patrol: Adeptus Mechanicus",
    kind: "combat-patrol",
    announced: "2023-11-06",
    source: MECHANICUS_NECRONS,
    lines: [
      { name: "Tech-Priest Manipulus", models: 1 },
      { name: "Skitarii Vanguard", models: 10 },
      { name: "Pteraxii Sterylizors", models: 5 },
      { name: "Serberys Sulphurhounds", models: 3 },
    ],
  },
  {
    id: "cp-necrons",
    name: "Combat Patrol: Necrons",
    kind: "combat-patrol",
    announced: "2023-11-06",
    source: MECHANICUS_NECRONS,
    lines: [
      { name: "Overlord", models: 1 },
      { name: "Necron Warriors", models: 10 },
      { name: "Skorpekh Destroyers", models: 3 },
      { name: "Canoptek Doomstalker", models: 1 },
      { name: "Canoptek Scarab Swarms", models: 3 },
    ],
  },
  {
    id: "cp-iron-hands",
    name: "Combat Patrol: Iron Hands",
    kind: "combat-patrol",
    announced: "2025-10-11",
    source: THREE_PATROLS,
    lines: [
      { name: "Techmarine", models: 1 },
      { name: "Firestrike Servo-turrets", models: 2 },
      { name: "Heavy Intercessor Squad", models: 10 },
    ],
  },
  {
    id: "cp-white-scars",
    name: "Combat Patrol: White Scars",
    kind: "combat-patrol",
    announced: "2025-10-11",
    source: THREE_PATROLS,
    lines: [
      { name: "Captain on Bike", models: 1 },
      { name: "Outrider Squad", models: 3 },
      { name: "Impulsor", models: 1 },
      { name: "Assault Intercessor Squad", models: 5 },
    ],
  },
  {
    id: "cp-harlequins",
    name: "Combat Patrol: Harlequins",
    kind: "combat-patrol",
    announced: "2025-10-11",
    source: THREE_PATROLS,
    lines: [
      { name: "Troupe", units: 1 },
      { name: "Skyweavers", models: 2 },
      { name: "Starweaver", models: 1 },
      { name: "Voidweaver", models: 1 },
      { name: "Solitaire", models: 1 },
    ],
  },
  {
    id: "cp-iron-warriors",
    name: "Combat Patrol: Iron Warriors",
    kind: "combat-patrol",
    announced: "2026-03-09",
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
    announced: "2026-06-15",
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
    announced: "2026-06-15",
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
    announced: "2026-06-15",
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
    announced: "2026-06-15",
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
    announced: "2025-10-06",
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
    announced: "2025-10-06",
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
    announced: "2025-10-06",
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
    announced: "2025-10-06",
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
    announced: "2025-10-06",
    source: SEVEN,
    lines: [
      { name: "Captain", models: 1 },
      // The announcement names the retinue without counting it, so the datasheet counts it.
      { name: "Company Heroes", units: 1 },
      { name: "Lieutenant", models: 1 },
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
    announced: "2025-10-06",
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
    announced: "2025-10-06",
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
