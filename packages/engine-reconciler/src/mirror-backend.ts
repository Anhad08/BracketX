/**
 * MirrorBackend — the engine's rendering boundary.
 *
 * ============================================================================
 * WHAT THIS IS
 * ============================================================================
 * The complete surface across which BracketX talks to a rendering backend.
 * Everything above this line is engine; everything below is replaceable.
 * `@bracketx/engine-render-three` implements it over Three.js; a native
 * runtime, a headless cloud renderer, or a future backend implements the same
 * interface and nothing above changes.
 *
 * Per IF-001, this interface is what lets two frozen invariants both hold:
 *   - ENGINE_RECONCILIATION §2.2  the reconciler owns mirror LIFETIME
 *   - RENDER_ENGINE_EVALUATION §10 exactly one package imports `three`
 * The reconciler decides when objects exist; the backend owns the instances.
 *
 * ============================================================================
 * WHY IT TAKES RESOLVED VALUES, NOT SCENE TYPES
 * ============================================================================
 * This interface deliberately knows nothing about nodes, ids, hierarchy paths,
 * variables, bindings, animation, or the scene format. It takes world matrices,
 * not transforms; material descriptors, not components.
 *
 * That is what makes it both backend-neutral AND scene-neutral: SCENE_FORMAT
 * can version to v3 without touching a backend, and a backend can be swapped
 * without touching the scene format. The reconciler is the only translator.
 *
 * ============================================================================
 * CONTRACT — binding on every implementation
 * ============================================================================
 *
 * C1  HANDLES ARE OPAQUE. Callers must never construct, inspect, arithmetic on,
 *     or persist a handle. Handle values may differ between backends and
 *     between runs of the same backend. Only the issuing backend may interpret
 *     them.
 *
 * C2  LIFETIME IS THE CALLER'S. The backend allocates on create* and frees on
 *     destroy*. It must never free on its own initiative — not under memory
 *     pressure, not on scene change. ENGINE_RUNTIME §4.4 pins on-air resources,
 *     and a backend that evicts autonomously breaks that guarantee.
 *
 * C3  NO IMPLICIT COMPUTATION. The backend must not derive transforms,
 *     traverse to compute world matrices, or infer visibility. It renders what
 *     it is told. ENGINE_RECONCILIATION §1.6 requires this so the mirror stays
 *     a pure derivation of the document.
 *
 * C4  IDEMPOTENCE. Every setter must be safe to call repeatedly with the same
 *     value, and must be equivalent to calling it once.
 *
 * C5  ORDERING. Within a projection batch, calls have no required order except
 *     that a node must exist before it is referenced as a parent. Backends must
 *     not assume calls arrive grouped per node.
 *
 * C6  SINGLE THREAD. All calls occur on the frame thread. Implementations may
 *     use workers internally but must not require the caller to.
 *
 * C7  ERRORS ARE RETURNED, NOT THROWN, for anything recoverable — a missing
 *     asset, an unsupported capability. Throwing is reserved for programming
 *     errors such as use-after-destroy. A live show must degrade, not crash.
 *
 * C8  DETERMINISM SCOPE. The backend may vary in pixel output across hardware
 *     (ARCHITECTURE_VERIFICATION D6 accepts this). It must NOT vary in
 *     structure: the same call sequence must produce the same mirror structure,
 *     the same draw order, and the same resource set on every implementation.
 *
 * C9  PREMULTIPLIED ALPHA throughout, per RFC-003 §6. Conversion to straight
 *     alpha happens at output only, if a target requires it.
 *
 * C10 COLUMN-MAJOR MATRICES, matching glTF and Three.js. A row-major backend
 *     transposes internally; it does not change this interface.
 */

// ---------------------------------------------------------------------------
// Handles
// ---------------------------------------------------------------------------

declare const brand: unique symbol;
type Branded<T, B extends string> = T & { readonly [brand]: B };

/** A node in the backend's mirror. Opaque — see C1. */
export type NodeHandle = Branded<number, "NodeHandle">;
export type GeometryHandle = Branded<number, "GeometryHandle">;
export type MaterialHandle = Branded<number, "MaterialHandle">;
export type TextureHandle = Branded<number, "TextureHandle">;
export type CameraHandle = Branded<number, "CameraHandle">;
export type RenderTargetHandle = Branded<number, "RenderTargetHandle">;

