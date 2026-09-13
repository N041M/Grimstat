import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ROUTES } from "../router";
import { CARD_GAP, VIEWPORT_MARGIN, clampStep, isLastStep, placeCard, shouldAutoOpen, stepAt, TOUR_SCREEN_COUNT, TOUR_STEPS, type Rect } from "./tour";

const VIEWPORT = { width: 1440, height: 900 };
const CARD = { width: 340, height: 200 };
/** Where a rail item sits on a desktop: a 56px column down the left edge. */
const railItem = (top: number): Rect => ({ left: 0, top, width: 56, height: 38 });

describe("TOUR_STEPS", () => {
  it("visits every screen in the app exactly once", () => {
    const visited = TOUR_STEPS.map((s) => s.route).filter((r) => r !== undefined);
    expect([...visited].sort()).toEqual([...ROUTES].sort());
    expect(new Set(visited).size).toBe(visited.length);
  });

  it("opens with a card that names no screen, so nothing is navigated to before the offer is accepted", () => {
    expect(TOUR_STEPS[0]?.route).toBeUndefined();
    expect(TOUR_STEPS.slice(1).every((s) => s.route !== undefined)).toBe(true);
  });

  it("counts only the screen stops", () => {
    expect(TOUR_SCREEN_COUNT).toBe(TOUR_STEPS.length - 1);
    expect(TOUR_SCREEN_COUNT).toBe(ROUTES.length);
  });

  it("gives every step its own id", () => {
    expect(new Set(TOUR_STEPS.map((s) => s.id)).size).toBe(TOUR_STEPS.length);
  });

  it("sends the reader to the data screen first, because the others are empty until data is loaded", () => {
    expect(TOUR_STEPS[1]?.route).toBe("data");
  });

  /*
   * The highlight travels from the rail item to a control the screen carries, found by its
   * `data-tour` name. Renaming or removing one of those would leave the step stuck on the rail
   * letter with nothing to say it had broken, so the names are checked against the source.
   */
  it("names a control that the app actually marks", () => {
    const src = join(fileURLToPath(new URL(".", import.meta.url)), "..");
    const marked = new Set<string>();
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.tsx?$/.test(name)) {
          // Either `data-tour="x"` or a JSX expression that can carry the name, as the calculator's
          // card does when only one of its two sides is marked.
          for (const m of readFileSync(path, "utf8").matchAll(/data-tour=(?:"([^"]+)"|\{([^}]*)\})/g)) {
            if (m[1]) marked.add(m[1]);
            else for (const q of (m[2] ?? "").matchAll(/"([^"]+)"/g)) marked.add(q[1]!);
          }
        }
      }
    };
    walk(src);
    expect([...TOUR_STEPS].filter((s) => s.focus).map((s) => s.focus).filter((f) => !marked.has(f!))).toEqual([]);
  });
});

describe("clampStep", () => {
  it("keeps an index inside the run of steps", () => {
    expect(clampStep(-4)).toBe(0);
    expect(clampStep(3)).toBe(3);
    expect(clampStep(999)).toBe(TOUR_STEPS.length - 1);
  });

  it("reads a fractional index as the step it is in", () => {
    expect(clampStep(2.7)).toBe(2);
  });
});

describe("stepAt / isLastStep", () => {
  it("answers with a step for any index", () => {
    expect(stepAt(0).id).toBe("welcome");
    expect(stepAt(-1).id).toBe("welcome");
    expect(stepAt(TOUR_STEPS.length + 5)).toBe(TOUR_STEPS[TOUR_STEPS.length - 1]);
  });

  it("knows the last step", () => {
    expect(isLastStep(TOUR_STEPS.length - 1)).toBe(true);
    expect(isLastStep(0)).toBe(false);
  });
});

describe("shouldAutoOpen", () => {
  it("opens on a device with nothing stored that has not seen it", () => {
    expect(shouldAutoOpen(undefined, false)).toBe(true);
  });

  it("stays shut once it has been seen", () => {
    expect(shouldAutoOpen(true, false)).toBe(false);
  });

  it("stays shut on a device that already carries a snapshot or an army", () => {
    expect(shouldAutoOpen(undefined, true)).toBe(false);
  });

  it("treats a stored value that is not true as never seen", () => {
    expect(shouldAutoOpen(false, false)).toBe(true);
    expect(shouldAutoOpen("yes", false)).toBe(true);
    expect(shouldAutoOpen(1, false)).toBe(true);
  });
});

