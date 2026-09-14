import { describe, expect, it } from "vitest";
import { flatten, type Pixels } from "./flatten";

/** A picture of `width` by `height`, painted by a function of the position. */
function picture(width: number, height: number, paint: (x: number, y: number) => [number, number, number]): Pixels {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = paint(x, y);
      const at = (y * width + x) * 4;
      data[at] = r;
      data[at + 1] = g;
      data[at + 2] = b;
      data[at + 3] = 255;
    }
  }
  return { data, width, height };
}

const WHITE: [number, number, number] = [255, 255, 255];
const BLACK: [number, number, number] = [0, 0, 0];

/** The grey level at a position in a flattened picture. */
const at = (out: ReturnType<typeof flatten>, x: number, y: number): number => out.data[(y * out.width + x) * 4]!;

describe("flatten", () => {
  it("grows a small picture towards a size the recogniser can read", () => {
    const out = flatten(picture(400, 200, () => WHITE), { wanted: 1700 });
    expect(out.width).toBe(1700);
    expect(out.scale).toBeCloseTo(4.25, 5);
  });

  it("leaves a picture that is already big enough alone", () => {
    const out = flatten(picture(2000, 500, () => WHITE), { wanted: 1700, most: 3200 });
    expect(out.scale).toBe(1);
    expect(out.width).toBe(2000);
  });

  it("turns a picture that is light on dark the right way round", () => {
    const dark = flatten(picture(400, 100, (x) => (x % 20 < 3 ? WHITE : BLACK)));
    expect(dark.inverted).toBe(true);
    const light = flatten(picture(400, 100, (x) => (x % 20 < 3 ? BLACK : WHITE)));
    expect(light.inverted).toBe(false);
  });

  /*
   * The fix this test exists for. A photograph from a phone is three or four thousand pixels across
   * and is shrunk here. Shrinking by keeping one pixel in two drops every stroke that happens to sit
   * on an odd column, which on small print is most of them.
   */
  it("keeps a hairline stroke when it shrinks a very large picture", () => {
    // One black column at x = 1, which at half size is exactly the pixel a sampler throws away.
    const out = flatten(picture(6400, 40, (x) => (x === 1 ? BLACK : WHITE)), { most: 3200 });
    expect(out.scale).toBe(0.5);
    expect(out.height).toBe(20);
    expect(at(out, 0, 10), "the stroke survived the shrink").toBeLessThan(250);
  });

  it("evens out a page lit from one side", () => {
    /*
     * A page whose right-hand side is in shadow, with the same stroke drawn on both halves. One
     * level for the whole picture keeps the bright stroke and loses the dark one; measuring each
     * against the light around it keeps both.
     */
    const width = 800;
    const source = picture(width, 200, (x) => {
      const shade = 255 - Math.round((x / width) * 200);
      const stroke = x === 100 || x === 700;
      const v = stroke ? Math.round(shade * 0.2) : shade;
      return [v, v, v];
    });
    const out = flatten(source, { wanted: width, most: width });
    const bright = at(out, 100, 100);
    const shadowed = at(out, 700, 100);
    expect(bright).toBeLessThan(160);
    expect(shadowed).toBeLessThan(160);
    // Both strokes come out at much the same darkness, whatever light they were drawn in.
    expect(Math.abs(bright - shadowed)).toBeLessThan(40);
  });

  it("hands back four bytes a pixel, opaque", () => {
    const out = flatten(picture(100, 50, () => WHITE), { wanted: 100, most: 100 });
    expect(out.data.length).toBe(out.width * out.height * 4);
    expect(out.data[3]).toBe(255);
  });
});
