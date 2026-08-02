/**
 * A running showcase scene.
 *
 * ============================================================================
 * WHY THIS IS NOT A REACT HOOK
 * ============================================================================
 * Everything the workbench does that is worth verifying happens here, in a
 * plain class that takes any `MirrorBackend`. That makes the whole thing
 * testable headlessly against `MockMirrorBackend` — no browser, no canvas, no
 * GL.
 *
 * The React layer is a thin adapter over this. If the interesting logic lived
 * in a component, the integration tests would need a DOM to prove that
 * diagnostics match engine state, and a test that needs a browser to check
 * arithmetic is a test that will eventually be skipped.
 *
 * This file also enforces the workbench's central rule: it uses ONLY public
 * engine APIs. There is no import from a package's `src/` here, and none of
 * these methods reach past an exported surface.
 */
import {
  FrameLoop,
  SceneHost,
  type FrameResult,
  type FrameScheduler,
  type FrameTimings,
  type LiveCommand,
  type ProjectionReport,
  type SessionSnapshot,
} from "@bracketx/engine-host";
import type { MirrorBackend } from "@bracketx/engine-reconciler";
import type { SceneDocument, Transaction } from "@bracketx/engine-scene";

import type { SceneParameters, ShowcaseScene } from "../registry";
import { FrameHistory } from "./history";
import { MetricsRecorder, type Metrics } from "./metrics";

export interface SessionOptions {
  /** Injected so tests drive frames by hand instead of by wall clock. */
  readonly scheduler?: FrameScheduler;
  /**
   * Makes a backend for a replay fork.
   *
   * Required for `forkForReplay`, because a replay must not share a backend
   * with the session it verifies — the fork would tear down the original's
   * mirror on dispose.
   */
  readonly replayBackend?: () => MirrorBackend;
  /** Extra outputs beyond the document's default. */
  readonly outputs?: readonly { id: string; width: number; height: number; cadence?: number }[];
  /** Scene build parameters, for the stress laboratory. */
  readonly parameters?: SceneParameters;
}

/**
 * Live engine numbers, read straight from public APIs.
 *
 * Every field names where it came from. A diagnostics panel that computes its
 * own version of a number the engine already knows will eventually disagree
 * with the engine, and the panel will be believed.
 */
export interface Diagnostics {
  readonly frame: number;
  /** Show time in seconds, derived from the clock. */
  readonly runtimeSeconds: number;
  readonly playing: boolean;
  /**
   * Null unless explicitly requested.
   *
   * `sessionHash()` canonicalises every variable, which on a 3,000-row
   * collection costs 0.2ms — two orders of magnitude more than the frame it
   * describes. V2 paid that on every 10Hz sample to display sixteen truncated
   * characters nobody reads. It is now on demand.
   */
  readonly sessionHash: string | null;
  /**
   * Also null unless requested, and for a sharper reason.
   *
   * `Runtime.stateHash` is a GETTER that canonicalises and hashes the whole of
   * runtime state on every access, and `host.session()` reads it. On a
   * 4,000-row collection that measured 5.1ms — three thousand times the frame
   * it describes — and it sat on the sampled path so a panel could show sixteen
   * characters. This is the second time the same mistake was found by
   * benchmarking the tool at scale rather than at demo size.
   */
  readonly runtimeHash: string | null;

  readonly nodeCount: number;
  readonly animatedNodes: number;
  readonly activeClips: readonly string[];
  readonly heldClips: readonly string[];
  readonly activeStates: readonly string[];

  readonly outputs: readonly {
    readonly id: string;
    readonly width: number;
    readonly height: number;
    readonly cadence: number;
    readonly rendered: number;
    readonly skipped: number;
    readonly missed: number;
  }[];

  readonly dirtyNodes: number;
  readonly backendWrites: number;
  readonly nodesCreated: number;
  readonly nodesDestroyed: number;

  readonly commandsAccepted: number;
  readonly commandsRejected: number;
  readonly recentCommands: readonly {
    readonly sequence: number;
    readonly type: string;
    readonly accepted: boolean;
    readonly reason?: string;
  }[];

  readonly framesRendered: number;
  readonly submissions: number;
  readonly timings: FrameTimings;
}

export interface DiagnosticsOptions {
  /** Compute the session hash. Costs a full canonicalisation — see above. */
  readonly hashes?: boolean;
}

/** How many command→projection attributions are retained. */
const ATTRIBUTION_CAPACITY = 512;

export class ShowcaseSession {
  readonly host: SceneHost;
  readonly scene: ShowcaseScene;

  #loop: FrameLoop | null = null;
  #metrics = new MetricsRecorder();
  #history = new FrameHistory();
  #disposed = false;
  #frameHandlers = new Set<(result: FrameResult) => void>();

