/**
 * A running showcase scene.
 *
 * ============================================================================
 * WHY THIS IS NOT A REACT HOOK
 * ============================================================================
 * Everything the showcase does that is worth verifying happens here, in a plain
 * class that takes any `MirrorBackend`. That makes the whole thing testable
 * headlessly against `MockMirrorBackend` — no browser, no canvas, no GL.
 *
 * The React layer is a thin adapter over this. If the interesting logic lived
 * in a component, the integration tests would need a DOM to prove that
 * diagnostics match engine state, and a test that needs a browser to check
 * arithmetic is a test that will eventually be skipped.
 *
 * This file also enforces the showcase's central rule: it uses ONLY public
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
  type SessionSnapshot,
} from "@bracketx/engine-host";
import type { MirrorBackend } from "@bracketx/engine-reconciler";
import type { Transaction } from "@bracketx/engine-scene";

import type { ShowcaseScene } from "../registry";
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
  readonly sessionHash: string;
  readonly runtimeHash: string;

  readonly nodeCount: number;
  readonly animatedNodes: number;
  readonly activeClips: readonly string[];
  readonly heldClips: readonly string[];

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

export class ShowcaseSession {
  readonly host: SceneHost;
  readonly scene: ShowcaseScene;

  #loop: FrameLoop | null = null;
  #metrics = new MetricsRecorder();
  #disposed = false;
  #frameHandlers = new Set<(result: FrameResult) => void>();

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
   * bug the showcase should surface, not hide.
   */
  load(): void {
    this.host.load(this.scene.build());

    for (const output of this.options.outputs ?? []) {
      this.host.applyLive({ type: "output.bind", output }, "scene");
    }

    if (this.scene.autoPlay !== false) {
      this.host.applyLive({ type: "playback.play" }, "scene");
    }
    for (const command of this.scene.onLoad ?? []) {
      this.host.applyLive(command, "scene");
    }
  }

  /** Runtime state. Not undoable, not persisted (RFC-002 §4.3). */
  send(command: LiveCommand, source = "operator"): void {
    if (this.#disposed) return;
    this.host.applyLive(command, source);
  }

  /** Document state. Undoable and persisted — the other mutation path. */
  edit(transaction: Transaction): void {
    if (this.#disposed) return;
    this.host.apply(transaction);
  }

  /** Advances one frame and records its metrics. */
  step(wallMs?: number): FrameResult {
    const result = this.host.renderFrame(wallMs);
    this.#metrics.record(result.timings, this.host.lastReport);
    for (const handler of this.#frameHandlers) handler(result);
    return result;
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
        this.#metrics.record(this.host.lastTimings, this.host.lastReport);
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

  session(): SessionSnapshot {
    return this.host.session();
  }

  /**
   * Everything the overlays display, read from the engine in one pass.
   *
   * Taken as a single snapshot so the panel can never show a frame number from
   * one moment beside a node count from another — a diagnostics display that
   * tears is worse than none, because it is believed.
   */
  diagnostics(): Diagnostics {
    const snapshot = this.host.session();
    const report = this.host.lastReport;
    const clock = this.host.runtime.clock.snapshot();
    const rate = clock.rate.num / clock.rate.den;
    const stats = this.host.outputStats();

    return {
      frame: snapshot.frame,
      runtimeSeconds: rate === 0 ? 0 : snapshot.frame / rate,
      playing: snapshot.playing,
      sessionHash: this.host.sessionHash(),
      runtimeHash: snapshot.runtimeHash,

      nodeCount: [...this.host.reconciler.mirror.nodeIds()].length,
      animatedNodes: this.host.animator.values.size,
      activeClips: snapshot.activeClips,
      heldClips: snapshot.heldClips,

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
    this.host.applyLive({ type: "playback.pause" });
    this.host.applyLive({ type: "playback.seek", frame });
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
}
