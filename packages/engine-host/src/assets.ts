/**
 * The asset system's composition root. IF-006.
 *
 * ============================================================================
 * WHY THE CODECS ARE JOINED HERE AND NOWHERE ELSE
 * ============================================================================
 * `engine-assets` is not allowed to import `engine-image`, and that restriction
 * is the architecture rather than an inconvenience: a registry that imported
 * its codecs would become the place every format lands, and adding AVIF would
 * mean editing the registry. Registered from outside, a format is a
 * registration and the registry never changes again.
 *
 * This file is therefore the only place in Streamatrix that knows both that an
 * asset system exists and that PNG does. When JPEG, WebP, SVG or glTF arrive,
 * they arrive here — one line each — and nothing above or below moves.
 *
 * At `@bracketx/engine-host/assets`, not on the package root, for the reason
 * the text adapter learned the hard way: a root re-export puts every consumer
 * behind whatever the codecs drag in, and Studio was a black page for exactly
 * that reason.
 */
import { decodePng } from "@bracketx/engine-image";
import {
  AssetRegistry,
  type AssetCodec,
  type RegistryOptions,
  type AssetStore,
} from "@bracketx/engine-assets";
import type { ImageProvider, ProvidedImage } from "@bracketx/engine-reconciler";

/**
 * PNG, as a codec.
 *
 * `probe` reads the eight-byte signature rather than trusting a MIME type or an
 * extension, because a file renamed to `.png` is routine and a user who did
 * that should get the right decoder, not a broken asset.
 */
export const PNG_CODEC: AssetCodec = {
  kind: "image",
  mimes: ["image/png"],
  probe: (bytes) =>
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47,
  decode: async (bytes) => {
    const image = await decodePng(bytes);
    return {
      kind: "image",
      // Decoded size, not encoded: a 2 MB PNG is 64 MB of RGBA8, and budgeting
      // the compressed figure would under-count by thirty times on exactly the
      // assets big enough to matter.
      bytes: image.pixels.length,
      metadata: { width: image.width, height: image.height },
      value: image,
    };
  },
};

/** Every codec Streamatrix can read today. IF-006 §2 lists what is deferred. */
export const BUILT_IN_CODECS: readonly AssetCodec[] = [PNG_CODEC];

/**
 * A registry with the built-in codecs already registered.
 *
 * The store is injected, never chosen here: local, offline-cached and cloud are
 * the same code path from the registry's point of view, which is the whole
 * reason storage is a port.
 */
export function createAssetRegistry(
  store: AssetStore,
  options: RegistryOptions = {},
): AssetRegistry {
  const registry = new AssetRegistry(store, options);
  for (const codec of BUILT_IN_CODECS) registry.addCodec(codec);
  return registry;
}

/**
 * Presents the registry as the reconciler's image port.
 *
 * An adapter rather than the registry implementing `ImageProvider` directly,
 * because the registry serves fonts, models and audio too and must not grow a
 * method per consumer. The projector asks for pixels; everything else about the
 * asset — its name, tags, history, who uses it — is none of its business.
 */
export class RegistryImageProvider implements ImageProvider {
  constructor(private readonly registry: AssetRegistry) {}

  image(assetId: string): ProvidedImage | undefined {
    const decoded = this.registry.decoded(assetId);
    if (decoded === undefined || decoded.kind !== "image") return undefined;
    const value = decoded.value as ProvidedImage | undefined;
    // Guarded rather than cast: a codec registered by a host is outside our
    // control, and a malformed payload must not reach `createTexture`.
    if (
      value === undefined ||
      typeof value.width !== "number" ||
      typeof value.height !== "number" ||
      !(value.pixels instanceof Uint8Array)
    ) {
      return undefined;
    }
    return value;
  }
}
