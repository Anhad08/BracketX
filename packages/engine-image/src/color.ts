/**
 * Colour conversion for upload. MirrorBackend clause C9.
 *
 * ============================================================================
 * WHY THIS IS NOT OPTIONAL, AND WHY IT IS SO EASY TO GET WRONG
 * ============================================================================
 * C9 says textures reach the backend as **premultiplied linear RGBA**. A PNG is
 * neither: it is straight (non-premultiplied) sRGB. Two conversions therefore
 * stand between a file and a correct pixel, and skipping either produces an
 * image that looks *nearly* right:
 *
 *   - Skip sRGB → linear and every logo is washed out where it is blended and
 *     too dark where it is lit. Mid-greys drift most, so a flat brand colour
 *     survives and a gradient does not.
 *   - Skip premultiplication and every antialiased edge gets a dark halo,
 *     because the transparent border texels carry black RGB that the filter
 *     drags inward. On a logo over live video this is the classic "why does my
 *     PNG have a black outline" bug.
 *
 * Both are done once, here, on upload — never per frame.
 */

/**
 * sRGB byte → linear byte, precomputed.
 *
 * A 256-entry table because the transfer function is a `pow` and a 4K logo is
 * 25 million channel conversions. Built once at module load, which costs
 * nothing measurable and removes the whole cost from the loading path.
 */
const SRGB_TO_LINEAR = new Uint8Array(256);
for (let i = 0; i < 256; i += 1) {
  const s = i / 255;
  // IEC 61966-2-1. The linear segment near black matters: a naive `pow(s, 2.2)`
  // crushes the darkest few values, which is exactly where logo antialiasing
  // lives.
  const linear = s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  SRGB_TO_LINEAR[i] = Math.round(linear * 255);
}

/**
 * Converts straight sRGB RGBA to premultiplied linear RGBA, in place.
 *
 * In place because the buffer is transient — it was allocated by the decoder
 * and is handed straight to `createTexture`. Copying a 4K logo to avoid
 * mutating something nobody else holds is pure waste.
 *
 * Alpha is NOT converted. Alpha is coverage, not colour: it is already linear,
 * and running it through the transfer function is the other classic version of
 * the halo bug.
 */
export function toPremultipliedLinear(pixels: Uint8Array): Uint8Array {
  for (let i = 0; i < pixels.length; i += 4) {
    const alpha = pixels[i + 3]!;

    if (alpha === 255) {
      pixels[i] = SRGB_TO_LINEAR[pixels[i]!]!;
      pixels[i + 1] = SRGB_TO_LINEAR[pixels[i + 1]!]!;
      pixels[i + 2] = SRGB_TO_LINEAR[pixels[i + 2]!]!;
      continue;
    }
    if (alpha === 0) {
      // Fully transparent texels contribute nothing, and zeroing them is what
      // stops a filter dragging their colour into a visible neighbour.
      pixels[i] = 0;
      pixels[i + 1] = 0;
      pixels[i + 2] = 0;
      continue;
    }

    const a = alpha / 255;
    pixels[i] = Math.round(SRGB_TO_LINEAR[pixels[i]!]! * a);
    pixels[i + 1] = Math.round(SRGB_TO_LINEAR[pixels[i + 1]!]! * a);
    pixels[i + 2] = Math.round(SRGB_TO_LINEAR[pixels[i + 2]!]! * a);
  }
  return pixels;
}
