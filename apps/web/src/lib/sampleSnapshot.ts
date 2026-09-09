import type { Ability, Datasheet, Faction, PriceRule, Snapshot } from "@grimstat/schema";
import { gameSystem } from "@grimstat/game-40k-11e";

/**
 * TEMPORARY local fallback used until `@grimstat/snapshot` exports `loadSyntheticSnapshot()`.
 * Entirely synthetic: invented names, illustrative numbers, no Games Workshop text or data.
 */

const FIXED_DATE = "2026-09-09T00:00:00.000Z";
const GS = gameSystem.id;

const factions: Faction[] = [
  { id: "f-test-legion", gameSystemId: GS, name: "Test Legion", keywords: ["TEST LEGION"] },
  { id: "f-test-swarm", gameSystemId: GS, name: "Test Swarm", keywords: ["TEST SWARM"] },
];

const abilities: Ability[] = [
  { id: "ab-focus-fire", name: "Focus Fire", scope: "datasheet", text: "Each time a model in this unit makes a ranged attack, you can re-roll a hit roll of 1.", factionId: "f-test-legion", isLegends: false },
  { id: "ab-warcry", name: "War Cry", scope: "datasheet", text: "While this model is leading a unit, add 1 to wound rolls for melee weapons in that unit.", factionId: "f-test-legion", isLegends: false },
  { id: "ab-leader", name: "Leader", scope: "core", text: "This model can be attached to a unit.", coreKeyword: "LEADER", isLegends: false },
  { id: "ab-hardened", name: "Hardened Plating", scope: "datasheet", text: "Feel No Pain 6+", factionId: "f-test-legion", isLegends: false },
  { id: "ab-field-medic", name: "Field Medic", scope: "datasheet", text: "Models in the supported unit have Feel No Pain 5+.", coreKeyword: "FEEL NO PAIN", coreValue: 5, factionId: "f-test-legion", isLegends: false },
  { id: "ab-battle-lore", name: "Battle Lore", scope: "datasheet", text: "Once per battle this unit may perform an action after shooting (narrative flavour; not part of the attack sequence).", factionId: "f-test-legion", isLegends: false },
  { id: "ab-armoured-hull", name: "Armoured Hull", scope: "datasheet", text: "Each time an attack with Damage 1 targets this model, subtract 1 from the hit roll.", factionId: "f-test-legion", isLegends: false },
  { id: "ab-deadly-demise", name: "Deadly Demise", scope: "core", text: "Explodes when destroyed.", coreKeyword: "DEADLY DEMISE", coreValue: "D3", isLegends: false },
  { id: "ab-ward-field", name: "Ward Field", scope: "datasheet", text: "Models in this unit have a 4+ invulnerable save.", coreKeyword: "INVULNERABLE SAVE", coreValue: 4, factionId: "f-test-legion", isLegends: false },
  { id: "ab-mob-rule", name: "Mob Rule", scope: "datasheet", text: "While this unit contains 10 or more models it has Feel No Pain 6+.", factionId: "f-test-swarm", isLegends: false },
  { id: "ab-bellow", name: "Bellow", scope: "datasheet", text: "While this model is leading a unit, add 1 to hit rolls for melee weapons in that unit.", factionId: "f-test-swarm", isLegends: false },
  { id: "ab-frenzy", name: "Frenzy", scope: "datasheet", text: "Once per battle, this unit can fight again (needs manual handling).", factionId: "f-test-swarm", isLegends: false },
  { id: "ab-regeneration", name: "Regeneration", scope: "datasheet", text: "At the start of your Command phase this model regains up to D3 lost wounds.", factionId: "f-test-swarm", isLegends: false },
];

function ds(d: Omit<Datasheet, "gameSystemId" | "isLegends" | "isEpicHero" | "isBattleline" | "isSupport" | "isCharacter" | "factionKeywords" | "abilityIds" | "leaderTo" | "supportTo" | "composition" | "wargearOptions" | "keywords" | "weapons"> & Partial<Datasheet>): Datasheet {
  return {
    gameSystemId: GS,
    isLegends: false,
    isEpicHero: false,
    isBattleline: false,
    isSupport: false,
    isCharacter: false,
    keywords: [],
    factionKeywords: [],
    weapons: [],
    abilityIds: [],
    leaderTo: [],
    supportTo: [],
    composition: [],
    wargearOptions: [],
    ...d,
  };
}