describe("placeCard", () => {
  it("centres the card when there is nothing to point at", () => {
    expect(placeCard(undefined, VIEWPORT, CARD)).toEqual({ left: 550, top: 350, side: "centre", arrow: 0 });
  });

  it("puts the card to the right of a rail item, level with it", () => {
    const p = placeCard(railItem(300), VIEWPORT, CARD);
    expect(p.side).toBe("right");
    expect(p.left).toBe(56 + CARD_GAP);
    expect(p.top).toBe(300 + 19 - 100);
  });

  it("moves to the left of an item that has no room on its right", () => {
    const p = placeCard({ left: 1200, top: 300, width: 56, height: 38 }, VIEWPORT, CARD);
    expect(p.side).toBe("left");
    expect(p.left).toBe(1200 - CARD_GAP - CARD.width);
  });

  it("drops the card under a control too wide to sit beside", () => {
    const toolbar: Rect = { left: 200, top: 120, width: 900, height: 40 };
    const p = placeCard(toolbar, VIEWPORT, CARD);
    expect(p.side).toBe("below");
    expect(p.top).toBe(120 + 40 + CARD_GAP);
    expect(p.left).toBe(650 - CARD.width / 2);
    expect(p.left + p.arrow).toBe(650);
  });

  it("puts the card over a wide control that has no room under it", () => {
    const toolbar: Rect = { left: 200, top: 700, width: 900, height: 40 };
    const p = placeCard(toolbar, VIEWPORT, CARD);
    expect(p.side).toBe("above");
    expect(p.top).toBe(700 - CARD_GAP - CARD.height);
  });

  it("centres the card when no side of the control has room", () => {
    expect(placeCard({ left: 0, top: 0, width: 380, height: 500 }, { width: 380, height: 500 }, CARD).side).toBe("centre");
  });

  it("keeps a card level with a high item inside the window", () => {
    expect(placeCard(railItem(4), VIEWPORT, CARD).top).toBe(VIEWPORT_MARGIN);
  });

  it("keeps a card level with a low item inside the window", () => {
    expect(placeCard(railItem(880), VIEWPORT, CARD).top).toBe(VIEWPORT.height - CARD.height - VIEWPORT_MARGIN);
  });

  it("still answers with a position when the card is taller than the window", () => {
    const p = placeCard(railItem(300), { width: 1440, height: 150 }, CARD);
    expect(p.top).toBe(VIEWPORT_MARGIN);
    expect(p.side).toBe("right");
  });

  it("puts the arrow level with the item the card is beside", () => {
    const p = placeCard(railItem(300), VIEWPORT, CARD);
    expect(p.top + p.arrow).toBe(300 + 19);
    expect(p.arrow).toBe(CARD.height / 2);
  });

  it("walks the arrow up the card when the card has been pushed down off the item", () => {
    const p = placeCard(railItem(40), VIEWPORT, CARD);
    expect(p.top).toBe(VIEWPORT_MARGIN);
    expect(p.top + p.arrow).toBe(40 + 19);
    expect(p.arrow).toBeLessThan(CARD.height / 2);
  });

  it("stops the arrow short of the corner rather than letting it leave the card", () => {
    const p = placeCard(railItem(4), VIEWPORT, CARD);
    expect(p.top).toBe(VIEWPORT_MARGIN);
    expect(p.arrow).toBe(16);
  });

  it("keeps the arrow on the card when the item is far off the end of it", () => {
    const p = placeCard(railItem(-400), VIEWPORT, CARD);
    expect(p.arrow).toBeGreaterThanOrEqual(0);
    expect(p.arrow).toBeLessThanOrEqual(CARD.height);
  });

  it("rounds to whole pixels", () => {
    const p = placeCard({ left: 0, top: 100.5, width: 55.5, height: 37.5 }, VIEWPORT, { width: 340.5, height: 200.5 });
    expect(Number.isInteger(p.left)).toBe(true);
    expect(Number.isInteger(p.top)).toBe(true);
    expect(Number.isInteger(p.arrow)).toBe(true);
  });
});
