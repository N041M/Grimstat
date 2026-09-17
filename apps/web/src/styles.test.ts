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

describe("unit table row actions", () => {
  /*
   * The actions hung over the right-hand end of the row before, on top of the status the row was
   * reporting, so the count could be neither read nor clicked with the pointer on the row. The
   * transform that centred the overlay also made it a stacking context, which left the row menu
   * painted under every row below it.
   */
  it("sit in a column of their own rather than over the row", () => {
    const rule = ruleFor(".gtable-cell.ut-actions");
    expect(rule).not.toMatch(/position:\s*absolute/);
    expect(rule).not.toMatch(/transform:/);
  });
});

describe("datasheet tables on a phone", () => {
  /*
   * The name column used to be a share of the table (`2fr`). Once the table is wider than the screen
   * that share is measured against the widest row, so on a unit whose weapons carry long keyword
   * lists the name column grew past half the screen and pushed the stats out of sight. The tab hands
   * the phone a template of its own instead, and the pinned column wraps rather than truncating.
   */
  it("take the narrow column template when the tab gives one", () => {
    const rule = ruleFor(".codex-table .gtable-head,\n  .codex-table .gtable-row");
    expect(rule).toMatch(/grid-template-columns:\s*var\(--gtable-cols-narrow,\s*var\(--gtable-cols\)\)/);
  });

  it("wraps the pinned name column instead of cutting the name", () => {
    expect(css).toMatch(/\.codex-table \.gtable-cell:first-child \{[^}]*white-space:\s*normal/);
  });
});
