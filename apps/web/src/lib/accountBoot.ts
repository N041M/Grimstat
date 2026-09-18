/**
 * The one account service the app runs with. Made at start-up and booted before the first render,
 * so a device that was signed in is signed in from the first screen.
 *
 * The question it has to ask, when a device holds another account's records, is answered by the
 * shell's confirm dialog, which does not exist yet when this module loads. The shell installs it.
 */
import { createAccount } from "./accountService";

let ask: (() => Promise<boolean>) | undefined;

export function setAskReplace(fn: () => Promise<boolean>): void {
  ask = fn;
}

export const account = createAccount({ askReplace: () => ask?.() ?? Promise.resolve(false) });
