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
import type {
  ImageProvider,
  ModelProvider,
  ProvidedImage,
  ProvidedMesh,
} from "@bracketx/engine-reconciler";
import { parseGltf, type ParsedModel } from "@bracketx/engine-model";

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

/**
 * glTF, as a codec.
 *
 * ============================================================================
 * WHY IT PARSES AT DECODE TIME
 * ============================================================================
 * The registry's `decode` is where an asset stops being bytes and becomes
 * something usable, and it is asynchronous — which is exactly where parsing a
 * model belongs. By the time a scene's first frame is drawn, its models are
 * already geometry, for the same reason its fonts are already parsed: a
 * stadium that arrives mid-broadcast pops into the shot.
 *
 * `probe` reads the GLB magic number rather than trusting a MIME type or an
 * extension. A `.glb` renamed by a download is routine, and a JSON `.gltf` has
 * no magic number at all — hence the second branch, which is deliberately
 * narrow: it looks for glTF's own asset declaration rather than accepting any
 * JSON that happens to be handed over.
 *
 * A FILE THAT CANNOT BE READ THROWS. It does not resolve to an empty model.
 * An import that silently yields no geometry produces an asset that installs,
 * previews as nothing, places as nothing, and leaves nobody able to say why.
 */
export const GLTF_CODEC: AssetCodec = {
  kind: "model",
  mimes: ["model/gltf-binary", "model/gltf+json"],
  probe: (bytes) => {
    if (bytes.length >= 4) {
      // "glTF", little-endian.
      if (bytes[0] === 0x67 && bytes[1] === 0x6c && bytes[2] === 0x54 && bytes[3] === 0x46) {
        return true;
      }
    }
    if (bytes.length < 64) return false;
    // A JSON glTF must declare its asset version. Sniffing the first bytes for
    // `{` would claim every JSON file in the product.
    const head = new TextDecoder().decode(bytes.subarray(0, Math.min(512, bytes.length)));
    return head.includes('"asset"') && head.includes('"version"');
  },
  decode: async (bytes) => {
    // Synchronous work in an async signature: the parse is CPU-bound and there
    // is nothing to await. Kept async because the port is, and because a
    // streaming parser is a change here and nowhere else.
    const model = parseGltf(bytes);
    const vertices = model.meshes.reduce((total, mesh) => total + mesh.positions.length / 3, 0);
    return {
      kind: "model",
      // Parsed size, not encoded — the same argument PNG makes. A 120KB GLB
      // is megabytes of Float32Array, and budgeting the compressed figure
      // under-counts exactly the assets big enough to matter.
      bytes: model.meshes.reduce(
        (total, mesh) =>
          total +
          mesh.positions.byteLength +
          (mesh.indices?.byteLength ?? 0) +
          (mesh.normals?.byteLength ?? 0) +
          (mesh.uvs?.byteLength ?? 0),
        0,
      ),
      metadata: {
        meshes: model.meshes.length,
        vertices,
        nodes: model.nodes.length,
        materials: model.materials.length,
        animations: model.animations.length,
        // The product needs this to place a model at a sensible size without a
        // designer measuring it: a 40-metre stadium and a 4-centimetre badge
        // must both arrive usable.
        width: model.bounds.max[0] - model.bounds.min[0],
        height: model.bounds.max[1] - model.bounds.min[1],
        depth: model.bounds.max[2] - model.bounds.min[2],
      },
      value: model,
    };
  },
};

/**
 * Presents the registry as the reconciler's model port.
 *
 * The same adapter argument as `RegistryImageProvider`: the registry serves
 * fonts, images and audio too, and must not grow a method per consumer. The
 * projector asks for one mesh's vertices; everything else about the asset is
 * none of its business.
 */
export class RegistryModelProvider implements ModelProvider {
  constructor(private readonly registry: AssetRegistry) {}

  #model(assetId: string): ParsedModel | undefined {
    const decoded = this.registry.decoded(assetId);
    if (decoded === undefined || decoded.kind !== "model") return undefined;
    const value = decoded.value as ParsedModel | undefined;
    // Guarded rather than cast: a codec registered by a host is outside our
    // control, and a malformed payload must not reach `createGeometry`.
    return value !== undefined && Array.isArray(value.meshes) ? value : undefined;
  }

  meshCount(assetId: string): number {
    return this.#model(assetId)?.meshes.length ?? 0;
  }

  mesh(assetId: string, index: number): ProvidedMesh | undefined {
    const model = this.#model(assetId);
    const mesh = model?.meshes[index];
    if (model === undefined || mesh === undefined) return undefined;
    if (!(mesh.positions instanceof Float32Array) || mesh.positions.length === 0) return undefined;

    const material = mesh.material >= 0 ? model.materials[mesh.material] : undefined;
    return {
      positions: mesh.positions,
      ...(mesh.indices === undefined ? {} : { indices: mesh.indices }),
      ...(mesh.normals === undefined ? {} : { normals: mesh.normals }),
      ...(mesh.uvs === undefined ? {} : { uvs: mesh.uvs }),
      ...(material === undefined
        ? {}
        : {
            material: {
              baseColor: material.baseColor,
              metallic: material.metallic,
              roughness: material.roughness,
              doubleSided: material.doubleSided,
            },
          }),
    };
  }
}

/**
 * Every codec Streamatrix can read today. IF-006 §2 lists what is deferred.
 *
 * Declared last so it can name every codec above it. Anything absent from this
 * list is UNSUPPORTED and says so when a user tries to import it — the registry
 * refuses an asset it has no codec for rather than storing bytes nothing can
 * read.
 */
export const BUILT_IN_CODECS: readonly AssetCodec[] = [PNG_CODEC, GLTF_CODEC];
