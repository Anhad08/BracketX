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
 * Contents arrive in Phase 2.5. Phase 2.1 delivers the boundary only, and
 * deliberately does not yet install three.
 */
export const ENGINE_PACKAGE = {
  name: "@bracketx/engine-render-three",
  layer: "render-adapter",
} as const;
