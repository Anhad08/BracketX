/**
 * @bracketx/engine-reconciler — Engine Core layer.
 *
 * Projection of operations onto a mirror, and ownership of mirror LIFETIME.
 * Specified by ENGINE_RECONCILIATION.md.
 *
 * Backend-neutral by construction. It expresses the mirror as opaque handles
 * and a MirrorBackend interface; it never names a rendering library. Per
 * IF-001, this is what lets ENGINE_RECONCILIATION.md §2.2 (reconciler owns
 * mirror lifetime) and RENDER_ENGINE_EVALUATION.md §10 (exactly one package
 * imports three) both hold.
 *
 * Projection, not diffing — ENGINE_RECONCILIATION.md §1.2. Operations already
 * carry what changed, so no tree comparison is required.
 *
 * Contents arrive in Phase 2.4. Phase 2.1 delivers the boundary only.
 */
export const ENGINE_PACKAGE = {
  name: "@bracketx/engine-reconciler",
  layer: "engine-core",
} as const;

export type {
  BackendCapabilities,
  BackendFailure,
  BackendResult,
  CameraDescriptor,
  CameraHandle,
  GeometryDescriptor,
  GeometryHandle,
  InspectableMirrorBackend,
  Mat4,
  MaterialDescriptor,
  MaterialHandle,
  MirrorBackend,
  MirrorNodeSnapshot,
  MirrorSnapshot,
  NodeHandle,
  RenderOptions,
  RenderTargetHandle,
  Rgba,
  TextureDescriptor,
  TextureHandle,
  Vec2,
} from "./mirror-backend";
