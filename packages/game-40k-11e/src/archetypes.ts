import type { Archetype, ScenarioUnit } from "@grimstat/schema";

/** Generic defender/attacker presets. Profiles are illustrative numbers, not any specific datasheet. */
function unit(name: string, models: ScenarioUnit["models"], weapons: ScenarioUnit["weapons"] = [], keywords: string[] = [], points?: number): ScenarioUnit {
  return { name, keywords, models, weapons, effects: [], ...(points !== undefined ? { points } : {}) };
}

export const archetypes: Archetype[] = [
  { id: "guardsman-like", name: "Light infantry squad (T3 5+ W1 ×10)", unit: unit("Light infantry ×10", [{ name: "Trooper", count: 10, T: 3, Sv: 5, W: 1, isCharacter: false, keywords: [] }], [], ["INFANTRY"], 60) },
  { id: "horde-like", name: "Horde (T4 6+ W1 ×20)", unit: unit("Horde ×20", [{ name: "Boy", count: 20, T: 4, Sv: 6, W: 1, isCharacter: false, keywords: [] }], [], ["INFANTRY"], 160) },
  { id: "marine-like", name: "Power-armour squad (T4 3+ W2 ×5)", unit: unit("Power armour ×5", [{ name: "Marine", count: 5, T: 4, Sv: 3, W: 2, isCharacter: false, keywords: [] }], [], ["INFANTRY"], 90) },
  { id: "marine-11e-like", name: "Power-armour squad, 11e stats (T5 3+ W2 ×5)", unit: unit("Power armour (11e) ×5", [{ name: "Marine", count: 5, T: 5, Sv: 3, W: 2, isCharacter: false, keywords: [] }], [], ["INFANTRY"], 95) },
  { id: "terminator-like", name: "Heavy elite (T5 2+ 4++ W3 ×5)", unit: unit("Heavy elite ×5", [{ name: "Elite", count: 5, T: 5, Sv: 2, InvSv: 4, W: 3, isCharacter: false, keywords: [] }], [], ["INFANTRY"], 180) },
  { id: "custodian-like", name: "Super elite (T6 2+ 4++ W3 ×4)", unit: unit("Super elite ×4", [{ name: "Elite", count: 4, T: 6, Sv: 2, InvSv: 4, W: 3, isCharacter: false, keywords: [] }], [], ["INFANTRY"], 200) },
  { id: "daemon-like", name: "Ethereal horde (T4 7+ 5++ FNP 6+ W1 ×10)", unit: unit("Ethereal ×10", [{ name: "Daemon", count: 10, T: 4, Sv: 7, InvSv: 5, W: 1, fnp: 6, isCharacter: false, keywords: [] }], [], ["INFANTRY", "DAEMON"], 120) },
  { id: "light-vehicle", name: "Light vehicle (T9 3+ W10)", unit: unit("Light vehicle", [{ name: "Vehicle", count: 1, T: 9, Sv: 3, W: 10, isCharacter: false, keywords: [] }], [], ["VEHICLE"], 80) },
  { id: "heavy-tank", name: "Heavy tank (T11 2+ W14)", unit: unit("Heavy tank", [{ name: "Tank", count: 1, T: 11, Sv: 2, W: 14, isCharacter: false, keywords: [] }], [], ["VEHICLE"], 180) },
  { id: "monster", name: "Monster (T10 3+ 5++ W16)", unit: unit("Monster", [{ name: "Monster", count: 1, T: 10, Sv: 3, InvSv: 5, W: 16, isCharacter: false, keywords: [] }], [], ["MONSTER"], 200) },
  { id: "knight-like", name: "Super-heavy walker (T12 3+ 5++ W22)", unit: unit("Super-heavy walker", [{ name: "Walker", count: 1, T: 12, Sv: 3, InvSv: 5, W: 22, isCharacter: false, keywords: [] }], [], ["VEHICLE", "WALKER", "TITANIC"], 400) },
  {
    id: "led-squad",
    name: "Squad with attached character (T4 3+ W2 ×5 + T4 3+ 4++ W5 character)",
    unit: unit(
      "Led squad",
      [
        { name: "Marine", count: 5, T: 4, Sv: 3, W: 2, isCharacter: false, keywords: [] },
        { name: "Captain", count: 1, T: 4, Sv: 3, InvSv: 4, W: 5, isCharacter: true, keywords: ["CHARACTER"] },
      ],
      [],
      ["INFANTRY", "CHARACTER"],
      170,
    ),
  },
  {
    id: "bolter-squad",
    name: "Attacker: 10 × rapid-fire bolt rifles (A1 BS3+ S4 AP0 D1, Rapid Fire 1)",
    unit: unit("Bolt rifle squad ×10", [{ name: "Marine", count: 10, T: 4, Sv: 3, W: 2, isCharacter: false, keywords: [] }], [
      { name: "Bolt rifle", count: 10, kind: "ranged", range: 24, A: "1", skill: 3, S: 4, AP: 0, D: "1", keywords: [{ name: "RAPID FIRE", value: 1, raw: "Rapid Fire 1" }], enabled: true },
    ], ["INFANTRY"], 160),
  },
  {
    id: "lascannon-team",
    name: "Attacker: 3 × lascannon-like (A1 BS3+ S12 AP-3 D D6+1)",
    unit: unit("Heavy weapon team ×3", [{ name: "Gunner", count: 3, T: 3, Sv: 5, W: 2, isCharacter: false, keywords: [] }], [
      { name: "Lascannon", count: 3, kind: "ranged", range: 48, A: "1", skill: 3, S: 12, AP: 3, D: "D6+1", keywords: [{ name: "HEAVY", raw: "Heavy" }], enabled: true },
    ], ["INFANTRY"], 90),
  },
  {
    id: "melta-squad",
    name: "Attacker: 5 × melta (A1 BS3+ S9 AP-4 D D6, Melta 2)",
    unit: unit("Melta squad ×5", [{ name: "Trooper", count: 5, T: 4, Sv: 3, W: 2, isCharacter: false, keywords: [] }], [
      { name: "Meltagun", count: 5, kind: "ranged", range: 12, A: "1", skill: 3, S: 9, AP: 4, D: "D6", keywords: [{ name: "MELTA", value: 2, raw: "Melta 2" }], enabled: true },
    ], ["INFANTRY"], 110),
  },
  {
    id: "chainsword-mob",
    name: "Attacker: 20 × melee horde (A3 WS3+ S4 AP0 D1)",
    unit: unit("Melee horde ×20", [{ name: "Boy", count: 20, T: 4, Sv: 6, W: 1, isCharacter: false, keywords: [] }], [
      { name: "Choppa", count: 20, kind: "melee", range: null, A: "3", skill: 3, S: 4, AP: 0, D: "1", keywords: [], enabled: true },
    ], ["INFANTRY"], 160),
  },
];
