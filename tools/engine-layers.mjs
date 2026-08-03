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

  "@bracketx/engine-text": {
    layer: "engine-core",
    // Owns the whole pipeline from font binary to geometry (TEXT_ENGINE §1).
    // Depends on the scene graph for component and asset types; knows nothing
    // about a renderer, because glyph geometry is backend-neutral.
    allow: ["@bracketx/engine-scene"],
  },

  "@bracketx/engine-image": {
    layer: "engine-core",
    // Owns the whole path from an encoded file to premultiplied linear RGBA
    // (IF-005). Depends on the scene graph for asset types; knows nothing about
    // a renderer, because pixels are backend-neutral — the same argument that
    // keeps engine-text off a backend.
    allow: ["@bracketx/engine-scene"],
  },

  "@bracketx/engine-host": {
    layer: "engine-host",
    // The COMPOSITION ROOT. The only package that may know both the reconciler
    // and a concrete frame loop. Deliberately NOT allowed to import a backend:
    // it takes a MirrorBackend, so swapping renderers never touches it.
    //
    // It IS allowed to know engine-text, and that edge is the reason a
    // composition root exists. The reconciler declares a TextProvider port and
    // never imports the text engine, because `harfbuzzjs` instantiates a WASM
    // binary at import time and a colour-bar scene must not pay for it. Someone
    // has to join the two; this is the package whose job that is.
    allow: [
      "@bracketx/engine-scene",
      "@bracketx/engine-runtime",
      "@bracketx/engine-reconciler",
      "@bracketx/engine-text",
      "@bracketx/engine-image",
    ],
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
  // The engine's first consumer and permanent visual verification suite. Not
  // an engine package: it may depend on any of them and none may depend on it.
  "showcase",
  "studio",
];

/** Bare specifier that may appear in exactly one engine package. */
export const RENDER_BACKEND_MODULE = "three";

/**
 * Type names that must not appear outside the render adapter.
 *
 * The import check alone is necessary but not sufficient: a package could
 * re-export a Three type through @bracketx/engine-render-three without ever
 * naming `three`, which would make the backend un-swappable while passing a
 * pure import check. Phase 2.5n.
 */
export const RENDER_BACKEND_TYPES = [
  "WebGLRenderer",
  "Object3D",
  "Matrix4",
  "Vector3",
  "Quaternion",
  "BufferGeometry",
  "PerspectiveCamera",
  "OrthographicCamera",
];
