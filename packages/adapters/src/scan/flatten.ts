/**
 * Making a picture legible before it is recognised.
 *
 * Three things stop a recogniser reading a list. The type is too small, which a frame of a stream at
 * 1080p always is. The page is lighter in one corner than another, which every photograph taken by
 * hand is, and a threshold that suits the bright corner loses the dark one entirely. And the words
 * are light on a dark ground, which every broadcast overlay is, where a recogniser expects the
 * opposite.
 *
 * This works on raw pixels so that the app and its tests run the same code. The app decodes and
 * encodes with a canvas, and the test does it with a library; only the middle is shared, and the
 * middle is the part worth being sure about.
 */

export interface Pixels {
  /** RGBA, four bytes a pixel, as a canvas hands it over. */
  readonly data: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
}

/** Below this average brightness the picture is light-on-dark and is turned around. */
const DARK = 110;
/** The window the local brightness is measured over, as a share of the width. */
const WINDOW = 0.08;
/** How far below the local brightness a pixel has to be to stay dark. Under 1 it thins the strokes. */
const KEEP = 0.94;

/** The grey level of one pixel, by the usual luminance weights. */
const greyAt = (data: Uint8ClampedArray, at: number): number => (data[at]! * 299 + data[at + 1]! * 587 + data[at + 2]! * 114) / 1000;

/**
 * A greyscale copy at `scale`.
 *
 * Growing a picture reads between the pixels it has, and shrinking one averages the pixels it is
 * throwing away. Shrinking by sampling instead keeps one pixel in three and drops the other two,
 * which on a stroke one pixel wide loses the stroke: a photograph from a phone is three or four
 * thousand pixels across, is shrunk here, and is where the small print lives.
 */
function greyscale(source: Pixels, scale: number): { grey: Float32Array; width: number; height: number; mean: number } {
  const width = Math.max(1, Math.round(source.width * scale));
  const height = Math.max(1, Math.round(source.height * scale));
  const grey = new Float32Array(width * height);
  let total = 0;

  if (scale < 1) {
    const step = 1 / scale;
    for (let y = 0; y < height; y++) {
      const top = Math.floor(y * step);
      const bottom = Math.min(source.height, Math.max(top + 1, Math.floor((y + 1) * step)));
      for (let x = 0; x < width; x++) {
        const left = Math.floor(x * step);
        const right = Math.min(source.width, Math.max(left + 1, Math.floor((x + 1) * step)));
        let sum = 0;
        let n = 0;
        for (let sy = top; sy < bottom; sy++) {
          for (let sx = left; sx < right; sx++) {
            sum += greyAt(source.data, (sy * source.width + sx) * 4);
            n++;
          }
        }
        const v = sum / Math.max(1, n);
        grey[y * width + x] = v;
        total += v;
      }
    }
    return { grey, width, height, mean: total / (width * height) };
  }

  for (let y = 0; y < height; y++) {
    const sy = Math.min(source.height - 1, y / scale);
    const y0 = Math.floor(sy);
    const y1 = Math.min(source.height - 1, y0 + 1);
    const fy = sy - y0;
    for (let x = 0; x < width; x++) {
      const sx = Math.min(source.width - 1, x / scale);
      const x0 = Math.floor(sx);
      const x1 = Math.min(source.width - 1, x0 + 1);
      const fx = sx - x0;
      const a = greyAt(source.data, (y0 * source.width + x0) * 4);
      const b = greyAt(source.data, (y0 * source.width + x1) * 4);
      const c = greyAt(source.data, (y1 * source.width + x0) * 4);
      const d = greyAt(source.data, (y1 * source.width + x1) * 4);
      const v = a + (b - a) * fx + (c - a + (d - b - c + a) * fx) * fy;
      grey[y * width + x] = v;
      total += v;
    }
  }
  return { grey, width, height, mean: total / (width * height) };
}

/**
 * The average brightness around every pixel, over a square window.
 *
 * Summed-area tables, so the window costs the same however wide it is. A window this size has to be
 * wider than a letter and narrower than the lighting, and measuring it the naive way over a picture
 * this large takes longer than recognising it does.
 */
function background(grey: Float32Array, width: number, height: number, radius: number): Float32Array {
  const sums = new Float64Array((width + 1) * (height + 1));
  for (let y = 0; y < height; y++) {
    let row = 0;
    for (let x = 0; x < width; x++) {
      row += grey[y * width + x]!;
      sums[(y + 1) * (width + 1) + x + 1] = sums[y * (width + 1) + x + 1]! + row;
    }
  }
  const out = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    const top = Math.max(0, y - radius);
    const bottom = Math.min(height - 1, y + radius);
    for (let x = 0; x < width; x++) {
      const left = Math.max(0, x - radius);
      const right = Math.min(width - 1, x + radius);
      const area = (bottom - top + 1) * (right - left + 1);
      const total =
        sums[(bottom + 1) * (width + 1) + right + 1]! - sums[top * (width + 1) + right + 1]! - sums[(bottom + 1) * (width + 1) + left]! + sums[top * (width + 1) + left]!;
      out[y * width + x] = total / area;
    }
  }
  return out;
}

export interface FlattenOptions {
  /** Grow the picture to about this wide, which is what puts a capital letter at a readable size. */
  readonly wanted?: number;
  /** Never grow past this, because the time it costs stops being worth the detail. */
  readonly most?: number;
}

export interface Flattened extends Pixels {
  readonly data: Uint8ClampedArray;
  /** Whether the picture was light on dark and had to be turned around. */
  readonly inverted: boolean;
  readonly scale: number;
}

/** A picture the recogniser can read: grown, grey, the right way round, and evenly lit. */
export function flatten(source: Pixels, options: FlattenOptions = {}): Flattened {
  const wanted = options.wanted ?? 1700;
  const most = options.most ?? 3200;
  const scale = Math.min(most / source.width, Math.max(1, wanted / source.width));

  const { grey, width, height, mean } = greyscale(source, scale);
  const inverted = mean < DARK;
  if (inverted) for (let i = 0; i < grey.length; i++) grey[i] = 255 - grey[i]!;

  const radius = Math.max(6, Math.round(width * WINDOW));
  const around = background(grey, width, height, radius);

  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < grey.length; i++) {
    // Each pixel against the brightness around it rather than against a level for the whole picture.
    // A page darker in one corner reads the same as a page that is not.
    const local = Math.max(1, around[i]! * KEEP);
    const v = Math.max(0, Math.min(255, (grey[i]! / local) * 255));
    const at = i * 4;
    data[at] = v;
    data[at + 1] = v;
    data[at + 2] = v;
    data[at + 3] = 255;
  }
  return { data, width, height, inverted, scale };
}
