/**
 * The RTGFX Asset System. IF-006.
 *
 * The single source of truth for every asset in Streamatrix: identity, records,
 * storage, codecs, residency, references and health. Knows no renderer, no
 * browser and no network — those are ports, which is what lets local, offline
 * and cloud be the same code path, and lets a new format be a registration
 * rather than surgery.
 */
/**
 * Declared here so the layer model and the code cannot disagree silently —
 * `tools/boundaries.test.ts` reads this and fails if they do. It was missing
 * from this package, which meant the one check that keeps the architecture
 * honest was skipping it.
 */
export const ENGINE_PACKAGE = {
  name: "@bracketx/engine-assets",
  layer: "engine-core",
} as const;

export {
  AssetRegistry,
  type AssetReference,
  type RegistryOptions,
  type ResolveResult,
} from "./registry";
export { MemoryAssetStore } from "./store";
export { hashBytes } from "./hash";
export type {
  AssetCodec,
  AssetKind,
  AssetMetadata,
  AssetOrigin,
  AssetRecord,
  AssetStore,
  DecodedAsset,
} from "./types";
