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
  tokenMap,
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

import { Animator, type AnimationFrame, type PlayOptions } from "./animator";
import {
  LiveCommandLog,
  applyCollectionCommand,
  asCollection,
  canonicalSession,
  isCollectionCommand,
  validateLiveCommand,
  type LiveCommand,
  type LiveResult,
  type SessionSnapshot,
} from "./live";
import {
  OutputSet,
  type OutputDescriptor,
  type OutputStats,
  type ResolvedOutput,
} from "./output";

/**
 * Monotonic clock for measurement only.
 *
 * Separate from the runtime clock on purpose: this measures how long the engine
 * took, which is a property of the machine. The runtime clock measures show
 * time, which is a property of the production. Conflating them is how a slow
 * frame turns into a dropped frame of content.
 */
const now: () => number =
  typeof performance !== "undefined" && typeof performance.now === "function"
    ? () => performance.now()
    : () => Date.now();

const ZERO_TIMINGS: FrameTimings = {
  total: 0,
  runtime: 0,
  animation: 0,
  render: 0,
};

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

/**
 * Where a frame's time went.
 *
 * Milliseconds, from performance.now(). Always collected: the measurement is
 * six clock reads per frame against a 16.67ms budget, and an engine that can
 * only be measured when someone remembers to enable measurement is one whose
 * production behaviour is a mystery. "Observable" is an engineering standard
 * here, not a debug feature.
 *
 * `render` is SUBMISSION time, not GPU time. What the GPU then does with the
 * commands is not visible from this side of the boundary — see
 * RENDER_BACKEND_VERIFICATION §7.
 */
export interface FrameTimings {
  /** Everything renderFrame did. */
  readonly total: number;
  /** Clock advance, command drain, scheduler. */
  readonly runtime: number;
  /** Clip sampling plus re-projection of changed nodes. */
  readonly animation: number;
  /** Draw submission across every output. */
  readonly render: number;
}

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
  readonly timings: FrameTimings;
}

/**
 * Reads variables out of runtime state.
 *
 * The reconciler consumes resolved values and does not know where they come
 * from; this is the adapter that makes runtime state the source. Overrides win
 * over defaults, which is what an operator's manual takeover means.
 */
class RuntimeVariableSource implements VariableSource {
  #tokens: ReadonlyMap<string, unknown> = new Map();

  constructor(private readonly runtime: Runtime) {}

  setTokens(tokens: ReadonlyMap<string, unknown>): void {
    this.#tokens = tokens;
  }

  /**
   * Variables first, tokens beneath.
   *
   * Tokens are design defaults; a variable of the same name is a deliberate
   * override and must win. Resolving them in one chain rather than two systems
   * is the whole point — a second resolver would be a second source of truth
   * (Project Alpha A6).
   */
  read(key: string): unknown {
    const value = resolveVariable(this.runtime.state, key, undefined);
    if (value !== undefined) return value;
    return this.#tokens.get(key);
  }
}

export class SceneHost {
  readonly runtime: Runtime;
  readonly reconciler: Reconciler;
  readonly animator = new Animator();
  /** Every live input, in order, with its outcome. Phase 7. */
  readonly log = new LiveCommandLog();

  #document: SceneDocument | null = null;
  #variables: RuntimeVariableSource;
  #cameraNodeId: string | null = null;
  #outputs = new OutputSet();
  #bindDefaultOutput: boolean;
  #disposed = false;
  #framesRendered = 0;
  #submissions = 0;
  /** Monotonic, host-supplied. Recorded, never read during apply. */
  #timestamp = 0;
  #lastReport: ProjectionReport | null = null;
  #lastTimings: FrameTimings = ZERO_TIMINGS;

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

    this.#variables.setTokens(tokenMap(document.tokens));
    this.animator.load(document);
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
  // Live Control — Phase 7
  // -------------------------------------------------------------------------

  /**
   * The single entry point for every live input.
   *
   * An operator keypress, a data feed, an automation cue, and an AI suggestion
   * all arrive here. There is deliberately no faster path for urgent updates:
   * the moment one exists, replay stops reproducing reality.
   *
   * Never throws for a bad command. A malformed message from a feed is recorded
   * and reported, not allowed to unwind the frame that a dozen good commands
   * were applied in.
   */
  applyLive(command: LiveCommand, source = "unknown"): LiveResult {
    this.#assertUsable();

    const frame = this.runtime.clock.frame;
    const startedAt = now();
    const reason = validateLiveCommand(command) ?? this.#applyLive(command);
    const durationMs = now() - startedAt;

    const record = this.log.record(
      command,
      frame,
      this.#timestamp++,
      reason,
      source,
      durationMs,
    );

    return {
      accepted: record.accepted,
      sequence: record.sequence,
      ...(record.reason === undefined ? {} : { reason: record.reason }),
    };
  }

