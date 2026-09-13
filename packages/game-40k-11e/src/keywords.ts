import { KeywordRegistry, evaluateCondition, targetKeywordCondition } from "@grimstat/effects";
import { CH } from "./channels";
import { RULES, type RulesParams } from "./manifest";

function numVal(v: number | string | undefined, fallback = 1): number {
  if (typeof v === "number") return v;
  if (typeof v === "string" && /^\d+$/.test(v)) return Number(v);
  return fallback;
}

/**
 * Tier-1 weapon keywords of 11th edition. Each handler translates a keyword into modifiers/flags.
 * A keyword printed with a condition ("LETHAL HITS: non-MONSTER/VEHICLE") arrives with the target
 * keywords on `kw.keyword`; the registry gates the handler on them, so handlers below need not.
 * ANTI-X is the exception: it reads `kw.keyword` as its own target and is registered as such.
 */
export function create11eKeywordRegistry(rules: RulesParams = RULES): KeywordRegistry {
  const r = new KeywordRegistry();

  r.register("RAPID FIRE", (kw, c) => {
    if (c.rangeBand === "half") c.mods.add({ channel: CH.attacks, op: "add", value: numVal(kw.value), source: "Rapid Fire" });
  });
  r.register("BLAST", (_kw, c) => {
    const bonus = Math.floor(c.targetModelCount / rules.blastPerModels);
    if (bonus > 0) c.mods.add({ channel: CH.attacks, op: "add", value: bonus, source: "Blast" });
  });
  r.register("CLEAVE", (kw, c) => {
    // An edition without the ability still has to say so. Dropping the keyword quietly would give the
    // weapon its printed attacks and no sign that a line of its profile went unread.
    if (!rules.cleave) {
      c.warnings.push("CLEAVE is not an ability in this edition.");
      return;
    }
    if (c.weaponKind !== "melee") return;
    const bonus = Math.floor(c.targetModelCount / rules.blastPerModels) * numVal(kw.value);
    if (bonus > 0) c.mods.add({ channel: CH.attacks, op: "add", value: bonus, source: "Cleave" });
  });
  r.register("HEAVY", (_kw, c) => {
    if (c.stationary) c.mods.add({ channel: CH.hitRoll, op: "add", value: 1, source: "Heavy" });
  });
  r.register("TORRENT", (_kw, c) => c.mods.add({ channel: CH.autoHit, op: "flag", value: true, source: "Torrent" }));
  r.register("TWIN-LINKED", (_kw, c) => c.mods.add({ channel: CH.rerollWound, op: "reroll", value: "failed", source: "Twin-linked" }));
  r.register("LETHAL HITS", (_kw, c) => c.mods.add({ channel: CH.lethal, op: "flag", value: true, source: "Lethal Hits" }));
  r.register("SUSTAINED HITS", (kw, c) => {
    const v = kw.value ?? 1;
    c.mods.add({ channel: CH.sustained, op: "set", value: typeof v === "string" && !/^\d+$/.test(v) ? v : numVal(v), source: "Sustained Hits" });
  });
  r.register("DEVASTATING WOUNDS", (_kw, c) => c.mods.add({ channel: CH.devastating, op: "flag", value: true, source: "Devastating Wounds" }));
  r.register(
    "ANTI",
    (kw, c) => {
      const target = (kw.keyword ?? "").toUpperCase();
      const cond = targetKeywordCondition(target);
      if (!cond || !evaluateCondition(cond, c)) return;
      c.mods.add({ channel: CH.critWound, op: "cap", value: numVal(kw.value, 6), source: `Anti-${target} ${numVal(kw.value, 6)}+` });
    },
    { ownsKeyword: true },
  );
  r.register("MELTA", (kw, c) => {
    if (c.rangeBand === "half") c.mods.add({ channel: CH.damage, op: "add", value: numVal(kw.value), source: "Melta" });
  });
  r.register("LANCE", (_kw, c) => {
    if (c.charged && c.weaponKind === "melee") c.mods.add({ channel: CH.woundRoll, op: "add", value: 1, source: "Lance" });
  });
  r.register("HAZARDOUS", (_kw, c) => c.mods.add({ channel: CH.hazardous, op: "flag", value: true, source: "Hazardous" }));
  r.register("PRECISION", (_kw, c) => c.mods.add({ channel: CH.precision, op: "flag", value: true, source: "Precision" }));
  r.register("IGNORES COVER", (_kw, c) => c.mods.add({ channel: CH.ignoresCover, op: "flag", value: true, source: "Ignores Cover" }));
  r.register("PSYCHIC", (_kw, c) => c.mods.add({ channel: CH.psychic, op: "flag", value: true, source: "Psychic" }));
  r.register("INDIRECT FIRE", (_kw, c) => c.mods.add({ channel: CH.indirect, op: "flag", value: true, source: "Indirect Fire" }));
  r.register("CONVERSION", (_kw, c) => {
    if (c.rangeBand === "full") c.mods.add({ channel: CH.critHit, op: "cap", value: 4, source: "Conversion" });
  });
  // Keywords with no effect on the attack maths
  r.registerInert("ASSAULT", "PISTOL", "CLOSE-QUARTERS", "EXTRA ATTACKS", "ONE SHOT", "LINKED FIRE", "DEADLY DEMISE");
  return r;
}