const datasheets: Datasheet[] = [
  ds({
    id: "ds-test-marine-squad",
    factionId: "f-test-legion",
    name: "Test Marine Squad",
    role: "Battleline",
    isBattleline: true,
    keywords: ["INFANTRY", "BATTLELINE"],
    factionKeywords: ["TEST LEGION"],
    models: [
      { id: "m-test-sergeant", name: "Test Sergeant", M: 6, T: 5, Sv: 3, W: 2, Ld: 6, OC: 2 },
      { id: "m-test-marine", name: "Test Marine", M: 6, T: 5, Sv: 3, W: 2, Ld: 6, OC: 2 },
    ],
    weapons: [
      { id: "w-test-rifle", name: "Test rifle", kind: "ranged", range: 24, A: "2", skill: 3, S: 4, AP: 1, D: "1", keywords: [{ name: "RAPID FIRE", value: 1, raw: "Rapid Fire 1" }] },
      { id: "w-test-launcher", name: "Test launcher", kind: "ranged", range: 36, A: "D6", skill: 3, S: 5, AP: 1, D: "1", keywords: [{ name: "BLAST", raw: "Blast" }], groupName: "Test launcher" },
      { id: "w-test-pistol", name: "Test pistol", kind: "ranged", range: 12, A: "1", skill: 3, S: 4, AP: 0, D: "1", keywords: [{ name: "PISTOL", raw: "Pistol" }] },
      { id: "w-test-blade", name: "Test blade", kind: "melee", range: null, A: "3", skill: 3, S: 4, AP: 0, D: "1", keywords: [] },
    ],
    abilityIds: ["ab-focus-fire", "ab-battle-lore"],
    composition: [{ description: "1 Test Sergeant and 4-9 Test Marines", min: 5, max: 10 }],
  }),
  ds({
    id: "ds-test-captain",
    factionId: "f-test-legion",
    name: "Test Captain",
    role: "Character",
    isCharacter: true,
    keywords: ["CHARACTER", "INFANTRY"],
    factionKeywords: ["TEST LEGION"],
    models: [{ id: "m-test-captain", name: "Test Captain", M: 6, T: 5, Sv: 3, InvSv: 4, W: 5, Ld: 6, OC: 1 }],
    weapons: [
      { id: "w-test-plasma-pistol", name: "Test plasma pistol", kind: "ranged", range: 12, A: "1", skill: 2, S: 7, AP: 2, D: "1", keywords: [{ name: "PISTOL", raw: "Pistol" }] },
      { id: "w-test-power-sword", name: "Test power sword", kind: "melee", range: null, A: "6", skill: 2, S: 5, AP: 2, D: "2", keywords: [] },
    ],
    abilityIds: ["ab-leader", "ab-warcry"],
    leaderTo: ["ds-test-marine-squad", "ds-test-terminator-squad"],
    composition: [{ description: "1 Test Captain", min: 1, max: 1 }],
    fallbackPoints: 80,
  }),
  ds({
    id: "ds-test-medic",
    factionId: "f-test-legion",
    name: "Test Medic",
    role: "Character",
    isCharacter: true,
    isSupport: true,
    keywords: ["CHARACTER", "INFANTRY"],
    factionKeywords: ["TEST LEGION"],
    models: [{ id: "m-test-medic", name: "Test Medic", M: 6, T: 5, Sv: 3, W: 4, Ld: 6, OC: 1 }],
    weapons: [{ id: "w-test-medic-pistol", name: "Test pistol", kind: "ranged", range: 12, A: "1", skill: 3, S: 4, AP: 0, D: "1", keywords: [{ name: "PISTOL", raw: "Pistol" }] }],
    abilityIds: ["ab-field-medic"],
    supportTo: ["ds-test-marine-squad"],
    composition: [{ description: "1 Test Medic", min: 1, max: 1 }],
    fallbackPoints: 55,
  }),
  ds({
    id: "ds-test-terminator-squad",
    factionId: "f-test-legion",
    name: "Test Heavy Squad",
    role: "Infantry",
    keywords: ["INFANTRY"],
    factionKeywords: ["TEST LEGION"],
    models: [{ id: "m-test-heavy", name: "Test Heavy Trooper", M: 5, T: 5, Sv: 2, InvSv: 4, W: 3, Ld: 6, OC: 1 }],
    weapons: [
      { id: "w-test-storm-rifle", name: "Test storm rifle", kind: "ranged", range: 24, A: "2", skill: 3, S: 4, AP: 1, D: "2", keywords: [{ name: "LETHAL HITS", raw: "Lethal Hits" }] },
      { id: "w-test-beam", name: "Test beam cannon", kind: "ranged", range: 36, A: "1", skill: 3, S: 9, AP: 3, D: "D6+1", keywords: [{ name: "HEAVY", raw: "Heavy" }] },
      { id: "w-test-fist", name: "Test power fist", kind: "melee", range: null, A: "3", skill: 3, S: 8, AP: 2, D: "2", keywords: [] },
    ],
    abilityIds: ["ab-ward-field", "ab-battle-lore"],
    composition: [{ description: "5-10 Test Heavy Troopers", min: 5, max: 10 }],
  }),
  ds({
    id: "ds-test-tank",
    factionId: "f-test-legion",
    name: "Test Tank",
    role: "Vehicle",
    keywords: ["VEHICLE"],
    factionKeywords: ["TEST LEGION"],
    models: [{ id: "m-test-tank", name: "Test Tank", M: 10, T: 11, Sv: 2, W: 14, Ld: 6, OC: 3 }],
    weapons: [
      { id: "w-test-cannon", name: "Test battle cannon", kind: "ranged", range: 48, A: "D6+3", skill: 3, S: 9, AP: 2, D: "3", keywords: [{ name: "BLAST", raw: "Blast" }] },
      { id: "w-test-melta-cannon", name: "Test melta cannon", kind: "ranged", range: 18, A: "2", skill: 3, S: 10, AP: 4, D: "D6", keywords: [{ name: "MELTA", value: 2, raw: "Melta 2" }], groupName: "Test main gun" },
      { id: "w-test-stubber", name: "Test stubber", kind: "ranged", range: 36, A: "3", skill: 3, S: 4, AP: 0, D: "1", keywords: [{ name: "SUSTAINED HITS", value: 1, raw: "Sustained Hits 1" }] },
      { id: "w-test-tracks", name: "Test tracks", kind: "melee", range: null, A: "3", skill: 4, S: 6, AP: 0, D: "1", keywords: [] },
    ],
    abilityIds: ["ab-armoured-hull", "ab-deadly-demise"],
    composition: [{ description: "1 Test Tank", min: 1, max: 1 }],
  }),
  ds({
    id: "ds-test-mob",
    factionId: "f-test-swarm",
    name: "Test Mob",
    role: "Battleline",
    isBattleline: true,
    keywords: ["INFANTRY", "BATTLELINE"],
    factionKeywords: ["TEST SWARM"],
    models: [
      { id: "m-test-mob-boss", name: "Test Mob Boss", M: 6, T: 5, Sv: 5, W: 2, Ld: 7, OC: 2 },
      { id: "m-test-mob-grunt", name: "Test Grunt", M: 6, T: 5, Sv: 5, W: 1, Ld: 7, OC: 2 },
    ],
    weapons: [
      { id: "w-test-slugga", name: "Test slug pistol", kind: "ranged", range: 12, A: "1", skill: 5, S: 4, AP: 0, D: "1", keywords: [{ name: "PISTOL", raw: "Pistol" }] },
      { id: "w-test-choppa", name: "Test cleaver", kind: "melee", range: null, A: "3", skill: 3, S: 4, AP: 1, D: "1", keywords: [] },
    ],
    abilityIds: ["ab-mob-rule", "ab-frenzy"],
    composition: [{ description: "1 Test Mob Boss and 9-19 Test Grunts", min: 10, max: 20 }],
  }),
  ds({
    id: "ds-test-big-boss",
    factionId: "f-test-swarm",
    name: "Test Big Boss",
    role: "Character",
    isCharacter: true,
    keywords: ["CHARACTER", "INFANTRY"],
    factionKeywords: ["TEST SWARM"],
    models: [{ id: "m-test-big-boss", name: "Test Big Boss", M: 6, T: 6, Sv: 4, InvSv: 5, W: 6, Ld: 6, OC: 1 }],
    weapons: [{ id: "w-test-big-cleaver", name: "Test big cleaver", kind: "melee", range: null, A: "5", skill: 2, S: 8, AP: 2, D: "2", keywords: [] }],
    abilityIds: ["ab-leader", "ab-bellow"],
    leaderTo: ["ds-test-mob"],
    composition: [{ description: "1 Test Big Boss", min: 1, max: 1 }],
    fallbackPoints: 70,
  }),
  ds({
    id: "ds-test-monster",
    factionId: "f-test-swarm",
    name: "Test Monster",
    role: "Monster",
    keywords: ["MONSTER"],
    factionKeywords: ["TEST SWARM"],
    models: [{ id: "m-test-monster", name: "Test Monster", M: 8, T: 10, Sv: 3, InvSv: 5, W: 16, Ld: 7, OC: 4 }],
    weapons: [
      { id: "w-test-spines", name: "Test spine volley", kind: "ranged", range: 18, A: "D6", skill: 4, S: 6, AP: 1, D: "2", keywords: [{ name: "BLAST", raw: "Blast" }] },
      { id: "w-test-claws", name: "Test claws", kind: "melee", range: null, A: "6", skill: 3, S: 10, AP: 2, D: "3", keywords: [{ name: "DEVASTATING WOUNDS", raw: "Devastating Wounds" }] },
    ],
    abilityIds: ["ab-regeneration", "ab-hardened"],
    composition: [{ description: "1 Test Monster", min: 1, max: 1 }],
  }),
];