  /** Applies commands in order, stopping at none. Returns each outcome. */
  applyBatch(
    commands: readonly LiveCommand[],
    source = "unknown",
  ): readonly LiveResult[] {
    return commands.map((command) => this.applyLive(command, source));
  }

  /**
   * Re-applies a command sequence against the current document.
   *
   * Sequence order only — `timestamp` is recorded but never read, because an
   * engine that behaved differently for a command arriving at a different wall
   * time would not be replayable, and wall time is the one input a replay
   * cannot reproduce.
   */
  replay(commands: readonly LiveCommand[]): readonly LiveResult[] {
    this.#assertUsable();
    // Tagged so a replayed session is distinguishable from a live one in the
    // log. A recording that looks identical to the thing it replays is a
    // recording nobody can debug with.
    return this.applyBatch(commands, "replay");
  }

  /** Deterministic snapshot of the running production. */
  session(): SessionSnapshot {
    const variables: Record<string, RuntimeValue> = {};
    for (const [key, value] of this.runtime.state.variables) {
      variables[key] = value;
    }

    return {
      sceneId: this.#document?.id ?? null,
      frame: this.runtime.clock.frame,
      playing: this.runtime.clock.snapshot().status === "playing",
      states: this.activeStates,
      variables,
      outputs: this.outputs.map((output) => ({
        id: output.id,
        width: output.width,
        height: output.height,
        cadence: output.cadence,
      })),
      activeClips: this.animator.playing,
      heldClips: this.animator.clips
        .filter((clip) => this.animator.isHeld(clip.id))
        .map((clip) => clip.id),
      runtimeHash: this.runtime.stateHash,
      commandsApplied: this.log.accepted,
    };
  }

  /** Canonical form of the session. Equal strings mean equal sessions. */
  sessionHash(): string {
    return canonicalSession(this.session());
  }

  /** The most recent projection report. Diagnostics. */
  get lastReport(): ProjectionReport | null {
    return this.#lastReport;
  }

  /**
   * Applies one command. Returns a rejection reason, or null on success.
   *
   * Every branch routes through either the runtime's command queue or
   * host-owned state that only this method mutates. Nothing here writes
   * engine state directly.
   */
  #applyLive(command: LiveCommand): string | null {
    if (this.#document === null && command.type !== "scene.deactivate") {
      return "no document loaded";
    }

    switch (command.type) {
      case "variable.set":
      case "template.setParameter":
        this.#lastReport = this.setVariable(command.key, command.value);
        return null;

      case "variable.clear":
        this.runtime.dispatch({ type: "variable.clear", key: command.key });
        this.runtime.tick();
        this.#lastReport = this.reconciler.invalidateVariables(
          [command.key],
          this.#variables,
        );
        return null;

      case "state.set":
        this.setStates(command.states);
        return null;

      case "state.add": {
        if (this.activeStates.includes(command.state)) return null;
        this.setStates([...this.activeStates, command.state]);
        return null;
      }

      case "state.remove": {
        if (!this.activeStates.includes(command.state)) return null;
        this.setStates(
          this.activeStates.filter((state) => state !== command.state),
        );
        return null;
      }

      case "output.bind":
        this.bindOutput(command.output);
        return null;

      case "output.unbind":
        return this.unbindOutput(command.id)
          ? null
          : `no output bound as "${command.id}"`;

      case "output.resize":
        try {
          this.setOutputSize(command.width, command.height, command.id);
          return null;
        } catch (error) {
          return String((error as Error).message);
        }

      case "playback.play":
        this.play();
        return null;

      case "playback.pause":
        this.pause();
        return null;

      case "playback.stop":
        this.stop();
        return null;

      case "playback.seek":
        this.seek(command.frame);
        return null;

      case "clip.play":
        try {
          this.playClip(command.clipId, command.options ?? {});
          return null;
        } catch (error) {
          return String((error as Error).message);
        }

      case "clip.stop":
        return this.stopClip(command.clipId)
          ? null
          : `clip "${command.clipId}" was not playing`;

      case "scene.activate":
        this.runtime.dispatch({
          type: "scene.setActive",
          sceneId: command.sceneId,
        });
        this.runtime.tick();
        return null;

      case "scene.deactivate":
        this.runtime.dispatch({ type: "scene.setActive", sceneId: null });
        this.runtime.tick();
        return null;

