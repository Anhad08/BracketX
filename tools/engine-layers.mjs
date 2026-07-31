/**
 * The canonical engine dependency graph.
 *
 * SINGLE SOURCE OF TRUTH. The boundary checker and the boundary tests both read
 * this file; nothing else declares the rule. If the layer model and the code
 * disagree, exactly one of them is wrong and it is detectable.
 *
 * Derived from ENGINE_ARCHITECTURE.md §2 (layers) and IF-001 (which layer the
 * reconciler belongs to).
 *
 * `allow` is exhaustive: a workspace dependency not listed is a violation.
 * Listing a package here does not require it to depend on everything allowed.
 */

/** @typedef {{ layer: string, allow: string[], mayImportThree?: boolean }} PackageRule */

/** @type {Record<string, PackageRule>} */
export const ENGINE_PACKAGES = {
  "@bracketx/engine-scene": {
    layer: "engine-core",
    // Leaf. The scene graph must exist independently of everything —
    // Phase 2.2 requires it to compile with no runtime and no renderer.
    allow: [],
  },

  "@bracketx/engine-runtime": {
    layer: "engine-core",
    // Owns the clock, scheduler, commands, events, and both state stores.
    // Reads and mutates documents; knows nothing about rendering.
    allow: ["@bracketx/engine-scene"],
  },

  "@bracketx/engine-reconciler": {
    layer: "engine-core",
    // Projection algorithm and mirror LIFETIME ownership, expressed over
    // opaque handles. Backend-neutral by construction — see IF-001.
    allow: ["@bracketx/engine-scene", "@bracketx/engine-runtime"],
  },

  "@bracketx/engine-render-three": {
    layer: "render-adapter",
    // The ONLY package permitted to import three. Implements MirrorBackend.
    allow: [
      "@bracketx/engine-scene",
      "@bracketx/engine-runtime",
      "@bracketx/engine-reconciler",
    ],
    mayImportThree: true,
  },
};

/**
 * Packages that are not part of the engine but exist in the workspace.
 * Listed so the checker can distinguish "unknown package" from "not an engine
 * package" rather than silently ignoring typos.
 */
export const NON_ENGINE_PACKAGES = [
  "@bracketx/auth",
  "@bracketx/core",
  "@bracketx/db",
  "@bracketx/ui",
  "@bracketx/eslint-config",
  "@bracketx/typescript-config",
  "web",
];

/** Bare specifier that may appear in exactly one engine package. */
export const RENDER_BACKEND_MODULE = "three";
