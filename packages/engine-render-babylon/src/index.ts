/**
 * The Babylon render adapter.
 *
 * The second implementation of `MirrorBackend`, and the reason the boundary is
 * now a fact rather than a claim: the same document, through the same
 * reconciler, drawn by a different library, checked by a conformance suite
 * that runs against both.
 *
 * Nothing above `render-adapter` may know which renderer it is talking to.
 * `tools/check-boundaries.mjs` enforces that per renderer — this package is
 * the sole permitted importer of Babylon, and naming a three type in here is
 * a violation too.
 */
export const ENGINE_PACKAGE = {
  name: "@bracketx/engine-render-babylon",
  layer: "render-adapter",
} as const;

export { BabylonMirrorBackend, type BabylonBackendOptions } from "./babylon-backend";
export { createBabylonCanvasBackend, type BabylonCanvasOptions } from "./canvas-backend";
