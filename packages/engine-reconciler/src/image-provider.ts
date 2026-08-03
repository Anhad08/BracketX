/**
 * The image port. IF-005.
 *
 * ============================================================================
 * WHY A PORT WHEN THE DECODER IS CHEAP TO IMPORT
 * ============================================================================
 * `engine-text` earned its port because `harfbuzzjs` instantiates WASM at
 * import time. `engine-image` has no such cost — it is a PNG decoder and a
 * lookup table.
 *
 * The port exists for the other reason, which outlives that one: **the
 * projector must not know what an image format is.** JPEG, WebP and SVG all
 * arrive later, and SVG is not even a decode — it is a rasterisation with a
 * size bucket, or a tessellation to geometry. Every one of those is a change
 * behind this interface and none of them is a change to projection.
 *
 * A scene with no image provider wired attaches nothing for an `image`
 * component and the node survives unattached, which is what an asset-backed
 * mesh and a text node already do.
 *
 * ============================================================================
 * WHAT CROSSES, AND WHAT DOES NOT
 * ============================================================================
 * Pixels cross. Handles do not. `createTexture` is called by the projector,
 * because MirrorBackend C2 makes GPU lifetime the caller's — a provider that
 * created textures would be a second owner of them, which is the bug C2 exists
 * to prevent.
 *
 * The provider is SYNCHRONOUS on purpose. Decoding is asynchronous and belongs
 * to loading, not to projection: a scene's images are decoded before its first
 * frame, exactly as TEXT_ENGINE §3 requires of fonts, because an image
 * resolving mid-broadcast pops on screen. Asking here either hits or misses.
 */

/** Decoded pixels, ready for `createTexture`: premultiplied linear RGBA8. */
export interface ProvidedImage {
  readonly width: number;
  readonly height: number;
  readonly pixels: Uint8Array;
}

export interface ImageProvider {
  /**
   * The decoded image for an asset, or undefined if it is not loaded.
   *
   * A miss is normal and not an error: it means the asset has not finished
   * loading, or failed to. The node then draws nothing, which is the honest
   * result — a placeholder rectangle standing in for a sponsor logo is the kind
   * of thing that reaches air.
   */
  image(assetId: string): ProvidedImage | undefined;
}