      default: {
        if (!isCollectionCommand(command)) return "unknown command";

        const current = asCollection(this.#variables.read(command.key));
        const next = applyCollectionCommand(current, command);

        // An operation that changed nothing — a patch that matched no item,
        // a remove of an absent id — returns the ORIGINAL array by reference,
        // so the projection is skipped entirely rather than diffing a list
        // against itself.
        if (next === current) return null;

        this.#lastReport = this.setVariable(
          command.key,
          next as unknown as RuntimeValue,
        );
        return null;
      }
    }
  }

  // -------------------------------------------------------------------------
  // Animation
  // -------------------------------------------------------------------------

  /**
   * Starts a clip, anchored to the current frame.
   *
   * Anchoring to a frame rather than storing a playhead is what makes seeking
   * free: move the clock and the next sample is already correct.
   */
  playClip(clipId: string, options: PlayOptions = {}): void {
    this.#assertUsable();
    this.animator.play(clipId, this.runtime.clock.frame, options);
  }

  stopClip(clipId: string): boolean {
    this.#assertUsable();
    const stopped = this.animator.stop(clipId);
    if (stopped) this.#applyAnimationFrame(false);
    return stopped;
  }

  /**
   * Moves the clock to a frame and re-evaluates without firing events.
   *
   * Scrubbing a timeline must not trigger cues. A seek crosses arbitrarily many
   * events at once, and firing them is how a graphic goes on air during
   * rehearsal.
   */
  seek(frame: number): AnimationFrame {
    this.#assertUsable();
    this.#requireDocument("seek");
    this.runtime.dispatch({ type: "clock.seek", frame });
    this.runtime.tick();
    return this.#applyAnimationFrame(false);
  }

  // -------------------------------------------------------------------------
  // States
  // -------------------------------------------------------------------------

  /**
   * Replaces the active state set and re-projects the nodes that declare them.
   *
   * States are runtime, not document: activating one is not an edit, is not
   * undoable, and is not persisted — the same rule variables follow
   * (RFC-002 §4.3).
   */
  setStates(states: readonly string[]): ProjectionReport {
    this.#assertUsable();
    const document = this.#requireDocument("setStates");

    this.reconciler.projector.setActiveStates(states);
    // A state change can alter visibility, transform, size, and component
    // props, so it re-resolves through the same path a full build uses. Scoped
    // to nodes that declare the states involved would be an optimisation with
    // no measurement behind it yet.
    return this.reconciler.rebuild(document, this.#variables);
  }

  get activeStates(): readonly string[] {
    return this.reconciler.projector.activeStates;
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

    const startedAt = now();

    this.runtime.tick(wallMs);
    this.#framesRendered += 1;
    const afterRuntime = now();

    // Sample before drawing, so the frame that goes out is the frame that was
    // evaluated. Sampling after would put every output one frame behind the
    // clock, which is invisible until two outputs disagree.
    this.#applyAnimationFrame(true);
    const afterAnimation = now();

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

    const finishedAt = now();
    const timings: FrameTimings = {
      total: finishedAt - startedAt,
      runtime: afterRuntime - startedAt,
      animation: afterAnimation - afterRuntime,
      render: finishedAt - afterAnimation,
    };
    this.#lastTimings = timings;

    return {
      frame,
      drawn: rendered.length > 0,
      rendered,
      skipped,
      missed,
      timings,
    };
  }

  /** Timings from the most recent frame. */
  get lastTimings(): FrameTimings {
    return this.#lastTimings;
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
   * Samples animation and re-projects exactly the nodes that changed.
   *
   * O(animated nodes), never O(scene): a lower third animating in must not
   * re-resolve the 500-node package around it.
   */
  #applyAnimationFrame(emitEvents: boolean): AnimationFrame {
    const document = this.#document;
    if (document === null) return { changed: [], events: [], completed: [] };

    const rate = this.runtime.clock.snapshot().rate;
    const framesPerSecond = rate.num / rate.den;

    const result = this.animator.sample(
      this.runtime.clock.frame,
      framesPerSecond,
      emitEvents,
    );

    if (result.changed.length > 0) {
      this.reconciler.projector.setAnimatedValues(this.animator.values);
      this.reconciler.projector.invalidateNodes(
        result.changed,
        document,
        this.#variables,
      );
    }

    for (const { clipId, event } of result.events) {
      this.runtime.events.publish({
        type: `animation.${event.name}`,
        payload: { clipId, time: event.time, data: event.payload },
      });
    }

    return result;
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
