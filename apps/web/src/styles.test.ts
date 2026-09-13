import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const css = readFileSync(fileURLToPath(new URL("./styles.css", import.meta.url)), "utf8");

/** The declarations of the first rule whose selector list contains `selector`. */
function ruleFor(selector: string): string {
  const at = css.indexOf(selector);
  expect(at, `no rule for ${selector}`).toBeGreaterThan(-1);
  return css.slice(css.indexOf("{", at) + 1, css.indexOf("}", at));
}

describe("dialog width", () => {
  /*
   * A `<dialog>` paints the panel, and `.dialog-inner` only lays out what is in it. Narrowing the
   * inner left the confirm's panel at the general 520px with its contents stopping 100px short of
   * the right edge, so the box had a margin down one side and not the other. Every confirm in the
   * app used it.
   */
  it("is set on the dialog rather than on the box inside it", () => {
    expect(ruleFor("dialog.dialog.confirm-dialog")).toMatch(/width:/);
    expect(ruleFor(".dialog-inner")).not.toMatch(/width:/);
    expect(css).not.toMatch(/\.dialog-inner\s*\{[^}]*\bwidth:/);
  });

  it("keeps the confirm narrower than a general dialog", () => {
    const general = /width:\s*min\(\s*\d+vw\s*,\s*(\d+)px\s*\)/.exec(ruleFor("dialog.dialog {"))?.[1];
    const confirm = /width:\s*min\(\s*\d+vw\s*,\s*(\d+)px\s*\)/.exec(ruleFor("dialog.dialog.confirm-dialog"))?.[1];
    expect(Number(confirm)).toBeLessThan(Number(general));
  });
});
