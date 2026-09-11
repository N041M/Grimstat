/**
 * Deciding what kind of roster file the user just handed us.
 *
 * Three shapes arrive through one dialog: a zipped BattleScribe/New Recruit roster (`.rosz`), the
 * raw XML from inside one (`.ros`), and a pasted text list. The first two carry per-model wargear,
 * attached leaders and sub-unit splits that no text export preserves, so they are worth detecting
 * properly rather than guessing from the file extension — plenty of exports arrive renamed, and
 * people paste XML into the text box.
 */

export type RosterFileKind = "zip" | "xml" | "text";

/** "PK\x03\x04" — every zip starts with it, whatever the file has been renamed to. */
export function isZip(bytes: Uint8Array): boolean {
  return bytes[0] === 0x50 && bytes[1] === 0x4b && (bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07);
}

/** A raw BattleScribe roster: XML with an `<?xml` or `<roster` root, possibly behind a byte-order mark. */
export function looksLikeRosterXml(text: string): boolean {
  return /^\uFEFF?\s*<(\?xml|roster)\b/i.test(text);
}

/** What to do with a file's bytes. Decided on content, never on the name. */
export function rosterFileKind(bytes: Uint8Array): RosterFileKind {
  if (isZip(bytes)) return "zip";
  return looksLikeRosterXml(new TextDecoder().decode(bytes.subarray(0, 64))) ? "xml" : "text";
}
