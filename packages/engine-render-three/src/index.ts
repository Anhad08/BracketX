/**
 * @bracketx/engine-render-three — Render Adapter layer.
 *
 * The MirrorBackend implementation over Three.js. Specified by RFC-003 and
 * RENDER_ENGINE_EVALUATION.md §10.
 *
 * THE ONLY PACKAGE PERMITTED TO IMPORT `three`. Enforced by
 * tools/check-boundaries.mjs, not by convention. This is the entire
 * replaceable surface: swapping the rendering backend means rewriting this
 * package and nothing else, which is the property ADR-012 was accepted on.
 *
 * Owns concrete backend objects. Owns no lifetime decisions — those belong to
 * the reconciler (IF-001).
 *
 * NOTE ON EXPORTS: no Three.js type appears in any signature below. That is
 * checked by a test, not left to review.
 */
export const ENGINE_PACKAGE = {
  name: "@bracketx/engine-render-three",
  layer: "render-adapter",
} as const;

export {
  BackendViolation,
  ResourceViolation,
  ThreeMirrorBackend,
  type BackendDiagnostics,
  type ThreeBackendOptions,
} from "./three-backend";

export {
  HeadlessRendererHost,
  WebGLRendererHost,
  type HostCapabilities,
  type HostRenderOptions,
  type HostSubmission,
  type RendererHost,
} from "./renderer-host";

export {
  GpuResourceManager,
  hashBytes,
  hashString,
  type ClassStats,
  type ResourceBudget,
  type ResourceClass,
  type ResourceStats,
} from "./resources";

export {
  cubeGeometry,
  planeGeometry,
  quadGeometry,
  verticalFovDegrees,
} from "./translate";
