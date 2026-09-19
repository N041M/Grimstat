/**
 * The size of the models that come without a base, as sold.
 *
 * A datasheet that says "Use model" tells the battle table nothing about how much ground the model
 * takes. This table fills that gap from published measurements of the kits: forum owners with a
 * ruler, foam tray cutouts, unboxings and product copy, gathered on 2026-09-18. Sizes are in
 * millimetres. `length` runs along the direction of travel, `width` across, and both include
 * sponsons, since sponsons block as much as hull. `height` is to the highest fixed point, and for
 * a flyer it includes the stand it plays on. `round` marks a kit whose footprint is a base or a
 * roughly circular hull, and then `width` is its diameter.
 *
 * `confidence` says how the figure was reached. "measured" is a ruler on the kit. "catalogue" is a
 * maker's or seller's figure, or the base the kit ships on. "chassis" is a kit that shares a hull
 * with a measured one, with its own turret or fittings estimated. "estimate" is read off
 * comparison photographs and tray sizes, and can be a centimetre or two out either way.
 *
 * A model is looked up by its own profile name first and by its datasheet's name second, so the
 * Attack Bike in a Bike Squad gets the Attack Bike's size. The first row whose pattern matches
 * wins, so a specific kit is listed before the family it belongs to, and a name that also belongs
 * to a character or a squad is anchored to the whole name. Wall and line pieces, which players lay out in any shape, are not
 * listed; those keep the fortification's default footprint.
 */

export type HullConfidence = "measured" | "catalogue" | "chassis" | "estimate";

export interface HullSize {
  /** The kit or family of kits the row describes. */
  readonly kit: string;
  readonly length: number;
  readonly width: number;
  readonly height: number;
  readonly round?: true;
  readonly confidence: HullConfidence;
  /** What was measured, and what was not. */
  readonly note?: string;
  readonly source: string;
}

interface HullRow extends HullSize {
  readonly match: RegExp;
}

const HERESY_DIMENSIONS = "https://www.heresy-online.net/threads/actual-dimensions.34370/";
const HERESY_BANEBLADE = "https://www.heresy-online.net/threads/baneblade-measurements.82445/";
const HERESY_DROP_POD = "https://www.heresy-online.net/threads/drop-pod-dimensions.51677/";
const CHIMERA_THREAD = "https://www.tapatalk.com/groups/the_underempire/chimera-dimensions-t19291.html";
const THRIFTHAMMER = "https://thrifthammer.com/blog/most-expensive-largest-warhammer-40k-models-forge-world-resin/";
const FELDHERR_GSC = "https://www.feldherr.net/hs100a001-foam-tray-for-genestealer-cults-3-compartments/a-58694";

