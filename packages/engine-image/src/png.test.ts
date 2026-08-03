import { describe, expect, it } from "vitest";
import { deflateSync } from "node:zlib";

import { decodePng, ImageDecodeError } from "./png";
import { toPremultipliedLinear } from "./color";
import { ImageLibrary } from "./library";

/**
 * Decoder verification against REAL PNG bytes.
 *
 * ============================================================================
 * WHY THE FIXTURES ARE BUILT HERE RATHER THAN CHECKED IN
 * ============================================================================
 * A checked-in binary proves the decoder agrees with whatever produced it, and
 * nothing more — and when it disagrees you cannot see why. Built here, every
 * byte is stated in the test: this filter, this colour type, this palette. A
 * failure points at the feature rather than at "the fixture".
 *
 * `deflateSync` is Node's, used only to WRITE the fixtures. The decoder itself
 * never touches it — it inflates through `DecompressionStream`, which is the
 * only shape available on every target.
 */

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i += 1) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  // CRC is not verified by the decoder — a corrupt chunk fails at inflate or at
  // the length check, and re-deriving CRC32 here would test Node, not us.
  view.setUint32(8 + data.length, 0);
  return out;
}

interface PngSpec {
  width: number;
  height: number;
  colorType: number;
  /** Unfiltered scanlines, WITHOUT the leading filter byte. */
  rows: readonly (readonly number[])[];
  /** Filter byte per row. Defaults to 0 (None) for every row. */
  filters?: readonly number[];
  palette?: readonly number[];
  transparency?: readonly number[];
  bitDepth?: number;
  interlace?: number;
}

function png(spec: PngSpec): Uint8Array {
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, spec.width);
  view.setUint32(4, spec.height);
  ihdr[8] = spec.bitDepth ?? 8;
  ihdr[9] = spec.colorType;
  ihdr[12] = spec.interlace ?? 0;

  const raw: number[] = [];
  spec.rows.forEach((row, index) => {
    raw.push(spec.filters?.[index] ?? 0);
    raw.push(...row);
  });

  const parts: Uint8Array[] = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
  ];
  if (spec.palette) parts.push(chunk("PLTE", new Uint8Array(spec.palette)));
  if (spec.transparency) {
    parts.push(chunk("tRNS", new Uint8Array(spec.transparency)));
  }
  parts.push(chunk("IDAT", new Uint8Array(deflateSync(new Uint8Array(raw)))));
  parts.push(chunk("IEND", new Uint8Array(0)));

  let total = 0;
  for (const part of parts) total += part.length;
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

describe("decoding", () => {
  it("reads truecolour with alpha", async () => {
    const image = await decodePng(
      png({
        width: 2,
        height: 1,
        colorType: 6,
        rows: [[255, 0, 0, 255, 0, 255, 0, 128]],
      }),
    );
    expect(image.width).toBe(2);
    expect(image.height).toBe(1);
    expect([...image.pixels]).toEqual([255, 0, 0, 255, 0, 255, 0, 128]);
  });

  it("expands truecolour without alpha to opaque", async () => {
    const image = await decodePng(
      png({ width: 1, height: 1, colorType: 2, rows: [[10, 20, 30]] }),
    );
    expect([...image.pixels]).toEqual([10, 20, 30, 255]);
  });

  it("expands greyscale, with and without alpha", async () => {
    const grey = await decodePng(
      png({ width: 1, height: 1, colorType: 0, rows: [[77]] }),
    );
    expect([...grey.pixels]).toEqual([77, 77, 77, 255]);

    const withAlpha = await decodePng(
      png({ width: 1, height: 1, colorType: 4, rows: [[77, 40]] }),
    );
    expect([...withAlpha.pixels]).toEqual([77, 77, 77, 40]);
  });

  it("resolves an indexed palette, and tRNS where it reaches", async () => {
    // The shape a logo exported with one transparent colour actually has: a
    // tRNS shorter than the palette, with the uncovered entries opaque.
    const image = await decodePng(
      png({
        width: 3,
        height: 1,
        colorType: 3,
        palette: [255, 0, 0, 0, 255, 0, 0, 0, 255],
        transparency: [0, 128],
        rows: [[0, 1, 2]],
      }),
    );
    expect([...image.pixels]).toEqual([
      255, 0, 0, 0, // entry 0, tRNS 0
      0, 255, 0, 128, // entry 1, tRNS 128
      0, 0, 255, 255, // entry 2, beyond tRNS — opaque
    ]);
  });

  it("reverses every scanline filter", async () => {
    // One row per filter, each encoding the SAME pixel value through a
    // different predictor. If any filter is wrong, exactly one row differs —
    // which is what makes this diagnosable rather than just red.
    //
    // Grey, 1 channel, 2 px wide. Target image is 40 everywhere.
    const image = await decodePng(
      png({
        width: 2,
        height: 5,
        colorType: 0,
        filters: [0, 1, 2, 3, 4],
        rows: [
          [40, 40], // None
          [40, 0], // Sub:     40, 40+0
          [0, 0], // Up:       40+0, 40+0
          [20, 0], // Average: (0+40)>>1 = 20, so 20+20; then (40+40)>>1 = 40
          [0, 0], // Paeth:    predicts left/up correctly at 40
        ],
      }),
    );
    expect([...image.pixels].filter((_, i) => i % 4 === 0)).toEqual(
      new Array(10).fill(40),
    );
    expect([...image.pixels].filter((_, i) => i % 4 === 3)).toEqual(
      new Array(10).fill(255),
    );
  });
});

