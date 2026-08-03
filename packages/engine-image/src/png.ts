/**
 * PNG decoding, written here rather than delegated to the platform.
 *
 * ============================================================================
 * WHY NOT `HTMLImageElement`, OR `createImageBitmap`
 * ============================================================================
 * Both are the obvious answer and both are wrong for this product, for the same
 * reason TEXT_ENGINE §1 refused Canvas2D text:
 *
 *   1. `HTMLImageElement` does not exist on two of the four targets. A headless
 *      render node has no DOM, and neither does a worker.
 *   2. Its colour management is PER PLATFORM. The same PNG with an embedded
 *      profile decodes to different pixels on macOS and Windows. A sponsor logo
 *      that is a different red on the render node than in the designer's editor
 *      is a bug nobody can reproduce and everybody can see.
 *   3. It is asynchronous through an event, not a promise, and it reports
 *      failure as a bare `error` event with no reason.
 *
 * So the bytes are decoded here, identically everywhere. The one platform
 * primitive used is `DecompressionStream("deflate")`, which is in every modern
 * browser and Node 18+, and which is specified — the same inflate on both.
 *
 * ============================================================================
 * WHAT IS AND IS NOT SUPPORTED
 * ============================================================================
 * Bit depth 8, colour types 0/2/3/4/6, non-interlaced. That is every logo any
 * design tool has ever exported.
 *
 * Everything else — 16-bit, Adam7 interlacing — throws a NAMED error rather
 * than guessing. A decoder that silently produces plausible-but-wrong pixels is
 * worse than one that refuses: the wrong pixels reach air.
 */

/** Raised when a PNG is malformed or uses a feature this decoder refuses. */
export class ImageDecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImageDecodeError";
  }
}

export interface DecodedImage {
  readonly width: number;
  readonly height: number;
  /** Straight (non-premultiplied) sRGB RGBA, 8 bits per channel. */
  readonly pixels: Uint8Array;
}

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Channels per pixel for each PNG colour type. Index is the colour type. */
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

interface Header {
  width: number;
  height: number;
  bitDepth: number;
  colorType: number;
  interlace: number;
}

/**
 * Decodes a PNG to straight sRGB RGBA.
 *
 * Async because inflate is: `DecompressionStream` is the only shape available
 * on every target, and image loading is asynchronous anyway. TEXT_ENGINE §3's
 * rule applies unchanged — a scene's images are decoded before its first frame,
 * because an image resolving mid-broadcast pops on screen.
 */