const HULLS: readonly HullRow[] = [
  /* ---- fortification platforms, before the vehicles that share their names ------------------ */
  { match: /hydra platform/, kit: "Hydra Platform", length: 100, width: 60, height: 55, confidence: "estimate", note: "Trailer frame.", source: "not found" },
  { match: /manticore platform/, kit: "Manticore Platform", length: 100, width: 60, height: 60, confidence: "estimate", note: "Trailer frame.", source: "not found" },
  { match: /earthshaker platform/, kit: "Earthshaker Platform", length: 140, width: 80, height: 50, confidence: "estimate", note: "Owners suggest a 130 mm base.", source: "https://bolterandchainsword.com/topic/336016-base-for-earthshaker-platform/" },
  { match: /triarch stalker/, kit: "Triarch Stalker", length: 140, width: 110, height: 110, confidence: "estimate", note: "Height from a 110 mm tray.", source: "https://www.feldherr.net/hs120a011-feldherr-foam-tray-for-necrons/a-61546" },

  /* ---- Adeptus Astartes and the Rhino hull ------------------------------------------------- */
  { match: /razorback/, kit: "Razorback", length: 100, width: 76, height: 60, confidence: "chassis", note: "Rhino hull with a turret.", source: HERESY_DIMENSIONS },
  { match: /\brhino\b/, kit: "Rhino, Rhino Primaris", length: 100, width: 76, height: 45, confidence: "chassis", note: "The Predator's hull without its extended front plate, so 100 to 110 mm long.", source: HERESY_DIMENSIONS },
  { match: /predator/, kit: "Predator, Baal and Deimos Predators", length: 120, width: 110, height: 75, confidence: "measured", note: "Hull 80 wide; sponsons add 30. Turret adds 20 to a 55 mm hull.", source: HERESY_DIMENSIONS },
  { match: /vindicator/, kit: "Vindicator, Vindicator Laser Destroyer", length: 110, width: 85, height: 55, confidence: "chassis", note: "Rhino hull; the siege shield is wider than the tracks.", source: "https://us.battlefoam.com/space-marines-3-vindicator-3-thunder-fires-2-dreadnought-foam-tray-sm19bfl-3/" },
  { match: /whirlwind scorpius/, kit: "Whirlwind Scorpius", length: 105, width: 80, height: 60, confidence: "chassis", note: "Deimos hull.", source: HERESY_DIMENSIONS },
  { match: /whirlwind/, kit: "Whirlwind", length: 100, width: 76, height: 60, confidence: "chassis", note: "Rhino hull with a launcher.", source: HERESY_DIMENSIONS },
  { match: /^(hunter|stalker)$/, kit: "Hunter, Stalker", length: 100, width: 76, height: 70, confidence: "chassis", note: "Rhino hull; the missile mount is the tallest part.", source: "https://us.battlefoam.com/space-marines-2-stalker-or-hunter-foam-tray-bfl-3-5/" },
  { match: /land raider|terminus ultra/, kit: "Land Raider and every variant", length: 165, width: 125, height: 76, confidence: "measured", note: "Owner quotes 6.5 by 4 by 3 inches; others report nearer 145 long. Width with sponsons estimated.", source: "https://www.40konline.com/index.php?topic=218107.0" },
  { match: /repulsor executioner/, kit: "Repulsor Executioner", length: 175, width: 108, height: 80, confidence: "catalogue", note: "From a print sized to the kit; length includes the forward gun.", source: "https://www.cgtrader.com/3d-print-models/miniatures/vehicles/repulsor-executioner-with-panzer-tracks-fe4212b4-6764-4feb-998d-f49b21f43084" },
  { match: /immolator/, kit: "Immolator", length: 105, width: 78, height: 65, confidence: "estimate", note: "Sororitas Rhino hull with turret.", source: "https://spikeybits.com/warhammer-40k/how-big-is-it-40k-sisters-of-battle-immolator-unbox-build/" },
  { match: /exorcist/, kit: "Exorcist", length: 110, width: 80, height: 90, confidence: "estimate", note: "Same hull as the Immolator; the organ is the tallest part.", source: "https://www.feldherr.net/hs140a001-feldherr-foam-tray-for-adepta-sororitas-exorcist-4-miniatures/a-59721" },
  { match: /^castigator$/, kit: "Castigator", length: 110, width: 85, height: 65, confidence: "estimate", note: "Same hull with a battle cannon turret.", source: "https://www.feldherr.net/hs100a008-foam-tray-for-adepta-sororitas-castigator/a-62054" },
  { match: /repressor/, kit: "Repressor", length: 100, width: 76, height: 60, confidence: "chassis", note: "Rhino hull with a raised fighting deck.", source: HERESY_DIMENSIONS },
  { match: /^(drop pod|deathstorm drop pod|dreadnought drop pod)$/, kit: "Drop Pod, Deathstorm and Dreadnought Drop Pods", length: 115, width: 115, height: 150, round: true, confidence: "measured", note: "Closed: 4.5 inches across the fins, 6 inches tall. Open, the doors reach about 190 mm across.", source: HERESY_DROP_POD },
  { match: /coronus/, kit: "Coronus Grav-carrier", length: 190, width: 100, height: 70, confidence: "estimate", note: "Triaros-sized; two fit an 89 mm tray.", source: "https://us.battlefoam.com/legio-custodes-2-coronus-grav-carrier-foam-tray-bfl-3-5/" },
  { match: /skorpius/, kit: "Skorpius Dunerider, Skorpius Disintegrator", length: 170, width: 80, height: 60, confidence: "estimate", note: "Four fit an 89 mm tray.", source: "https://us.battlefoam.com/adeptus-mechanicus-4-skorpius-disintegrator-dunerider-foam-tray-bfl-3-5/" },
  { match: /termite/, kit: "Terrax-pattern Termite", length: 130, width: 70, height: 65, confidence: "estimate", note: "Length includes the drill head.", source: "https://www.forgeworld.co.uk/en-US/Terrax-Pattern-Termite-Assault-Drill-2018" },
  { match: /hades breaching drill/, kit: "Hades Breaching Drill", length: 115, width: 60, height: 55, confidence: "estimate", note: "Nearly as long as a Chimera, per a builder.", source: "https://cadianshock.com/hades-breaching-drills-completed/" },
  { match: /rapier/, kit: "Rapier Carrier", length: 60, width: 60, height: 30, round: true, confidence: "catalogue", note: "Ships on a 60 mm round base.", source: "https://taleofpainters.com/2025/06/review-horus-heresy-tarantulas-rapier-batteries/" },
  { match: /tarantula/, kit: "Tarantula batteries", length: 50, width: 45, height: 40, confidence: "estimate", note: "No base supplied; legs spread give the width.", source: "https://taleofpainters.com/2025/06/review-horus-heresy-tarantulas-rapier-batteries/" },
  { match: /sabre weapons/, kit: "Sabre Weapons Battery", length: 60, width: 55, height: 45, confidence: "estimate", note: "Tarantula legs under a larger gun.", source: "https://warhammer40k.fandom.com/wiki/Tarantula_Sentry_Gun" },
  { match: /thunderfire/, kit: "Thunderfire Cannon", length: 65, width: 55, height: 45, confidence: "estimate", note: "Gun only; three fit a 76 mm tray.", source: "https://us.battlefoam.com/space-marines-3-vindicator-3-thunder-fires-2-dreadnought-foam-tray-sm19bfl-3/" },
  { match: /attack bike/, kit: "Attack Bike", length: 90, width: 52, height: 40, confidence: "catalogue", note: "Ships on a 90 by 52 mm oval base.", source: "https://spikeybits.com/base-size-reference-guide/" },
  { match: /invader atv/, kit: "Invader ATV", length: 90, width: 52, height: 50, confidence: "catalogue", note: "Ships on a 90 by 52 mm oval base.", source: "https://spikeybits.com/base-size-reference-guide/" },

  /* ---- Astra Militarum ----------------------------------------------------------------------- */
  { match: /leman russ|stygies destroyer/, kit: "Leman Russ and every variant, Stygies Destroyer", length: 120, width: 110, height: 75, confidence: "measured", note: "Hull 80 wide; sponsons add 30. Turret adds 20 to a 55 mm hull.", source: HERESY_DIMENSIONS },
  { match: /rogal dorn/, kit: "Rogal Dorn", length: 150, width: 125, height: 70, confidence: "estimate", note: "Between a Leman Russ and a Baneblade, per Games Workshop.", source: "https://www.warhammer-community.com/en-gb/articles/SBX20teG/rogal-dorn-size-comparison-how-the-new-tank-matches-up-in-scale-and-rules/" },
  { match: /chimera/, kit: "Chimera, Storm Chimera, Inquisitorial Chimera", length: 121, width: 95, height: 65, confidence: "measured", note: "Hull 51 tall without the turret. A second owner measured 114 long.", source: CHIMERA_THREAD },
  { match: /basilisk/, kit: "Basilisk", length: 121, width: 95, height: 70, confidence: "chassis", note: "Chimera hull; the barrel reaches about 165 mm at low elevation.", source: CHIMERA_THREAD },
  { match: /^hydra$/, kit: "Hydra", length: 121, width: 95, height: 75, confidence: "chassis", note: "Chimera hull.", source: CHIMERA_THREAD },
  { match: /wyvern/, kit: "Wyvern", length: 121, width: 95, height: 65, confidence: "chassis", note: "Chimera hull.", source: CHIMERA_THREAD },
  { match: /^manticore$/, kit: "Manticore", length: 121, width: 95, height: 80, confidence: "chassis", note: "Chimera hull; rack raised.", source: CHIMERA_THREAD },
  { match: /deathstrike/, kit: "Deathstrike", length: 121, width: 95, height: 120, confidence: "chassis", note: "Chimera hull; missile raised.", source: CHIMERA_THREAD },
  { match: /hellhound|hippogriff/, kit: "Hellhound, Hippogriff", length: 121, width: 95, height: 65, confidence: "chassis", note: "Chimera hull.", source: CHIMERA_THREAD },
  { match: /griffon/, kit: "Griffon", length: 121, width: 95, height: 60, confidence: "chassis", note: "Chimera hull, open mortar bay.", source: CHIMERA_THREAD },
  { match: /armageddon-pattern medusa|^colossus$/, kit: "Armageddon-pattern Medusa, Colossus", length: 121, width: 95, height: 65, confidence: "chassis", note: "Chimera hull.", source: CHIMERA_THREAD },
  { match: /atlas recovery/, kit: "Atlas Recovery Vehicle", length: 121, width: 95, height: 70, confidence: "chassis", note: "Chimera hull; the crane reaches about 140 mm.", source: CHIMERA_THREAD },
  { match: /trojan support|salamander (scout|command)/, kit: "Trojan, Salamander", length: 121, width: 95, height: 55, confidence: "chassis", note: "Chimera hull, no turret.", source: CHIMERA_THREAD },
  { match: /(earthshaker|medusa) carriage/, kit: "Earthshaker Carriage Battery, Medusa Carriage Battery", length: 120, width: 80, height: 55, confidence: "estimate", note: "Towed gun on its carriage, crew separate.", source: "not found" },
  { match: /taurox/, kit: "Taurox, Taurox Prime", length: 105, width: 65, height: 60, confidence: "estimate", note: "Sized against the Chimera.", source: "not found" },
  { match: /centaur/, kit: "Centaur Light Carrier, Centaur RSV", length: 70, width: 55, height: 40, confidence: "estimate", note: "Half-length tracked carrier.", source: "not found" },
  { match: /cyclops/, kit: "Cyclops Demolition Vehicle", length: 45, width: 30, height: 20, confidence: "estimate", note: "Fits inside a Chimera.", source: "not found" },
  { match: /carnodon/, kit: "Carnodon", length: 130, width: 90, height: 60, confidence: "estimate", note: "Between a Chimera and a Leman Russ.", source: "not found" },
  { match: /tauros/, kit: "Tauros, Tauros Venator", length: 90, width: 55, height: 45, confidence: "estimate", note: "A print at kit scale lists 90 mm long.", source: "https://cults3d.com/en/3d-model/game/tauros-venator-full-rc-1-18" },
  { match: /sentinel powerlifter/, kit: "Sentinel Powerlifter", length: 60, width: 50, height: 75, confidence: "estimate", note: "Same legs as the plastic Sentinel; pose-dependent.", source: "not found" },
  { match: /baneblade|banehammer|banesword|doomhammer|hellhammer|shadowsword|stormblade|^stormlord$|stormsword|stormhammer/, kit: "Baneblade and every chassis variant", length: 220, width: 180, height: 100, confidence: "measured", note: "Track to track 220. Hull 140 wide; sponsons add 40. Hull 60 tall, gun mount 75, turret about 100.", source: HERESY_BANEBLADE },
  { match: /macharius|gorgon heavy/, kit: "Macharius and variants, Gorgon", length: 190, width: 114, height: 80, confidence: "measured", note: "Owner measured 7.5 by 4.5 inches. Height estimated. The Gorgon shares the chassis.", source: "https://40konline.com/index.php?topic=191810.0" },
  { match: /valdor/, kit: "Valdor", length: 180, width: 95, height: 55, confidence: "estimate", note: "Malcador chassis; the laser adds about 25 mm of length.", source: "not found" },
  { match: /minotaur/, kit: "Minotaur", length: 160, width: 95, height: 65, confidence: "estimate", note: "Malcador chassis.", source: "not found" },
  { match: /malcador/, kit: "Malcador and variants", length: 150, width: 95, height: 70, confidence: "estimate", note: "A seller's 254 by 197 mm is the box, not the model.", source: "https://www.nobleknight.com/P/2148005488/Malcador-Heavy-Tank" },
  { match: /^praetor$/, kit: "Praetor", length: 180, width: 120, height: 85, confidence: "estimate", note: "Crassus chassis, launcher raised.", source: "not found" },
  { match: /dominus armoured/, kit: "Dominus Armoured Siege Bombard", length: 180, width: 120, height: 90, confidence: "estimate", note: "Crassus chassis with a mortar.", source: "not found" },
  { match: /crassus/, kit: "Crassus", length: 180, width: 120, height: 70, confidence: "estimate", note: "Wider than a Macharius.", source: "not found" },
  { match: /marauder/, kit: "Marauder Bomber, Marauder Destroyer", length: 330, width: 450, height: 150, confidence: "catalogue", note: "Wingspan of 18 inches quoted; length and height on the stand estimated.", source: "https://www.warseer.com/forums/archive/index.php/t-64471.html" },

  /* ---- Forge World Astartes and Chaos ------------------------------------------------------- */
  { match: /sicaran/, kit: "Sicaran and every variant", length: 155, width: 90, height: 60, confidence: "estimate", note: "Between a Predator and a Land Raider in photographs.", source: "https://weemen.blogspot.com/2014/01/forgeworld-sicaran-battletank-size.html" },
  { match: /spartan|cerberus|typhon/, kit: "Spartan, Cerberus, Typhon", length: 215, width: 125, height: 80, confidence: "estimate", note: "About a fifth longer than a Land Raider. Two fit a 102 mm tray.", source: "https://us.battlefoam.com/30k-horus-heresy-2-typhon-cerberus-heavy-tank-foam-tray-bfl-4/" },
  { match: /kratos/, kit: "Kratos", length: 190, width: 120, height: 75, confidence: "estimate", note: "Smaller than a Spartan, larger than a Land Raider.", source: "https://spikeybits.com/new-warhammer-kratos-heavy-assault-tank-size-comparison/" },
  { match: /mastodon/, kit: "Mastodon", length: 250, width: 165, height: 110, confidence: "catalogue", note: "Length quoted; width and height from photographs.", source: THRIFTHAMMER },
  { match: /fellblade|falchion/, kit: "Fellblade, Falchion", length: 230, width: 140, height: 95, confidence: "estimate", note: "A little larger than a Baneblade.", source: "https://wh40k.lexicanum.com/wiki/Fellblade" },
  { match: /storm eagle|fire raptor/, kit: "Storm Eagle, Fire Raptor", length: 250, width: 240, height: 200, confidence: "estimate", note: "Fuselage 250, wingspan 240, hull 90 tall on a stand of about 110.", source: "https://warhammer40k.fandom.com/wiki/Fire_Raptor" },
  { match: /xiphon/, kit: "Xiphon Interceptor", length: 190, width: 160, height: 120, confidence: "estimate", note: "Hull 60 tall on a stand of about 60.", source: "https://www.forgeworld.co.uk/en-US/Xiphon-Pattern-Interceptor-FW-2020" },
  { match: /thunderhawk/, kit: "Thunderhawk Gunship", length: 480, width: 440, height: 200, confidence: "catalogue", note: "Length and wingspan quoted; height on the stand estimated.", source: THRIFTHAMMER },
  { match: /stormbird/, kit: "Sokar-pattern Stormbird", length: 500, width: 600, height: 250, confidence: "catalogue", note: "Length quoted, 6 kg; wingspan and stand height estimated.", source: THRIFTHAMMER },
  { match: /hellblade/, kit: "Hellblade", length: 175, width: 200, height: 115, confidence: "estimate", note: "Hull 55 tall on a stand of about 60.", source: "not found" },
  { match: /contemptor/, kit: "Contemptor Dreadnought", length: 60, width: 60, height: 75, round: true, confidence: "catalogue", note: "60 mm round base.", source: "https://www.dakkadakka.com/dakkaforum/posts/list/412503.page" },
  { match: /leviathan dreadnought/, kit: "Leviathan Dreadnought", length: 80, width: 80, height: 95, round: true, confidence: "catalogue", note: "80 mm round base.", source: "https://weemen.blogspot.com/2017/11/after-dreadtober-size-comparison.html" },
  { match: /deredeo/, kit: "Deredeo Dreadnought", length: 80, width: 80, height: 85, round: true, confidence: "catalogue", note: "80 mm round base.", source: "https://weemen.blogspot.com/2017/11/after-dreadtober-size-comparison.html" },
  { match: /blood slaughterer/, kit: "Blood Slaughterer", length: 100, width: 100, height: 95, round: true, confidence: "estimate", note: "100 mm round base.", source: "not found" },
  { match: /greater blight drone/, kit: "Greater Blight Drone", length: 110, width: 120, height: 100, confidence: "estimate", note: "Width across the rotors; height on the stand.", source: "not found" },
  { match: /greater brass scorpion/, kit: "Greater Brass Scorpion", length: 250, width: 180, height: 180, confidence: "estimate", note: "Height to the raised tail.", source: "http://stephanius40k.blogspot.com/2013/07/greater-brass-scorpion-construction.html" },
  { match: /kytan/, kit: "Kytan Ravager", length: 170, width: 170, height: 220, round: true, confidence: "estimate", note: "Knight-sized on a 170 mm round base.", source: "not found" },
  { match: /lord of skulls/, kit: "Khorne Lord of Skulls", length: 178, width: 130, height: 152, confidence: "catalogue", note: "Games Workshop: just over 7 inches long, almost 6 tall. Width estimated.", source: "https://www.warhammer.com/en-US/shop/Chaos-Space-Marines-Khorne-Lord-of-Skulls" },
  { match: /plagueburst/, kit: "Plagueburst Crawler", length: 150, width: 105, height: 80, confidence: "estimate", note: "Two fit a 76 mm tray.", source: "https://us.battlefoam.com/death-guard-2-plagueburst-crawler-foam-tray-bfs-3/" },
  { match: /soul grinder/, kit: "Soul Grinder", length: 150, width: 100, height: 150, confidence: "catalogue", note: "Ships on a 150 by 100 mm base.", source: "https://chaos-legion.com/products/soul-grinder" },
  { match: /acastus|asterius|porphyrion/, kit: "Acastus Knight Asterius, Porphyrion", length: 170, width: 170, height: 240, round: true, confidence: "catalogue", note: "Heights of 240 and 250 quoted; 170 mm round base.", source: THRIFTHAMMER },
  { match: /warhound/, kit: "Warhound Titan", length: 200, width: 150, height: 250, confidence: "catalogue", note: "Height quoted; footprint estimated.", source: THRIFTHAMMER },
  { match: /reaver titan/, kit: "Reaver Titan", length: 250, width: 200, height: 400, confidence: "catalogue", note: "Height quoted; footprint estimated.", source: THRIFTHAMMER },
  { match: /warlord titan/, kit: "Warlord Titan", length: 400, width: 350, height: 600, confidence: "catalogue", note: "Height quoted; footprint estimated.", source: THRIFTHAMMER },
  { match: /warbringer/, kit: "Warbringer Nemesis Titan", length: 300, width: 250, height: 405, confidence: "estimate", note: "About 16 inches tall.", source: THRIFTHAMMER },
  { match: /scabeiathrax/, kit: "Scabeiathrax the Bloated", length: 130, width: 130, height: 150, round: true, confidence: "estimate", note: "130 mm round base.", source: "not found" },
  { match: /spined chaos beast/, kit: "Spined Chaos Beast", length: 100, width: 100, height: 100, round: true, confidence: "estimate", note: "100 mm round base.", source: "not found" },
  { match: /exalted seeker chariot/, kit: "Exalted Seeker Chariot", length: 150, width: 100, height: 90, confidence: "catalogue", note: "150 by 100 mm base.", source: "https://eu.nobleknight.com/P/2147482852/Exalted-Seeker-Chariot" },
  { match: /seeker chariot/, kit: "Seeker Chariot", length: 120, width: 92, height: 90, confidence: "catalogue", note: "120 by 92 mm base.", source: "https://huntersofthewarp.forumakers.com/t5010-does-anyone-know-the-base-size-of-a-seeker-chariot" },
  { match: /steed of slaanesh/, kit: "Steed of Slaanesh", length: 60, width: 35, height: 55, confidence: "catalogue", note: "60 by 35 mm base.", source: "https://tow.whfb.app/unit/steed-of-slaanesh" },

  /* ---- Orks ---------------------------------------------------------------------------------- */
  { match: /^trukk$/, kit: "Trukk", length: 150, width: 85, height: 75, confidence: "estimate", note: "Sold a 95 mm tray.", source: "https://www.feldherr.net/hs105a003-feldherr-foam-tray-for-orks-trukk/a-61616" },
  { match: /battlewagon|gunwagon/, kit: "Battlewagon, Gunwagon", length: 185, width: 110, height: 105, confidence: "estimate", note: "Height from a 115 mm tray; about 200 long with a deff rolla.", source: "https://www.feldherr.com/products/fs125a001-feldherr-schaumstoffeinlage-fur-orks-battlewagon-ghazghkull-thraka" },
  { match: /big trakk/, kit: "Big Trakk", length: 170, width: 90, height: 70, confidence: "estimate", source: "not found" },
  { match: /kill tank/, kit: "Kill Tank", length: 260, width: 150, height: 120, confidence: "estimate", source: "not found" },
  { match: /stompa/, kit: "Stompa", length: 200, width: 160, height: 280, confidence: "measured", note: "About 11 inches tall; footprint estimated.", source: "https://www.dakkadakka.com/gallery/372798-Stompa%20Size%20Comparison.html" },
  { match: /gargantuan squiggoth/, kit: "Gargantuan Squiggoth", length: 310, width: 160, height: 210, confidence: "estimate", source: "https://miniset.net/sets/gw-99590103031" },
  { match: /lifta wagon/, kit: "Lifta Wagon", length: 200, width: 110, height: 150, confidence: "estimate", note: "Battlewagon hull; the arm sets the height.", source: "not found" },
  { match: /grot mega-tank/, kit: "Grot Mega-tank", length: 170, width: 100, height: 100, confidence: "estimate", note: "Near a Battlewagon's footprint.", source: "https://www.belloflostsouls.net/2011/03/40k-model-review-forge-world-grot-mega-tank.html" },
  { match: /grot tanks/, kit: "Grot Tank", length: 65, width: 40, height: 40, confidence: "estimate", source: "not found" },
  { match: /mek gunz/, kit: "Mek Gun", length: 80, width: 55, height: 60, confidence: "estimate", source: "not found" },
  { match: /wartrakk/, kit: "Wartrakk", length: 95, width: 60, height: 45, confidence: "estimate", source: "not found" },
  { match: /dakkarig/, kit: "Big Mek in Dakkarig", length: 120, width: 90, height: 110, confidence: "estimate", source: "https://www.warhammer.com/en-US/shop/orks-big-mek-dakkarig-2026" },
  { match: /mekboy workshop/, kit: "Mekboy Workshop", length: 200, width: 150, height: 100, confidence: "estimate", source: "not found" },
  { match: /bossbunka/, kit: "Big'ed Bossbunka", length: 220, width: 160, height: 130, confidence: "estimate", source: "not found" },

  /* ---- Necrons ------------------------------------------------------------------------------- */
  { match: /annihilation barge/, kit: "Annihilation Barge", length: 150, width: 79, height: 100, confidence: "catalogue", note: "Tray cutout 150 by 79 by 75 without the stand; the stand adds about 25.", source: "https://www.feldherr.com/products/feldherr-lagerbox-fslb250-fur-necrons" },
  { match: /gauss pylon/, kit: "Gauss Pylon", length: 200, width: 180, height: 170, confidence: "estimate", source: "not found" },
  { match: /sentry pylon/, kit: "Sentry Pylon", length: 100, width: 100, height: 100, confidence: "estimate", source: "not found" },
  { match: /seraptek/, kit: "Seraptek Heavy Construct", length: 300, width: 250, height: 190, confidence: "estimate", note: "Bounded by a 394 by 305 by 191 mm tray.", source: "https://us.battlefoam.com/necron-1-seraptek-heavy-construct-with-weapons-pointed-out-foam-tray-bfl-7-5/" },
  { match: /convergence of dominion/, kit: "Convergence of Dominion (one Starstele)", length: 70, width: 70, height: 115, confidence: "estimate", source: "https://www.warhammer.com/en-WW/shop/Convergence-of-Dominion-2020" },

  /* ---- Aeldari and Drukhari ------------------------------------------------------------------ */
  { match: /^(cobra|scorpion)$/, kit: "Cobra, Scorpion", length: 240, width: 130, height: 70, confidence: "estimate", source: "not found" },
  { match: /^lynx$/, kit: "Lynx", length: 200, width: 130, height: 60, confidence: "estimate", source: "not found" },
  { match: /warp hunter/, kit: "Warp Hunter", length: 170, width: 110, height: 60, confidence: "estimate", source: "not found" },
  { match: /revenant titan/, kit: "Revenant Titan", length: 200, width: 220, height: 300, confidence: "measured", note: "About 12 inches to the head; width is the wing tips.", source: "https://www.belloflostsouls.net/2012/07/40k-unboxing-forge-world-eldar-revenant-titan.html" },
  { match: /phantom titan/, kit: "Phantom Titan", length: 300, width: 250, height: 610, confidence: "estimate", source: "not found" },
  { match: /webway gate/, kit: "Webway Gate", length: 250, width: 100, height: 330, confidence: "measured", note: "33 cm tall; footprint estimated.", source: "https://taleofpainters.com/2021/01/review-aeldari-webway-gates/" },
  { match: /^reaper$/, kit: "Reaper", length: 180, width: 90, height: 80, confidence: "estimate", note: "Height on the stand.", source: "not found" },
  { match: /tantalus/, kit: "Tantalus", length: 260, width: 130, height: 100, confidence: "estimate", note: "Height on the stand.", source: "not found" },

  /* ---- T'au, Leagues of Votann, Genestealer Cults, Tyranids --------------------------------- */
  { match: /^manta$/, kit: "Manta", length: 630, width: 860, height: 200, confidence: "catalogue", note: "Length and wingspan quoted, 12.5 kg.", source: "https://warhammer40k.fandom.com/wiki/Manta" },
  { match: /orca/, kit: "Orca Dropship", length: 400, width: 300, height: 150, confidence: "estimate", source: "not found" },
  { match: /tidewall gunrig/, kit: "Tidewall Gunrig", length: 160, width: 110, height: 100, confidence: "estimate", source: "https://wh40k.lexicanum.com/wiki/Tidewall_Rampart" },
  { match: /tidewall droneport/, kit: "Tidewall Droneport", length: 160, width: 110, height: 60, confidence: "estimate", source: "https://wh40k.lexicanum.com/wiki/Tidewall_Rampart" },
  { match: /drone sentry turret/, kit: "Drone Sentry Turret", length: 60, width: 60, height: 50, confidence: "estimate", source: "not found" },
  { match: /remote sensor tower/, kit: "Remote Sensor Tower", length: 60, width: 60, height: 110, confidence: "estimate", source: "not found" },
  { match: /sagitaur/, kit: "Sagitaur", length: 137, width: 78, height: 75, confidence: "catalogue", note: "Tray cutout 137 by 78, 80 deep.", source: "https://www.feldherr.com/products/hs090a010-feldherr-schaumstoffeinlage-fur-konglomerate-der-votann-5-facher" },
  { match: /hekaton/, kit: "Hekaton Land Fortress", length: 175, width: 120, height: 95, confidence: "estimate", note: "Height from a 110 mm tray.", source: "https://www.feldherr.net/hs120a016-feldherr-foam-tray-for-leagues-of-votann/a-63708" },
  { match: /goliath/, kit: "Goliath Truck, Goliath Rockgrinder", length: 150, width: 80, height: 90, confidence: "catalogue", note: "Tray cutout 150 by 79 by 90.", source: FELDHERR_GSC },
  { match: /tectonic fragdrill/, kit: "Tectonic Fragdrill", length: 130, width: 130, height: 170, confidence: "estimate", source: "not found" },
  { match: /hierophant/, kit: "Hierophant Bio-Titan", length: 300, width: 250, height: 255, confidence: "catalogue", note: "About 10 inches tall; footprint estimated.", source: "https://miniset.net/sets/gw-99590106012" },

  /* ---- fortifications and base-less creatures ----------------------------------------------- */
  { match: /wall of martyrs bunker/, kit: "Wall of Martyrs Imperial Bunker", length: 260, width: 190, height: 87, confidence: "catalogue", note: "From a replica sold as a drop-in match.", source: "https://bitsofwar.com/imperial-planetary-outpost/1437-imperial-martyrs-bunker.html" },
  { match: /wall of martyrs defence emplacement/, kit: "Wall of Martyrs Defence Emplacement", length: 180, width: 150, height: 40, confidence: "estimate", source: "not found" },
  { match: /skyshield/, kit: "Skyshield Landing Pad", length: 292, width: 292, height: 76, confidence: "measured", note: "11.5 inches across with the sides up, 15 with them down; 3 inches to the deck.", source: "https://www.40konline.com/index.php?topic=224692.0" },
  { match: /void shield generator/, kit: "Void Shield Generator", length: 150, width: 150, height: 165, confidence: "estimate", source: "not found" },
  { match: /^bastion$/, kit: "Imperial Bastion", length: 145, width: 145, height: 185, confidence: "measured", note: "Owner quotes a 14.5 cm square base and 18.5 cm tall.", source: "https://www.librarium-online.com/threads/imperial-bastion-rough-dimensions.223122/" },
  { match: /firestorm redoubt/, kit: "Firestorm Redoubt", length: 270, width: 190, height: 180, confidence: "estimate", source: "not found" },
  { match: /primaris redoubt/, kit: "Primaris Redoubt", length: 300, width: 300, height: 150, confidence: "estimate", source: "not found" },
  { match: /plasma obliterator/, kit: "Plasma Obliterator", length: 180, width: 180, height: 230, confidence: "estimate", source: "not found" },
  { match: /vengeance weapon battery/, kit: "Vengeance Weapon Battery (one)", length: 90, width: 90, height: 75, confidence: "estimate", source: "https://tablestandard.com/2018/03/21/project-update-bastion-and-vengeance-weapon-battery/" },
  { match: /fortress of redemption/, kit: "Fortress of Redemption", length: 635, width: 300, height: 356, confidence: "measured", note: "Owners quote 24 to 26 inches across and 14 to the tower top; depth estimated.", source: "https://www.40konline.com/index.php?topic=192889.0" },
  { match: /aquila strongpoint|vortex missile strongpoint/, kit: "Aquila Strongpoint, Vortex Missile Strongpoint", length: 330, width: 280, height: 180, confidence: "estimate", source: "not found" },
  { match: /castellum stronghold/, kit: "Castellum Stronghold", length: 610, width: 610, height: 150, confidence: "catalogue", note: "Sold as a 24 by 24 inch tile; height estimated.", source: "https://www.belloflostsouls.net/2014/02/castellum-stronghold-forge-world-unboxing.html" },
  { match: /hammerfall bunker/, kit: "Hammerfall Bunker", length: 152, width: 152, height: 102, confidence: "catalogue", note: "6 by 6 by 4 inches from a print sized to the kit.", source: "https://cults3d.com/en/3d-model/game/hammerfall-bunker" },
  { match: /battle sanctum/, kit: "Battle Sanctum", length: 200, width: 160, height: 300, confidence: "measured", note: "Review measured about 30 cm tall; footprint estimated.", source: "https://www.chaosbunker.de/en/2020/04/08/review-warhammer-40-000-adepta-sororitas-battle-sanctum/" },
  { match: /skull altar/, kit: "Skull Altar", length: 150, width: 120, height: 120, confidence: "estimate", source: "not found" },
  { match: /feculent gnarlmaw/, kit: "Feculent Gnarlmaw", length: 100, width: 80, height: 130, confidence: "estimate", source: "not found" },
  { match: /noctilith crown/, kit: "Noctilith Crown", length: 200, width: 80, height: 150, confidence: "estimate", source: "https://www.chaosbunker.de/en/2019/04/02/review-csm-noctilith-crown/" },
  { match: /miasmic malignifier/, kit: "Miasmic Malignifier", length: 150, width: 130, height: 130, confidence: "estimate", source: "not found" },
  { match: /^sentry gun$/, kit: "Sentry Gun", length: 40, width: 40, height: 35, round: true, confidence: "estimate", note: "Taken as the Tarantula-style gun on a 40 mm base.", source: "not found" },
  { match: /breaching robot/, kit: "Breaching Robot", length: 50, width: 50, height: 55, round: true, confidence: "catalogue", note: "50 mm round base.", source: "https://wh40k.lexicanum.com/wiki/Miniatures_(Blackstone_Fortress)" },
  { match: /^ambull$/, kit: "Ambull", length: 60, width: 60, height: 55, round: true, confidence: "catalogue", note: "60 mm round base.", source: "https://wh40k.lexicanum.com/wiki/Miniatures_(Blackstone_Fortress)" },
  { match: /guardian drone/, kit: "Guardian Drone", length: 60, width: 60, height: 60, round: true, confidence: "catalogue", note: "60 mm round base.", source: "https://wh40k.lexicanum.com/wiki/Guardian_Drone_(Blackstone_Fortress)" },
  { match: /the archivist/, kit: "The Archivist", length: 40, width: 40, height: 45, round: true, confidence: "catalogue", note: "40 mm round base.", source: "https://www.warhammer-community.com/en-gb/articles/j9nMHemR/blackstone-fortress-ascension-the-new-models/" },
];

/** Every row, for listing and for tests. */
export const HULL_SIZES: readonly HullSize[] = HULLS;

/** The kit a name stands for, or nothing when no row matches. */
export function hullSizeFor(name: string): HullSize | undefined {
  const lower = name.trim().toLowerCase();
  return HULLS.find((row) => row.match.test(lower));
}

/** The kit one model of a datasheet stands for: its own profile's name first, the datasheet's second. */
export function hullSizeOfModel(datasheetName: string, profileName: string | undefined): HullSize | undefined {
  return (profileName ? hullSizeFor(profileName) : undefined) ?? hullSizeFor(datasheetName);
}
