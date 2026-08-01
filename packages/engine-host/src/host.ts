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

import {
  OutputSet,
  type OutputDescriptor,
  type OutputStats,
  type ResolvedOutput,
} from "./output";

export class HostError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HostError";
  }
}

export interface SceneHostOptions {
  /**
   * Bind a default output sized from the document on load.
   *
   * On by default: the overwhelmingly common case is one scene to one surface,
   * and requiring an explicit bind for it would be ceremony. Set false when the
   * caller manages outputs itself — a render farm, a multi-surface show.
   */
  readonly defaultOutput?: boolean;
  /** Re-verify mirror consistency after every projection. Debug builds only. */
  readonly verify?: boolean;
}

/** The id given to the output bound automatically on load. */
export const DEFAULT_OUTPUT_ID = "default";

export interface FrameResult {
  readonly frame: number;
  /** True when at least one output was drawn. */
  readonly drawn: boolean;
  /** Outputs submitted this frame, in bind order. */
  readonly rendered: readonly string[];
  /** Outputs skipped by cadence. Not a fault. */
  readonly skipped: readonly string[];
  /** Outputs that resolved no camera. A fault, and reported as one. */
  readonly missed: readonly string[];
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
  #outputs = new OutputSet();
  #bindDefaultOutput: boolean;
  #disposed = false;
  #framesRendered = 0;
  #submissions = 0;

  constructor(
    private readonly backend: MirrorBackend,
    options: SceneHostOptions = {},
  ) {
    this.runtime = new Runtime();
    this.reconciler = new Reconciler(backend, {
      verifyAfterEachProjection: options.verify ?? false,
    });
    this.#variables = new RuntimeVariableSource(this.runtime);
    this.#bindDefaultOutput = options.defaultOutput ?? true;
  }

  get document(): SceneDocument | null {
    return this.#document;
  }

  /** Frames the host advanced. Not the number of draws — see `submissions`. */
  get framesRendered(): number {
    return this.#framesRendered;
  }

  /** Total draws across all outputs. Exceeds framesRendered when multi-output. */
  get submissions(): number {
    return this.#submissions;
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
    this.#cameraNodeId = findCameraNode(document);
    this.#bindDefaultOutputFor(document);

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
    this.#framesRendered += 1;

    const frame = this.runtime.clock.frame;
    const rendered: string[] = [];
    const skipped: string[] = [];
    const missed: string[] = [];

    // Bind order, deliberately. Two outputs sharing a render target must
    // produce the same result every run; Map iteration order is the only
    // thing standing between that and "usually correct".
    for (const output of this.#outputs.list()) {
      if (!this.#outputs.drawsOn(output, frame)) {
        this.#outputs.recordSkipped(output.id);
        skipped.push(output.id);
        continue;
      }

      const camera = this.cameraFor(output);
      if (camera === null) {
        // A scene with no camera is a legitimate state while authoring, and an
        // output pointed at a camera that has gone away is an operator error.
        // Neither should throw mid-show; both are counted and reported.
        this.#outputs.recordMissed(output.id);
        missed.push(output.id);
        continue;
      }

      this.backend.render(camera, {
        target: output.target,
        viewport: { width: output.width, height: output.height },
        clearColor: output.clearColor,
        layerMask: output.layerMask,
      } satisfies RenderOptions);

      this.#outputs.recordRendered(output.id);
      this.#submissions += 1;
      rendered.push(output.id);
    }

    return { frame, drawn: rendered.length > 0, rendered, skipped, missed };
  }

  // -------------------------------------------------------------------------
  // Outputs
  // -------------------------------------------------------------------------

  /** Binds an output, or rebinds one in place, preserving its counters. */
  bindOutput(descriptor: OutputDescriptor): ResolvedOutput {
    this.#assertUsable();
    return this.#outputs.bind(descriptor);
  }

  /** Returns false when nothing was bound under that id. */
  unbindOutput(id: string): boolean {
    this.#assertUsable();
    return this.#outputs.unbind(id);
  }

  /** Bound outputs, in bind order. */
  get outputs(): readonly ResolvedOutput[] {
    return this.#outputs.list();
  }

  outputStats(): readonly OutputStats[] {
    return this.#outputs.stats();
  }

  /**
   * The camera an output draws through.
   *
   * An output may name its own camera node — that is how a preview differs
   * from a programme feed, and how a virtual-production texture sees the scene
   * from somewhere else. Omitting it follows the scene's active camera.
   */
  cameraFor(output: ResolvedOutput): CameraHandle | null {
    const nodeId = output.cameraNodeId ?? this.#cameraNodeId;
    if (nodeId === null) return null;
    const node = this.reconciler.mirror.get(nodeId);
    if (node === undefined) return null;
    return node.attachment.kind === "camera" ? node.attachment.camera : null;
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
   * Resizes an output. Defaults to the one bound on load.
   *
   * Size lives on the output, not the host: two outputs of different sizes is
   * the normal case, and a host-level size could not express it. It reaches the
   * backend as RenderOptions.viewport on the next frame — MirrorBackend has no
   * setSize, deliberately, because the surface being drawn into belongs to
   * whoever created it.
   */
  setOutputSize(
    width: number,
    height: number,
    id: string = DEFAULT_OUTPUT_ID,
  ): void {
    this.#assertUsable();
    const existing = this.#outputs.get(id);
    if (existing === undefined) {
      throw new HostError(`setOutputSize: no output bound as "${id}"`);
    }
    this.#outputs.bind({ ...existing, width, height });
  }

  // -------------------------------------------------------------------------
  // Teardown
  // -------------------------------------------------------------------------

  dispose(): void {
    if (this.#disposed) return;
    if (this.#document !== null) this.reconciler.teardown();
    this.#document = null;
    this.#cameraNodeId = null;
    this.#outputs.clear();
    this.#disposed = true;
  }

  // -------------------------------------------------------------------------

  /**
   * Binds the default output from the document's declared resolution.
   *
   * SCENE_FORMAT §4 makes the document state its own output size, so the
   * common single-surface case needs no configuration. Rebinding preserves
   * counters, so reloading a document does not reset an output's telemetry.
   */
  #bindDefaultOutputFor(document: SceneDocument): void {
    if (!this.#bindDefaultOutput) return;
    if (this.#outputs.has(DEFAULT_OUTPUT_ID)) return;

    const output = document.world?.output;
    this.#outputs.bind({
      id: DEFAULT_OUTPUT_ID,
      width: output?.width ?? 1920,
      height: output?.height ?? 1080,
    });
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
