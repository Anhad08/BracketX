/**
 * Thumbnails, from the pixels that are actually on air.
 *
 * ============================================================================
 * WHY NOT DECODE THE FILE AGAIN FOR THE PREVIEW
 * ============================================================================
 * The obvious shortcut is to hand the original bytes to the browser and let it
 * draw them. That produces a preview that can DISAGREE with the graphic — the
 * platform's colour management is not ours (see png.ts), so the swatch in the
 * library and the logo on air would be subtly different reds, and the library
 * would be the one lying.
 *
 * So a thumbnail is derived from the decoded, premultiplied linear pixels the
 * renderer samples. If the preview is wrong, the output is wrong, which is the
 * only relationship between them worth having.
 *
 * ============================================================================
 * WHICH MEANS UNDOING BOTH CONVERSIONS
 * ============================================================================
 * `toPremultipliedLinear` ran on those pixels, so a canvas — which expects
 * straight sRGB — needs both inverted. Downsampling happens in LINEAR space,
 * before the transfer function, because averaging gamma-encoded values is the
 * classic too-dark thumbnail: a 50% grey checkerboard reduced in sRGB comes out
 * near 0.21 rather than 0.5.
 */

/** sRGB byte from a linear byte. The inverse of the table in color.ts. */
const LINEAR_TO_SRGB = new Uint8Array(256);
for (let i = 0; i < 256; i += 1) {
  const linear = i / 255;
  const srgb =
    linear <= 0.0031308 ? linear * 12.92 : 1.055 * linear ** (1 / 2.4) - 0.055;
  LINEAR_TO_SRGB[i] = Math.round(srgb * 255);
}

export interface Thumbnail {
  readonly width: number;
  readonly height: number;
  /** Straight sRGB RGBA — what a canvas `ImageData` expects. */
  readonly pixels: Uint8ClampedArray;
}

/**
 * A box-filtered thumbnail, at most `max` on its longest side.
 *
 * A box filter rather than nearest: a logo reduced by point sampling drops
 * whole strokes, and a library of thumbnails that misrepresent their assets is
 * worse than no thumbnails. It is also the same averaging a mip level does, so
 * the thumbnail looks like the minified graphic will.
 *
 * Images already within `max` are converted but not resampled — resampling at
 * 1:1 is a lossy no-op.
 */
export function thumbnail(
  source: { width: number; height: number; pixels: Uint8Array },
  max = 128,
): Thumbnail {
  const scale = Math.min(1, max / Math.max(source.width, source.height));
  const width = Math.max(1, Math.round(source.width * scale));
  const height = Math.max(1, Math.round(source.height * scale));
  const out = new Uint8ClampedArray(width * height * 4);

  const boxWidth = source.width / width;
  const boxHeight = source.height / height;

  for (let y = 0; y < height; y += 1) {
    const y0 = Math.floor(y * boxHeight);
    const y1 = Math.max(y0 + 1, Math.min(source.height, Math.ceil((y + 1) * boxHeight)));

    for (let x = 0; x < width; x += 1) {
      const x0 = Math.floor(x * boxWidth);
      const x1 = Math.max(x0 + 1, Math.min(source.width, Math.ceil((x + 1) * boxWidth)));

      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let count = 0;

      for (let sy = y0; sy < y1; sy += 1) {
        for (let sx = x0; sx < x1; sx += 1) {
          const o = (sy * source.width + sx) * 4;
          // Averaged PREMULTIPLIED, which is the whole reason premultiplied
          // alpha exists: it makes the average of a transparent and an opaque
          // texel correct without weighting by hand.
          r += source.pixels[o]!;
          g += source.pixels[o + 1]!;
          b += source.pixels[o + 2]!;
          a += source.pixels[o + 3]!;
          count += 1;
        }
      }

      const alpha = a / count;
      const o = (y * width + x) * 4;
      out[o + 3] = Math.round(alpha);

      if (alpha <= 0) continue;
      // Un-premultiply back to straight colour, then linear -> sRGB for display.
      const factor = 255 / alpha;
      out[o] = LINEAR_TO_SRGB[clamp255((r / count) * factor)]!;
      out[o + 1] = LINEAR_TO_SRGB[clamp255((g / count) * factor)]!;
      out[o + 2] = LINEAR_TO_SRGB[clamp255((b / count) * factor)]!;
    }
  }

  return { width, height, pixels: out };
}

function clamp255(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}