const priceRules: PriceRule[] = [
  { datasheetId: "ds-test-marine-squad", copyRange: { min: 1 }, tiers: [{ models: 5, points: 85 }, { models: 10, points: 170 }] },
  { datasheetId: "ds-test-terminator-squad", copyRange: { min: 1 }, tiers: [{ models: 5, points: 180 }, { models: 10, points: 360 }] },
  { datasheetId: "ds-test-tank", copyRange: { min: 1 }, tiers: [{ models: 1, points: 160 }] },
  { datasheetId: "ds-test-mob", copyRange: { min: 1 }, tiers: [{ models: 10, points: 80 }, { models: 20, points: 160 }] },
  { datasheetId: "ds-test-monster", copyRange: { min: 1 }, tiers: [{ models: 1, points: 200 }] },
];

/** FNV-1a 32-bit hex of a string: a stable, dependency-free stand-in for the real SHA-256 checksum. */
function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `fnv1a-${h.toString(16).padStart(8, "0")}`;
}

export function loadFallbackSyntheticSnapshot(): Snapshot {
  const data: Snapshot["data"] = {
    gameSystem,
    factions,
    publications: [],
    datasheets,
    abilities,
    detachments: [],
    enhancements: [],
    stratagems: [],
    priceRules,
    wargearPrices: [],
  };
  return {
    id: "synthetic-sample",
    gameSystemId: GS,
    label: "Synthetic sample (built-in)",
    ownerId: "local",
    createdAt: FIXED_DATE,
    updatedAt: FIXED_DATE,
    revision: 0,
    sources: [{ adapter: "synthetic", fetchedAt: FIXED_DATE, notes: "Built-in synthetic sample; invented names and numbers, no Games Workshop data." }],
    checksum: fnv1a(JSON.stringify(data)),
    conflicts: [],
    data,
  };
}
