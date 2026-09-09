/** Value parsers shared by the stat-bearing adapters (Wahapedia CSV, BSData JSON). */

/** "3+" -> 3, "3" -> 3, "N/A" / "-" / "" -> null. */
export function parseTargetNumber(v: string | undefined | null): number | null {
  if (v === undefined || v === null) return null;
  const s = v.trim();
  if (!s || s === "-" || /^n\/?a$/i.test(s)) return null;
  const m = /^(\d+)\s*\+?\s*\*?$/.exec(s);
  return m ? Number(m[1]) : null;
}

/** "6\"" -> 6, "6" -> 6, "-" -> null. */
export function parseInches(v: string | undefined | null): number | null {
  if (v === undefined || v === null) return null;
  const s = v.trim().replace(/["”″]/g, "");
  if (!s || s === "-" || /^n\/?a$/i.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Weapon range: "24\"" -> {kind:'ranged', range:24}; "Melee" -> {kind:'melee', range:null}. */
export function parseWeaponRange(v: string | undefined | null): { kind: "ranged" | "melee"; range: number | null } {
  const s = (v ?? "").trim();
  if (/^melee$/i.test(s)) return { kind: "melee", range: null };
  return { kind: "ranged", range: parseInches(s) };
}

/** "-2" -> 2, "0" -> 0, "-0" -> 0, "2" -> 2 (AP is stored as a magnitude). */
export function parseAP(v: string | undefined | null): number | null {
  if (v === undefined || v === null) return null;
  const s = v.trim();
  if (!s || s === "-") return null;
  const m = /^[-–]?\s*(\d+)$/.exec(s);
  return m ? Number(m[1]) : null;
}

/** Plain integer: "5" -> 5, "5 " -> 5, "-" -> null. */
export function parseInt0(v: string | undefined | null): number | null {
  if (v === undefined || v === null) return null;
  const s = v.trim();
  if (!s || s === "-") return null;
  const m = /^(\d+)$/.exec(s);
  return m ? Number(m[1]) : null;
}

const DICE_RE = /^\s*(\d+)?[dD]?(3|6)?\s*([+-]\s*\d+)?\s*$/;

/**
 * Dice expression as accepted by the schema (`DiceExpr`): "3" -> 3 (number), "D6" -> "D6", "D6+1" -> "D6+1",
 * "2D6" -> "2D6". Returns null for "-", "", "N/A" or anything unparseable.
 */
export function parseDice(v: string | undefined | null): number | string | null {
  if (v === undefined || v === null) return null;
  const s = v.trim().replace(/\s+/g, "").toUpperCase();
  if (!s || s === "-" || s === "N/A") return null;
  if (/^\d+$/.test(s)) return Number(s);
  if (!s.includes("D")) return null;
  if (!DICE_RE.test(s)) return null;
  return s;
}

/** "4+" -> 4, "4" -> 4, "4*" -> 4, "" / "-" -> null. */
export const parseInvSave = parseTargetNumber;
