/**
 * The image adapter. The composition root's half of IF-005.
 *
 * ============================================================================
 * WHY THIS IS A SEPARATE ENTRY POINT
 * ============================================================================
 * At `@bracketx/engine-host/image`, not on the package root, for the reason the
 * text adapter learned the hard way: a root re-export puts EVERY consumer
 * behind whatever the decoder drags in. Studio was a completely black page for
 * exactly that reason, and the fix was a subpath. The cost is opt-in here by
 * construction rather than by anyone remembering.
 *
 * This is the only place that knows both `ImageLibrary` and `ImageProvider`,
 * which is what a composition root is for.
 */
import { ImageLibrary, type ImageLibraryOptions } from "@bracketx/engine-image";
import type { ImageProvider, ProvidedImage } from "@bracketx/engine-reconciler";

export type HostImageOptions = ImageLibraryOptions;

export class HostImageProvider implements ImageProvider {
  readonly library: ImageLibrary;

  /**
   * Asset id -> content hash.
   *
   * Two levels because they answer different questions. A DOCUMENT references
   * an asset id; the LIBRARY is keyed by content, so one logo shared by five
   * packages decodes once however many ids point at it.
   */
  readonly #hashes = new Map<string, string>();

  constructor(options: HostImageOptions = {}) {
    this.library = new ImageLibrary(options);
  }

  /**
   * Decodes an asset and makes it available to projection.
   *
   * Asynchronous, and deliberately not called from projection: a scene's images
   * are loaded before its first frame, exactly as TEXT_ENGINE §3 requires of
   * fonts. An image that resolved mid-broadcast would pop on screen.
   *
   * Returns the failure reason rather than throwing, so one broken asset in a
   * package costs that graphic its logo instead of stopping the show.
   */
  async load(
    assetId: string,
    hash: string,
    bytes: Uint8Array,
  ): Promise<{ ok: true } | { ok: false; reason: string }> {
    const result = await this.library.load(hash, bytes);
    if (!result.ok) return { ok: false, reason: result.reason };
    this.#hashes.set(assetId, hash);
    return { ok: true };
  }

  /** Synchronous, because projection is. A miss means "not loaded yet". */
  image(assetId: string): ProvidedImage | undefined {
    const hash = this.#hashes.get(assetId);
    return hash === undefined ? undefined : this.library.get(hash);
  }

  has(assetId: string): boolean {
    return this.image(assetId) !== undefined;
  }

  stats(): ReturnType<ImageLibrary["stats"]> {
    return this.library.stats();
  }
}