describe("refusals", () => {
  // Each of these would otherwise produce plausible-but-wrong pixels, which is
  // the one outcome a broadcast decoder must never have.

  it("rejects a file that is not a PNG", async () => {
    await expect(decodePng(new Uint8Array([1, 2, 3, 4]))).rejects.toThrow(
      ImageDecodeError,
    );
    await expect(
      decodePng(new Uint8Array(16).fill(0x42)),
    ).rejects.toThrow(/not a PNG/);
  });

  it("names 16-bit and interlaced rather than guessing", async () => {
    await expect(
      decodePng(png({ width: 1, height: 1, colorType: 2, bitDepth: 16, rows: [[0, 0, 0, 0, 0, 0]] })),
    ).rejects.toThrow(/bit depth 16/);

    await expect(
      decodePng(png({ width: 1, height: 1, colorType: 2, interlace: 1, rows: [[0, 0, 0]] })),
    ).rejects.toThrow(/interlaced/);
  });

  it("rejects an indexed image with no palette", async () => {
    await expect(
      decodePng(png({ width: 1, height: 1, colorType: 3, rows: [[0]] })),
    ).rejects.toThrow(/no PLTE/);
  });

  it("rejects truncated image data", async () => {
    // Two rows declared, one supplied.
    await expect(
      decodePng(png({ width: 4, height: 2, colorType: 2, rows: [[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]] })),
    ).rejects.toThrow(/short/);
  });
});

describe("colour, on upload", () => {
  it("converts sRGB to linear and premultiplies", () => {
    // Mid-grey is the value that moves most, and the one that proves the
    // transfer function ran at all: 128 sRGB is 55 linear, not 128.
    const pixels = toPremultipliedLinear(new Uint8Array([128, 128, 128, 255]));
    expect(pixels[0]).toBe(55);
    expect(pixels[3]).toBe(255);
  });

  it("keeps white white and black black", () => {
    // The endpoints are fixed points of the transfer function. If either moves,
    // the conversion is wrong in a way every other test would tolerate.
    const white = toPremultipliedLinear(new Uint8Array([255, 255, 255, 255]));
    expect([...white]).toEqual([255, 255, 255, 255]);
    const black = toPremultipliedLinear(new Uint8Array([0, 0, 0, 255]));
    expect([...black]).toEqual([0, 0, 0, 255]);
  });

  it("zeroes fully transparent texels, which is what kills the halo", () => {
    // A white texel at alpha 0 must not keep its white: a linear filter would
    // drag it into the visible neighbour and put a bright fringe on the logo.
    const pixels = toPremultipliedLinear(new Uint8Array([255, 255, 255, 0]));
    expect([...pixels]).toEqual([0, 0, 0, 0]);
  });

  it("does not run alpha through the transfer function", () => {
    // Alpha is coverage, not colour. If it were converted, 128 would become 55
    // and every semi-transparent graphic would be too see-through.
    const pixels = toPremultipliedLinear(new Uint8Array([255, 255, 255, 128]));
    expect(pixels[3]).toBe(128);
    // RGB is premultiplied by the STRAIGHT alpha: 255 linear x 128/255 = 128.
    expect(pixels[0]).toBe(128);
  });
});

describe("the library", () => {
  const logo = png({ width: 2, height: 2, colorType: 6, rows: [
    [255, 0, 0, 255, 0, 255, 0, 255],
    [0, 0, 255, 255, 255, 255, 255, 255],
  ] });

  it("decodes once per content hash", async () => {
    const library = new ImageLibrary();
    const first = await library.load("sha256:abc", logo);
    const second = await library.load("sha256:abc", logo);

    expect(first.ok && second.ok).toBe(true);
    // The SAME object, not an equal one: that identity is what makes five
    // templates sharing a sponsor logo cost one decode and one upload.
    expect(first.ok && second.ok && first.image === second.image).toBe(true);
    expect(library.stats().images).toBe(1);
    expect(library.bytes).toBe(16);
  });

  it("returns a decode failure rather than throwing", async () => {
    // A broken asset in a package costs that graphic its logo. It does not take
    // the editor down.
    const library = new ImageLibrary();
    const result = await library.load("sha256:bad", new Uint8Array([0, 1, 2]));
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toMatch(/not a PNG/);
    expect(library.stats().images).toBe(0);
  });

  it("refuses past its budget instead of evicting", async () => {
    // A glyph can be regenerated in 2ms. A sponsor logo cannot, and dropping
    // one at air time takes it off screen mid-show — so the refusal happens at
    // load, where someone can act on it.
    const library = new ImageLibrary({ budgetBytes: 16 });
    expect((await library.load("a", logo)).ok).toBe(true);

    const second = await library.load("b", logo);
    expect(second.ok).toBe(false);
    expect(!second.ok && second.reason).toMatch(/budget exceeded/);
    // And the one already admitted is untouched.
    expect(library.has("a")).toBe(true);
  });

  it("releases what a closed document held", async () => {
    const library = new ImageLibrary();
    await library.load("a", logo);
    expect(library.release("a")).toBe(true);
    expect(library.bytes).toBe(0);
    expect(library.release("a")).toBe(false);
  });
});
