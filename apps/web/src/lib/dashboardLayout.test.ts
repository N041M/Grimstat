import { describe, expect, it } from "vitest";
import { defaultLayout, minSizeOf, rowsForHeight } from "../components/Dashboard";
import type { ReactWidgetDef } from "../widgets/registry";

const w = (id: string, size: { w: number; h: number }, minSize?: { w: number; h: number }): ReactWidgetDef => ({ id, title: id, inputs: ["result"], defaultSize: size, render: () => null, ...(minSize ? { minSize } : {}) });

describe("panel minimum sizes", () => {
  it("uses a declared minimum, clamped to the grid width", () => {
    expect(minSizeOf(w("a", { w: 6, h: 6 }, { w: 4, h: 5 }))).toEqual({ w: 4, h: 5 });
    expect(minSizeOf(w("b", { w: 12, h: 8 }, { w: 20, h: 4 }))).toEqual({ w: 12, h: 4 });
  });

  it("derives a minimum of about half the default, never below three units", () => {
    expect(minSizeOf(w("c", { w: 12, h: 8 }))).toEqual({ w: 6, h: 4 });
    expect(minSizeOf(w("d", { w: 4, h: 4 }))).toEqual({ w: 3, h: 3 });
    // a panel declared smaller than the floor is grown to it rather than exempted
    expect(minSizeOf(w("e", { w: 2, h: 2 }))).toEqual({ w: 3, h: 3 });
  });

  it("packs the default layout at or above every minimum", () => {
    const widgets = [w("hero", { w: 12, h: 3 }, { w: 6, h: 3 }), w("dist", { w: 12, h: 8 }, { w: 5, h: 6 }), w("slain", { w: 6, h: 6 }, { w: 4, h: 4 }), w("weapons", { w: 6, h: 6 }, { w: 4, h: 4 })];
    for (const l of defaultLayout(widgets)) {
      expect(l.w).toBeGreaterThanOrEqual(l.minW ?? 0);
      expect(l.h).toBeGreaterThanOrEqual(l.minH ?? 0);
      expect(l.minW).toBeGreaterThan(2);
    }
  });

  it("keeps the designed composition: hero and distribution full width, the pair side by side", () => {
    const widgets = [w("hero", { w: 12, h: 3 }, { w: 6, h: 3 }), w("dist", { w: 12, h: 8 }, { w: 5, h: 6 }), w("slain", { w: 6, h: 6 }, { w: 4, h: 4 }), w("weapons", { w: 6, h: 6 }, { w: 4, h: 4 })];
    const l = defaultLayout(widgets);
    expect(l.map((x) => [x.i, x.x, x.y, x.w])).toEqual([
      ["hero", 0, 0, 12],
      ["dist", 0, 3, 12],
      ["slain", 0, 11, 6],
      ["weapons", 6, 11, 6],
    ]);
  });
});

describe("fitting a panel to its content", () => {
  it("converts a pixel height into the smallest row count that holds it", () => {
    // a panel of h rows is h*22 + (h-1)*14 pixels tall
    expect(rowsForHeight(22)).toBe(1);
    expect(rowsForHeight(58)).toBe(2); // 2*22 + 14
    expect(rowsForHeight(59)).toBe(3); // one pixel over two rows
    expect(rowsForHeight(202)).toBe(6);
  });

  it("never returns less than one row, whatever it is given", () => {
    expect(rowsForHeight(0)).toBe(1);
    expect(rowsForHeight(-40)).toBe(1);
  });
});
