/**
 * The composition root. Phase 2.6.
 *
 * ============================================================================
 * WHY THIS PACKAGE EXISTS
 * ============================================================================
 * Every subsystem below this one is deliberately incomplete on its own. The
 * runtime owns time but knows nothing about scenes. The reconciler projects a
 * document onto a mirror but never decides when. A backend draws what it is
 * told but is told nothing by itself. Something has to own the sentence
 * "advance time, project what changed, then draw" — and if that lived inside
 * any of them, that one would stop being replaceable.
 *
 * So it lives here, and this package depends on all three while depending on
 * NO backend. `SceneHost` takes a `MirrorBackend`, which is why swapping
 * Three.js for WebGPU never touches this file.
 *
 * This is the layer at which BracketX stops being a set of subsystems and
 * becomes an engine.
 */
import {
  applyTransaction,
  walk,
  type SceneDocument,
  type Transaction,
} from "@bracketx/engine-scene";
import {
  Runtime,
  resolveVariable,
  type RuntimeValue,
} from "@bracketx/engine-runtime";
import {
  Reconciler,
  type CameraHandle,
  type MirrorBackend,
  type ProjectionReport,
  type RenderOptions,
  type VariableSource,
} from "@bracketx/engine-reconciler";

export class HostError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HostError";
  }
}

export interface SceneHostOptions {
  /** Output size in pixels. Defaults to the document's world output. */
  readonly width?: number;
  readonly height?: number;
  /**
   * Clear colour. Defaults to fully transparent, because broadcast output
   * composites over live video — an opaque default is a black hole on air.
   */
  readonly clearColor?: readonly [number, number, number, number];
  /** Re-verify mirror consistency after every projection. Debug builds only. */
  readonly verify?: boolean;
}

export interface FrameResult {
  readonly frame: number;
  readonly drawn: boolean;
  readonly camera: CameraHandle | null;
}

/**
 * Reads variables out of runtime state.
 *
 * The reconciler consumes resolved values and does not know where they come
 * from; this is the adapter that makes runtime state the source. Overrides win
 * over defaults, which is what an operator's manual takeover means.
 */
class RuntimeVariableSource implements VariableSource {
  constructor(private readonly runtime: Runtime) {}

  read(key: string): unknown {
    return resolveVariable(this.runtime.state, key, undefined);
  }
}

export class SceneHost {
  readonly runtime: Runtime;
  readonly reconciler: Reconciler;

  #document: SceneDocument | null = null;
  #variables: RuntimeVariableSource;
  #cameraNodeId: string | null = null;
  #width: number;
  #height: number;
  #clearColor: readonly [number, number, number, number];
  #disposed = false;
  #framesRendered = 0;

  constructor(
    private readonly backend: MirrorBackend,
    options: SceneHostOptions = {},
  ) {
    this.runtime = new Runtime();
    this.reconciler = new Reconciler(backend, {
      verifyAfterEachProjection: options.verify ?? false,
    });
    this.#variables = new RuntimeVariableSource(this.runtime);
    this.#width = options.width ?? 1920;
    this.#height = options.height ?? 1080;
    this.#clearColor = options.clearColor ?? [0, 0, 0, 0];
  }

  get document(): SceneDocument | null {
    return this.#document;
  }

  get framesRendered(): number {
    return this.#framesRendered;
  }

  /** The node whose camera is used for rendering, if the scene has one. */
  get cameraNodeId(): string | null {
    return this.#cameraNodeId;
  }

  // -------------------------------------------------------------------------
  // Loading
  // -------------------------------------------------------------------------

