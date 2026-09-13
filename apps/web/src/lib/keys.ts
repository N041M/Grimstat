/**
 * How a keyboard shortcut is written for the reader in front of it.
 *
 * A Mac keyboard prints its modifiers as symbols and a Windows keyboard spells them out, and the
 * Command key is not on a Windows keyboard at all. Every shortcut in the app already answers to
 * Command and to Control, so what changes here is only what the hint says.
 */
const mac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent);

/** In front of a letter, as in `⌘K` or `Ctrl+K`. */
export const MOD = mac ? "⌘" : "Ctrl+";
/** On its own in a sentence, as in "holding ⌘" or "holding Ctrl". */
export const MOD_NAME = mac ? "⌘" : "Ctrl";
/** In front of another key, as in `⇧2"` or `Shift+2"`. */
export const SHIFT = mac ? "⇧" : "Shift+";
/** The key that removes what is selected. */
export const DELETE_KEY = mac ? "⌫" : "Backspace";
/** The key that runs whatever is highlighted. */
export const ENTER = mac ? "↵" : "Enter";