export async function decodePng(bytes: Uint8Array): Promise<DecodedImage> {
  if (bytes.length < 8) throw new ImageDecodeError("not a PNG: too short");
  for (let i = 0; i < 8; i += 1) {
    if (bytes[i] !== SIGNATURE[i]) throw new ImageDecodeError("not a PNG");
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8;

  let header: Header | null = null;
  let palette: Uint8Array | null = null;
  let paletteAlpha: Uint8Array | null = null;
  const idat: Uint8Array[] = [];

  while (offset + 8 <= bytes.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(
      bytes[offset + 4]!,
      bytes[offset + 5]!,
      bytes[offset + 6]!,
      bytes[offset + 7]!,
    );
    const start = offset + 8;
    if (start + length > bytes.length) {
      throw new ImageDecodeError(`truncated ${type} chunk`);
    }

    if (type === "IHDR") {
      header = {
        width: view.getUint32(start),
        height: view.getUint32(start + 4),
        bitDepth: bytes[start + 8]!,
        colorType: bytes[start + 9]!,
        interlace: bytes[start + 12]!,
      };
    } else if (type === "PLTE") {
      palette = bytes.subarray(start, start + length);
    } else if (type === "tRNS") {
      paletteAlpha = bytes.subarray(start, start + length);
    } else if (type === "IDAT") {
      idat.push(bytes.subarray(start, start + length));
    } else if (type === "IEND") {
      break;
    }

    // 4 length + 4 type + data + 4 CRC.
    offset = start + length + 4;
  }

  if (header === null) throw new ImageDecodeError("PNG has no IHDR");
  const { width, height, bitDepth, colorType, interlace } = header;

  if (width <= 0 || height <= 0) {
    throw new ImageDecodeError(`PNG has no area (${width}x${height})`);
  }
  // Named refusals. See the header comment: guessing here puts wrong pixels on
  // air, and "unsupported" is a message a user can act on.
  if (bitDepth !== 8) {
    throw new ImageDecodeError(
      `unsupported PNG bit depth ${bitDepth}; re-export at 8 bits per channel`,
    );
  }
  if (interlace !== 0) {
    throw new ImageDecodeError(
      "unsupported interlaced PNG; re-export without Adam7 interlacing",
    );
  }
  const channels = CHANNELS[colorType];
  if (channels === undefined) {
    throw new ImageDecodeError(`unsupported PNG colour type ${colorType}`);
  }
  if (colorType === 3 && palette === null) {
    throw new ImageDecodeError("indexed PNG has no PLTE chunk");
  }
  if (idat.length === 0) throw new ImageDecodeError("PNG has no image data");

  const raw = await inflate(concat(idat));
  const scanlines = unfilter(raw, width, height, channels);

  return {
    width,
    height,
    pixels: toRgba(scanlines, width, height, colorType, palette, paletteAlpha),
  };
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  if (parts.length === 1) return parts[0]!;
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

/**
 * zlib inflate via the platform's own stream.
 *
 * `"deflate"` — not `"deflate-raw"` — because a PNG's IDAT payload carries the
 * two-byte zlib header the spec requires.
 */
async function inflate(data: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === "undefined") {
    throw new ImageDecodeError(
      "no DecompressionStream on this platform; cannot decode PNG",
    );
  }
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(
    new DecompressionStream("deflate"),
  );
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Reverses the per-scanline filters. PNG spec §9.
 *
 * Each scanline is prefixed with a filter byte and predicted from its left
 * neighbour (`a`), the scanline above (`b`), and the pixel above-left (`c`).
 * The filters are cumulative down the image, so this cannot be parallelised or
 * done out of order — the reason it is a tight loop over a flat buffer rather
 * than anything cleverer.
 */
function unfilter(
  raw: Uint8Array,
  width: number,
  height: number,
  channels: number,
): Uint8Array {
  const stride = width * channels;
  const expected = (stride + 1) * height;
  if (raw.length < expected) {
    throw new ImageDecodeError(
      `PNG data is short: expected ${expected} bytes, got ${raw.length}`,
    );
  }

  const out = new Uint8Array(stride * height);
  let at = 0;

  for (let y = 0; y < height; y += 1) {
    const filter = raw[at]!;
    at += 1;
    const row = y * stride;
    const previous = row - stride;

    for (let x = 0; x < stride; x += 1) {
      const value = raw[at + x]!;
      const a = x >= channels ? out[row + x - channels]! : 0;
      const b = y > 0 ? out[previous + x]! : 0;
      const c = y > 0 && x >= channels ? out[previous + x - channels]! : 0;

      let restored: number;
      switch (filter) {
        case 0:
          restored = value;
          break;
        case 1:
          restored = value + a;
          break;
        case 2:
          restored = value + b;
          break;
        case 3:
          restored = value + ((a + b) >> 1);
          break;
        case 4:
          restored = value + paeth(a, b, c);
          break;
        default:
          throw new ImageDecodeError(`unknown PNG filter ${filter}`);
      }
      out[row + x] = restored & 0xff;
    }
    at += stride;
  }

  return out;
}

/** PNG spec §9.4. The predictor closest to the linear estimate a + b − c. */
function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/** Expands any supported colour type to straight sRGB RGBA. */
function toRgba(
  data: Uint8Array,
  width: number,
  height: number,
  colorType: number,
  palette: Uint8Array | null,
  paletteAlpha: Uint8Array | null,
): Uint8Array {
  const count = width * height;
  const out = new Uint8Array(count * 4);

  for (let i = 0; i < count; i += 1) {
    const o = i * 4;
    switch (colorType) {
      case 0: {
        // Greyscale.
        const g = data[i]!;
        out[o] = g;
        out[o + 1] = g;
        out[o + 2] = g;
        out[o + 3] = 255;
        break;
      }
      case 2: {
        // Truecolour.
        const s = i * 3;
        out[o] = data[s]!;
        out[o + 1] = data[s + 1]!;
        out[o + 2] = data[s + 2]!;
        out[o + 3] = 255;
        break;
      }
      case 3: {
        // Indexed. `tRNS` is per-palette-entry alpha and is optional; entries
        // it does not cover are opaque, which is what the spec says and what a
        // logo exported with one transparent colour relies on.
        const index = data[i]!;
        const p = index * 3;
        if (p + 2 >= (palette?.length ?? 0)) {
          throw new ImageDecodeError(`palette index ${index} out of range`);
        }
        out[o] = palette![p]!;
        out[o + 1] = palette![p + 1]!;
        out[o + 2] = palette![p + 2]!;
        out[o + 3] = paletteAlpha?.[index] ?? 255;
        break;
      }
      case 4: {
        // Greyscale + alpha.
        const s = i * 2;
        const g = data[s]!;
        out[o] = g;
        out[o + 1] = g;
        out[o + 2] = g;
        out[o + 3] = data[s + 1]!;
        break;
      }
      default: {
        // Truecolour + alpha.
        const s = i * 4;
        out[o] = data[s]!;
        out[o + 1] = data[s + 1]!;
        out[o + 2] = data[s + 2]!;
        out[o + 3] = data[s + 3]!;
        break;
      }
    }
  }

  return out;
}
