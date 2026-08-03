/**
 * The decoded-image library. Content-addressed, budgeted, shared across scenes.
 *
 * ============================================================================
 * WHAT THIS OWNS, AND WHAT IT DELIBERATELY DOES NOT
 * ============================================================================
 * It owns bytes → decoded, premultiplied linear RGBA, keyed by content hash.
 * It does NOT own textures: GPU lifetime belongs to whoever called
 * `createTexture`, which is MirrorBackend clause C2, and in practice is the
 * projector. Exactly the split the glyph atlas already uses — the text engine
 * owns the atlas image, the projector owns the handle.
 *
 * Keying by HASH rather than by asset id is what makes a Marketplace package
 * cheap: five templates that all use the same sponsor logo decode it once and
 * upload it once, however many documents reference it under however many asset
 * ids.
 *
 * ============================================================================
 * OVER BUDGET IS A REFUSAL, NOT AN EVICTION
 * ============================================================================
 * Textures are the largest GPU consumer in a broadcast scene. The glyph atlas
 * evicts under pressure because a glyph can be regenerated in two milliseconds
 * and re-drawn next frame; a 4K logo cannot, and silently dropping one takes a
 * sponsor off air mid-show.
 *
 * So this refuses past its budget and says so, which matches what the projector
 * already does for meshes (ENGINE_RUNTIME §4.4). A named refusal at load time is
 * something a designer can act on. An eviction at air time is not.
 */
import { decodePng, ImageDecodeError, type DecodedImage } from "./png";
import { toPremultipliedLinear } from "./color";

/** A decoded image, ready for `createTexture`: premultiplied linear RGBA8. */
export interface ImageData {
  readonly width: number;
  readonly height: number;
  readonly pixels: Uint8Array;
  /** Decoded byte count. What the budget counts. */
  readonly bytes: number;
}

export interface ImageLibraryOptions {
  /**
   * Decoded-byte ceiling. Default 256 MB.
   *
   * Counted on the CPU side, which is the number we can measure honestly; GPU
   * residency for an uncompressed RGBA8 texture without mipmaps is the same
   * figure, so this is not an approximation for the case that matters.
   */
  readonly budgetBytes?: number;
}

export type LoadResult =
  | { readonly ok: true; readonly image: ImageData }
  | { readonly ok: false; readonly reason: string };

export class ImageLibrary {
  readonly #images = new Map<string, ImageData>();
  readonly #budget: number;
  #bytes = 0;

  constructor(options: ImageLibraryOptions = {}) {
    this.#budget = options.budgetBytes ?? 256 * 1024 * 1024;
  }

  has(hash: string): boolean {
    return this.#images.has(hash);
  }

  get(hash: string): ImageData | undefined {
    return this.#images.get(hash);
  }

  get bytes(): number {
    return this.#bytes;
  }

  /**
   * Decodes and admits an image under its content hash.
   *
   * Idempotent: loading a hash already held is a hit, not a re-decode, which is
   * the whole point of content addressing. A decode failure is returned rather
   * than thrown — a broken asset in a package must cost that one graphic its
   * logo, not take the editor down.
   */
  async load(hash: string, bytes: Uint8Array): Promise<LoadResult> {
    const existing = this.#images.get(hash);
    if (existing !== undefined) return { ok: true, image: existing };

    let decoded: DecodedImage;
    try {
      decoded = await decodePng(bytes);
    } catch (error) {
      return {
        ok: false,
        reason:
          error instanceof ImageDecodeError
            ? error.message
            : `could not decode image: ${String(error)}`,
      };
    }

    const size = decoded.pixels.length;
    if (this.#bytes + size > this.#budget) {
      return {
        ok: false,
        reason:
          `image budget exceeded: ${describe(size)} would take the library ` +
          `past ${describe(this.#budget)}`,
      };
    }

    const image: ImageData = {
      width: decoded.width,
      height: decoded.height,
      // Converted in place: the decoder allocated this buffer and nobody else
      // holds it. See color.ts on why both conversions are mandatory.
      pixels: toPremultipliedLinear(decoded.pixels),
      bytes: size,
    };
    this.#images.set(hash, image);
    this.#bytes += size;
    return { ok: true, image };
  }

  /**
   * Drops an image.
   *
   * Explicit rather than automatic, for the reason in the header comment. The
   * caller that knows a document is closed is the caller that may release it.
   */
  release(hash: string): boolean {
    const image = this.#images.get(hash);
    if (image === undefined) return false;
    this.#images.delete(hash);
    this.#bytes -= image.bytes;
    return true;
  }

  clear(): void {
    this.#images.clear();
    this.#bytes = 0;
  }

  stats(): { images: number; bytes: number; budgetBytes: number } {
    return {
      images: this.#images.size,
      bytes: this.#bytes,
      budgetBytes: this.#budget,
    };
  }
}

function describe(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