// ---------------------------------------------------------------------------
// Value types
// ---------------------------------------------------------------------------

/** Column-major 4x4, 16 elements. See C10. */
export type Mat4 = readonly number[];

/** Linear RGBA, 0..1, premultiplied. See C9. */
export type Rgba = readonly [number, number, number, number];

export type Vec2 = readonly [number, number];

/**
 * Recoverable failure. See C7.
 * `ok: false` is an expected outcome, not an exception path.
 */
export type BackendResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: BackendFailure };

export type BackendFailure =
  | { readonly kind: "unsupported"; readonly capability: string }
  | { readonly kind: "budget-exceeded"; readonly resourceClass: string }
  | { readonly kind: "invalid-data"; readonly detail: string };

/**
 * What an implementation supports. Read once at initialisation.
 *
 * Backs the Baseline/Advanced tiering in RFC-003 §3: a scene declaring
 * `advanced` is checked against this before it can be promoted, so a WebGL2
 * target warns rather than degrading silently mid-show.
 */
export interface BackendCapabilities {
  readonly name: string;
  readonly tier: "baseline" | "advanced";
  readonly maxTextureSize: number;
  readonly supportsComputeShaders: boolean;
  readonly supportsFloatRenderTargets: boolean;
}

// ---------------------------------------------------------------------------
// Descriptors
// ---------------------------------------------------------------------------

/**
 * Geometry as raw buffers. The backend uploads; it does not parse.
 *
 * Asset decoding (glTF, images, fonts) belongs to the asset pipeline, above
 * this boundary. A backend that parsed glTF would make the parser
 * backend-specific and have to be rewritten on every swap.
 */
export interface GeometryDescriptor {
  readonly positions: Float32Array;
  readonly indices?: Uint32Array;
  readonly normals?: Float32Array;
  readonly uvs?: Float32Array;
  /** Per-vertex colour, premultiplied. */
  readonly colors?: Float32Array;
}

export interface TextureDescriptor {
  readonly width: number;
  readonly height: number;
  readonly pixels: Uint8Array;
  readonly format: "rgba8" | "r8";
  /** MSDF atlases must not be filtered across glyph boundaries. */
  readonly filter: "nearest" | "linear";
}

/**
 * Material parameters.
 *
 * `unlit` is first-class rather than a special case of PBR: broadcast graphics
 * are composited over live video, where a lit surface reacting to scene lights
 * is usually wrong. ARCHITECTURE_FINAL_REVIEW §4.2 flagged that PBR defaults
 * fight broadcast needs.
 */
export type MaterialDescriptor =
  | {
      readonly kind: "unlit";
      readonly color: Rgba;
      readonly map?: TextureHandle;
      readonly transparent: boolean;
      readonly doubleSided: boolean;
    }
  | {
      readonly kind: "msdf-text";
      readonly color: Rgba;
      readonly atlas: TextureHandle;
      /** Distance-field range in texels, from the atlas generator. */
      readonly pxRange: number;
    }
  | {
      readonly kind: "pbr";
      readonly baseColor: Rgba;
      readonly metallic: number;
      readonly roughness: number;
      readonly baseColorMap?: TextureHandle;
      readonly transparent: boolean;
      readonly doubleSided: boolean;
    };

/**
 * Camera parameters.
 *
 * Perspective is specified as focal length against a sensor width, per
 * SCENE_FORMAT §8 — operators think in lenses. Vertical FOV is derived by the
 * backend, not by the caller, so every backend derives it identically.
 */
export type CameraDescriptor =
  | {
      readonly kind: "perspective";
      readonly focalLengthMm: number;
      readonly sensorWidthMm: number;
      readonly near: number;
      readonly far: number;
    }
  | {
      readonly kind: "orthographic";
      /** Half-height of the view volume, in world units. */
      readonly size: number;
      readonly near: number;
      readonly far: number;
    };

export interface RenderOptions {
  /** Null renders to the default surface. */
  readonly target: RenderTargetHandle | null;
  readonly viewport: { readonly width: number; readonly height: number };
  /**
   * Transparent by default — broadcast output composites over live video.
   * RFC-003 §6 makes alpha an explicit pass rather than an afterthought.
   */
  readonly clearColor: Rgba;
  /** Only nodes whose layer bit is set are drawn. Preview guides use this. */
  readonly layerMask: number;
}

