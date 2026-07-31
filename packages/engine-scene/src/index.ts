/**
 * @bracketx/engine-scene — Engine Core layer.
 *
 * The scene graph: node identity, components, hierarchy, transforms,
 * operations, serialization, validation. Specified by SCENE_FORMAT.md and
 * RFC-002.
 *
 * This package is a LEAF. It depends on nothing, which is a requirement rather
 * than an accident: ENGINE_ARCHITECTURE.md §3 makes the document the source of
 * truth, so it must be constructible and verifiable with no runtime, no
 * renderer, and no I/O.
 *
 * Contents arrive in Phase 2.2. Phase 2.1 delivers the boundary only.
 */
export const ENGINE_PACKAGE = {
  name: "@bracketx/engine-scene",
  layer: "engine-core",
} as const;