  /**
   * What each command actually did to the scene.
   *
   * ========================================================================
   * ATTRIBUTION WITHOUT AN ENGINE CHANGE
   * ========================================================================
   * "Dirty nodes: 42" is not a diagnostic. "42 dirty nodes, all from
   * collection.patch on `items`, sent by the feed" is.
   *
   * Getting there needs each command's projection, and the temptation is to
   * add a `report` field to `LiveCommandRecord`. It is not necessary: a
   * command that projected leaves a NEW `lastReport` object behind it, so
   * comparing identity across the call attributes the projection exactly. A
   * command that did not project (playback.play) leaves the previous report
   * in place and is correctly attributed nothing.
   *
   * The engine stayed unchanged because a public API already answered the
   * question. Bounded, because a workbench open for a rehearsal day must not
   * accumulate a report per command forever.
   */
  #attribution = new Map<number, ProjectionReport>();
  #attributionOrder: number[] = [];

  readonly #backend: MirrorBackend;

  constructor(
    scene: ShowcaseScene,
    backend: MirrorBackend,
    private readonly options: SessionOptions = {},
  ) {
    this.scene = scene;
    this.#backend = backend;
    this.host = new SceneHost(backend);
  }

  /**
   * Builds and loads the document, then applies the scene's opening commands.
   *
   * `build()` is called here rather than cached, so reloading a scene proves it
   * is deterministic — a scene that renders differently on a second load is a
   * bug the workbench should surface, not hide.
   */
  load(): void {
    this.host.load(this.buildDocument());

    for (const output of this.options.outputs ?? []) {
      this.send({ type: "output.bind", output }, "scene");
    }

    if (this.scene.autoPlay !== false) {
      this.send({ type: "playback.play" }, "scene");
    }
    for (const command of this.scene.onLoad ?? []) {
      this.send(command, "scene");
    }
  }

  buildDocument(): SceneDocument {
    return this.scene.build(this.options.parameters);
  }