  /**
   * Loads a document and builds the mirror.
   *
   * Seeds runtime variables from the document's declared defaults first, so
   * the very first projection resolves bindings to real values rather than
   * rendering a frame of undefined and correcting it next tick.
   */
  load(document: SceneDocument): ProjectionReport {
    this.#assertUsable();
    if (this.#document !== null) this.reconciler.teardown();

    this.runtime.dispatchBatch(
      document.variables.map((variable) => ({
        type: "variable.set" as const,
        key: variable.key,
        value: variable.default as RuntimeValue,
      })),
    );
    // Commands only take effect on a tick — that is the whole point of the
    // command queue (ENGINE_RUNTIME §3). Drain them before projecting.
    this.runtime.tick();

    this.#document = document;
    this.#applyOutputSize(document);
    this.#cameraNodeId = findCameraNode(document);

    return this.reconciler.build(document, this.#variables);
  }

  /** Applies a transaction to the document and projects it. */
  apply(transaction: Transaction): ProjectionReport {
    this.#assertUsable();
    const document = this.#requireDocument("apply");

    // Order matters and is fixed by ENGINE_RECONCILIATION §1.5: the document
    // must already have the transaction applied before it is projected.
    const next = applyTransaction(document, transaction);
    this.#document = next;
    return this.reconciler.project(transaction, next, this.#variables);
  }

  /**
   * Sets a runtime variable and re-resolves only the nodes that read it.
   *
   * This is the live path — a score changing mid-show. It is deliberately not
   * an operation: runtime values are not document edits, are not undoable, and
   * are not persisted (RFC-002 §4.3).
   */
  setVariable(key: string, value: RuntimeValue): ProjectionReport {
    this.#assertUsable();
    this.#requireDocument("setVariable");

    this.runtime.dispatch({ type: "variable.set", key, value });
    this.runtime.tick();

    return this.reconciler.invalidateVariables([key], this.#variables);
  }

  // -------------------------------------------------------------------------
  // Transport
  // -------------------------------------------------------------------------

  /*
   * The clock starts stopped, and load() does not start it. A graphic that has
   * been loaded is cued, not on air — auto-playing on load would mean a scene
   * begins animating the moment an operator opens it in the editor.
   */

  play(): void {
    this.#assertUsable();
    this.runtime.dispatch({ type: "clock.play" });
    this.runtime.tick();
  }

  pause(): void {
    this.#assertUsable();
    this.runtime.dispatch({ type: "clock.pause" });
    this.runtime.tick();
  }

  stop(): void {
    this.#assertUsable();
    this.runtime.dispatch({ type: "clock.stop" });
    this.runtime.tick();
  }

  // -------------------------------------------------------------------------
  // Frame
  // -------------------------------------------------------------------------

  /**
   * Advances time and draws one frame.
   *
   * `wallMs` comes from the host — the runtime never reads a clock itself
   * (ENGINE_RUNTIME invariant I2). Omitting it advances in fixed-timestep
   * mode, which is what offline rendering and tests use.
   */
  renderFrame(wallMs?: number): FrameResult {
    this.#assertUsable();
    this.#requireDocument("renderFrame");

    this.runtime.tick(wallMs);

    const camera = this.activeCamera();
    if (camera === null) {
      // A scene with no camera is a legitimate intermediate state while
      // authoring. Refusing to draw is correct; throwing would not be.
      return { frame: this.runtime.clock.frame, drawn: false, camera: null };
    }

    this.backend.render(camera, {
      target: null,
      viewport: { width: this.#width, height: this.#height },
      clearColor: this.#clearColor,
      layerMask: 0xffffffff,
    } satisfies RenderOptions);

    this.#framesRendered += 1;
    return { frame: this.runtime.clock.frame, drawn: true, camera };
  }

  /** The camera handle for the active camera node, if it has one attached. */
  activeCamera(): CameraHandle | null {
    if (this.#cameraNodeId === null) return null;
    const node = this.reconciler.mirror.get(this.#cameraNodeId);
    if (node === undefined) return null;
    return node.attachment.kind === "camera" ? node.attachment.camera : null;
  }

  /** Chooses which camera node renders. Throws if it has no camera. */
  setActiveCamera(nodeId: string): void {
    this.#assertUsable();
    const node = this.reconciler.mirror.get(nodeId);
    if (node === undefined) {
      throw new HostError(`setActiveCamera: no node "${nodeId}" in the mirror`);
    }
    if (node.attachment.kind !== "camera") {
      throw new HostError(`setActiveCamera: node "${nodeId}" has no camera`);
    }
    this.#cameraNodeId = nodeId;
  }

  /**
   * Resizes the output.
   *
   * Only records the size — it travels to the backend as RenderOptions.viewport
   * on the next frame. MirrorBackend has no setSize, deliberately: the surface
   * being drawn into belongs to whoever created it, and a backend that owned
   * canvas sizing could not render into a texture or an offscreen target.
   */
  setSize(width: number, height: number): void {
    this.#assertUsable();
    this.#width = width;
    this.#height = height;
  }

  get size(): { width: number; height: number } {
    return { width: this.#width, height: this.#height };
  }

  // -------------------------------------------------------------------------
  // Teardown
  // -------------------------------------------------------------------------

  dispose(): void {
    if (this.#disposed) return;
    if (this.#document !== null) this.reconciler.teardown();
    this.#document = null;
    this.#cameraNodeId = null;
    this.#disposed = true;
  }

  // -------------------------------------------------------------------------

  /** The document declares its own output resolution — SCENE_FORMAT §4. */
  #applyOutputSize(document: SceneDocument): void {
    const output = document.world?.output;
    if (output) {
      this.#width = output.width;
      this.#height = output.height;
    }
  }

  #requireDocument(operation: string): SceneDocument {
    if (this.#document === null) {
      throw new HostError(`${operation}() before load()`);
    }
    return this.#document;
  }

  #assertUsable(): void {
    if (this.#disposed) throw new HostError("the host has been disposed");
  }
}

/**
 * The first node carrying a camera component, in document order.
 *
 * Deterministic by construction: `walk` yields parents before children and
 * children in order-key order, so the same document always picks the same
 * camera on every machine and every run.
 */
export function findCameraNode(document: SceneDocument): string | null {
  for (const node of walk(document.root)) {
    if (node.components?.some((component) => component.type === "camera")) {
      return node.id;
    }
  }
  return null;
}