// ---------------------------------------------------------------------------
// The interface
// ---------------------------------------------------------------------------

export interface MirrorBackend {
  readonly capabilities: BackendCapabilities;

  // -- Node lifetime. The reconciler decides; the backend allocates. --------

  createNode(): NodeHandle;
  destroyNode(node: NodeHandle): void;

  /** Null detaches from the tree without destroying. Parent must exist (C5). */
  setParent(node: NodeHandle, parent: NodeHandle | null): void;

  /** World, not local. The engine computes hierarchy — see C3. */
  setWorldMatrix(node: NodeHandle, matrix: Mat4): void;

  /** Excludes the node and its subtree. */
  setVisible(node: NodeHandle, visible: boolean): void;

  /** Layer bitmask, tested against RenderOptions.layerMask. */
  setLayers(node: NodeHandle, mask: number): void;

  /**
   * Explicit draw-order override within a pass, for transparency sorting.
   * SCENE_FORMAT §6.1 is explicit that this is not z-order.
   */
  setRenderOrder(node: NodeHandle, order: number): void;

  // -- Attachments ---------------------------------------------------------

  attachMesh(
    node: NodeHandle,
    geometry: GeometryHandle,
    material: MaterialHandle,
  ): void;

  attachCamera(node: NodeHandle, camera: CameraHandle): void;

  /** Removes any attachment. The node itself survives. */
  detach(node: NodeHandle): void;

  // -- Resources. Content-addressed upstream; opaque here. -----------------

  createGeometry(
    descriptor: GeometryDescriptor,
  ): BackendResult<GeometryHandle>;
  destroyGeometry(geometry: GeometryHandle): void;

  createTexture(descriptor: TextureDescriptor): BackendResult<TextureHandle>;
  /** In-place update for a growing glyph atlas — TEXT_ENGINE §5. */
  updateTexture(
    texture: TextureHandle,
    region: { x: number; y: number; width: number; height: number },
    pixels: Uint8Array,
  ): void;
  destroyTexture(texture: TextureHandle): void;

  createMaterial(descriptor: MaterialDescriptor): BackendResult<MaterialHandle>;
  updateMaterial(material: MaterialHandle, descriptor: MaterialDescriptor): void;
  destroyMaterial(material: MaterialHandle): void;

  createCamera(descriptor: CameraDescriptor): CameraHandle;
  updateCamera(camera: CameraHandle, descriptor: CameraDescriptor): void;
  destroyCamera(camera: CameraHandle): void;

  createRenderTarget(size: Vec2): BackendResult<RenderTargetHandle>;
  destroyRenderTarget(target: RenderTargetHandle): void;

  // -- Frame ---------------------------------------------------------------

  /**
   * Draw the mirror through a camera.
   *
   * Takes a camera per call rather than holding a "current camera", because a
   * production engine renders one scene through several cameras in a frame —
   * programme and preview. Camera-as-backend-state makes that the special case
   * instead of the default (ENGINE_ARCHITECTURE §5).
   */
  render(camera: CameraHandle, options: RenderOptions): void;

  /** Releases everything. The backend is unusable afterwards. */
  dispose(): void;
}

/**
 * Structural inspection, for tests only.
 *
 * ENGINE_RECONCILIATION invariant R9 requires that `build(document)` and
 * `project(operations)` from the same start state produce identical mirrors.
 * Handle *values* may legitimately differ between the two paths, so equality
 * has to be structural — which needs a way to read the mirror back.
 *
 * Separate from MirrorBackend so production implementations are not obliged to
 * carry it, and so it cannot be reached from the render path by accident.
 */
export interface InspectableMirrorBackend extends MirrorBackend {
  snapshot(): MirrorSnapshot;
}

export interface MirrorSnapshot {
  /** Roots first, then depth-first, so comparison is order-stable. */
  readonly nodes: readonly MirrorNodeSnapshot[];
  readonly resourceCounts: {
    readonly geometries: number;
    readonly textures: number;
    readonly materials: number;
    readonly cameras: number;
    readonly renderTargets: number;
  };
}

export interface MirrorNodeSnapshot {
  /** Stable within a snapshot; comparable across backends. Not a handle. */
  readonly path: string;
  readonly worldMatrix: Mat4;
  readonly visible: boolean;
  readonly layers: number;
  readonly renderOrder: number;
  readonly attachment: "none" | "mesh" | "camera";
}