  /**
   * Reloads the document with different build parameters.
   *
   * The stress laboratory's node-count and depth axes are document shape, not
   * runtime state, so no command can express them. This is `SceneHost.load` —
   * the same public entry a scene switch uses — not a back door.
   */
  reload(parameters: SceneParameters): ShowcaseSession {
    const next = new ShowcaseSession(this.scene, this.#backend, {
      ...this.options,
      parameters,
    });
    next.load();
    return next;
  }

  /** Runtime state. Not undoable, not persisted (RFC-002 §4.3). */
  send(command: LiveCommand, source = "operator"): void {
    if (this.#disposed) return;

    const before = this.host.lastReport;
    const result = this.host.applyLive(command, source);
    const after = this.host.lastReport;

    if (result.accepted && after !== null && after !== before) {
      this.#attribution.set(result.sequence, after);
      this.#attributionOrder.push(result.sequence);
      if (this.#attributionOrder.length > ATTRIBUTION_CAPACITY) {
        this.#attribution.delete(this.#attributionOrder.shift()!);
      }
    }
  }

  /** What a command changed, when it changed anything. */
  attributionFor(sequence: number): ProjectionReport | undefined {
    return this.#attribution.get(sequence);
  }

  /** Document state. Undoable and persisted — the other mutation path. */
  edit(transaction: Transaction): void {
    if (this.#disposed) return;
    this.host.apply(transaction);
  }

  /** Advances one frame and records its metrics. */
  step(wallMs?: number): FrameResult {
    const result = this.host.renderFrame(wallMs);
    this.#record(result.timings);
    for (const handler of this.#frameHandlers) handler(result);
    return result;
  }

  /**
   * Advances exactly `count` frames with the clock stopped.
   *
   * Frame stepping is the single affordance that turns "it flickers sometimes"
   * into a reproducible report. Pausing first is not politeness: a running loop
   * would advance between the step and the read, and a bug inspected at
   * "frame 412" that was actually frame 414 is a bug nobody can reproduce.
   */
  stepFrames(count = 1): number {
    if (this.#disposed) return this.frame;
    this.stop();
    this.send({ type: "playback.pause" }, "workbench");
    for (let index = 0; index < count; index += 1) {
      this.send(
        { type: "playback.seek", frame: this.host.runtime.clock.frame + 1 },
        "workbench",
      );
      this.step();
    }
    return this.frame;
  }

  get frame(): number {
    return this.host.runtime.clock.frame;
  }

  /** Subscribe to frames. Returns an unsubscribe. */
  onFrame(handler: (result: FrameResult) => void): () => void {
    this.#frameHandlers.add(handler);
    return () => this.#frameHandlers.delete(handler);
  }

  start(): void {
    if (this.#loop !== null || this.#disposed) return;
    this.#loop = new FrameLoop(this.host, {
      ...(this.options.scheduler ? { scheduler: this.options.scheduler } : {}),
      onFrame: () => {
        this.#record(this.host.lastTimings);
      },
    });
    this.#loop.start();
  }

  stop(): void {
    this.#loop?.stop();
    this.#loop = null;
  }

  get running(): boolean {
    return this.#loop?.running ?? false;
  }

  metrics(): Metrics {
    return this.#metrics.snapshot();
  }

  /** Per-frame samples, for the performance tools. */
  get history(): FrameHistory {
    return this.#history;
  }

  session(): SessionSnapshot {
    return this.host.session();
  }

  sessionHash(): string {
    return this.host.sessionHash();
  }

  /**
   * Everything the overlays display, read from the engine in one pass.
   *
   * Taken as a single snapshot so the panel can never show a frame number from
   * one moment beside a node count from another — a diagnostics display that
   * tears is worse than none, because it is believed.
   */
  diagnostics(options: DiagnosticsOptions = {}): Diagnostics {
    // Deliberately NOT `host.session()`. That builds a snapshot whose
    // `runtimeHash` getter canonicalises every variable, which is the single
    // most expensive thing the sampled path could do. Every field below is
    // read straight from the engine object that already holds it.
    const report = this.host.lastReport;
    const clock = this.host.runtime.clock.snapshot();
    const rate = clock.rate.num / clock.rate.den;
    const stats = this.host.outputStats();
    const frame = this.host.runtime.clock.frame;

    return {
      frame,
      runtimeSeconds: rate === 0 ? 0 : frame / rate,
      playing: clock.status === "playing",
      sessionHash: options.hashes === true ? this.host.sessionHash() : null,
      runtimeHash: options.hashes === true ? this.host.runtime.stateHash : null,

      // `mirror.size` rather than counting an iterator. The iterator version
      // allocated an array of every node id on every 10Hz sample, which is
      // O(scene) work to display a number the mirror already holds — and at
      // the scene sizes this tool is required to survive, it is the single
      // most expensive thing the workbench did.
      nodeCount: this.host.reconciler.mirror.size,
      animatedNodes: this.host.animator.values.size,
      activeClips: this.host.animator.playing,
      heldClips: this.host.animator.clips
        .filter((clip) => this.host.animator.isHeld(clip.id))
        .map((clip) => clip.id),
      activeStates: this.host.activeStates,

      outputs: this.host.outputs.map((output) => {
        const stat = stats.find((entry) => entry.id === output.id);
        return {
          id: output.id,
          width: output.width,
          height: output.height,
          cadence: output.cadence,
          rendered: stat?.framesRendered ?? 0,
          skipped: stat?.framesSkipped ?? 0,
          missed: stat?.framesMissed ?? 0,
        };
      }),

      dirtyNodes: report
        ? report.dirty.transform +
          report.dirty.material +
          report.dirty.hierarchy +
          report.dirty.visibility +
          report.dirty.camera
        : 0,
      backendWrites: report?.backendWrites ?? 0,
      nodesCreated: report?.nodesCreated ?? 0,
      nodesDestroyed: report?.nodesDestroyed ?? 0,

      commandsAccepted: this.host.log.accepted,
      commandsRejected: this.host.log.rejected,
      recentCommands: this.host.log.recent(8).map((record) => ({
        sequence: record.sequence,
        type: record.command.type,
        accepted: record.accepted,
        ...(record.reason === undefined ? {} : { reason: record.reason }),
      })),

      framesRendered: this.host.framesRendered,
      submissions: this.host.submissions,
      timings: this.host.lastTimings,
    };
  }

  /**
   * Puts the session at an exact frame, deterministically.
   *
   * Pauses first: a running clock would advance past the target between the
   * seek and the read, and a screenshot taken "at frame 300" that was actually
   * taken at 301 is a baseline that fails intermittently forever.
   */
  seekTo(frame: number): void {
    this.stop();
    this.send({ type: "playback.pause" }, "workbench");
    this.send({ type: "playback.seek", frame }, "workbench");
    this.step();
  }

  /**
   * A fresh session on the same scene, for replay verification.
   *
   * Deliberately a NEW backend and a NEW host: replaying into the session that
   * produced a recording would compare a state against itself and pass
   * unconditionally, which is the one thing a verification tool must not do.
   *
   * The backend is supplied by the caller through the factory given at
   * construction, so this works headlessly and in the browser alike.
   */
  forkForReplay(): ShowcaseSession {
    const fork = new ShowcaseSession(
      this.scene,
      this.options.replayBackend?.() ?? this.#backend,
      this.options,
    );
    fork.load();
    return fork;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.stop();
    this.#frameHandlers.clear();
    this.host.dispose();
    this.#disposed = true;
  }

  get disposed(): boolean {
    return this.#disposed;
  }

  #record(timings: FrameTimings): void {
    const report = this.host.lastReport;
    this.#metrics.record(timings, report);
    this.#history.record(this.host.runtime.clock.frame, timings, report);
  }
}
