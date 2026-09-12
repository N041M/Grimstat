/**
 * Deciding what kind of roster file the user just handed us.
 *
 * Four shapes arrive through one dialog: a zipped BattleScribe/New Recruit roster (`.rosz`), the
 * raw XML from inside one (`.ros`), Grimstat's own JSON (the "Export all" envelope or one saved
 * army) and a pasted text list. The first two carry per-model wargear, attached leaders and
 * sub-unit splits that no text export preserves, so they are worth detecting properly rather than
 * guessing from the file extension: plenty of exports arrive renamed, and people paste XML or JSON
 * into the text box.
 */

import { Roster } from "@grimstat/schema";

export type RosterFileKind = "zip" | "xml" | "json" | "text";

/** The `format` field of the envelope "Export all (JSON)" writes. */
export const ROSTER_BUNDLE_FORMAT = "grimstat-rosters";

/** "PK\x03\x04" — every zip starts with it, whatever the file has been renamed to. */
export function isZip(bytes: Uint8Array): boolean {
  return bytes[0] === 0x50 && bytes[1] === 0x4b && (bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07);
}

/** A raw BattleScribe roster: XML with an `<?xml` or `<roster` root, possibly behind a byte-order mark. */
export function looksLikeRosterXml(text: string): boolean {
  return /^\uFEFF?\s*<(\?xml|roster)\b/i.test(text);
}

/** JSON by its first character: an object or array, possibly behind a byte-order mark. */
export function looksLikeJson(text: string): boolean {
  return /^\uFEFF?\s*[{[]/.test(text);
}

export interface RosterJson {
  rosters: Roster[];
  /** Entries of the envelope that did not validate as rosters. */
  skipped: number;
}

/**
 * The rosters in a JSON text: one saved army, or the "Export all" envelope
 * (`{ format: "grimstat-rosters", rosters: [...] }`). Undefined when the text is neither.
 * Envelope entries that fail validation are counted in `skipped` rather than failing the file.
 */
export function rostersFromJson(text: string): RosterJson | undefined {
  let data: unknown;
  try {
    data = JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch {
    return undefined;
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return undefined;
  const single = Roster.safeParse(data);
  if (single.success) return { rosters: [single.data], skipped: 0 };
  const envelope = data as { format?: unknown; rosters?: unknown };
  if (envelope.format !== ROSTER_BUNDLE_FORMAT || !Array.isArray(envelope.rosters)) return undefined;
  const rosters: Roster[] = [];
  let skipped = 0;
  for (const item of envelope.rosters) {
    const parsed = Roster.safeParse(item);
    if (parsed.success) rosters.push(parsed.data);
    else skipped++;
  }
  return { rosters, skipped };
}

/** What to do with a file's bytes, decided from the content rather than the file name. */
export function rosterFileKind(bytes: Uint8Array): RosterFileKind {
  if (isZip(bytes)) return "zip";
  const head = new TextDecoder().decode(bytes.subarray(0, 64));
  if (looksLikeRosterXml(head)) return "xml";
  if (looksLikeJson(head)) return "json";
  return "text";
}
