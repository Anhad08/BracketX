/**
 * The editing session — Studio's hold on the engine.
 *
 * ============================================================================
 * STUDIO IS NOT A SECOND RUNTIME
 * ============================================================================
 * There is one `SceneHost`, one runtime clock, one reconciler, one mirror. The
 * editor drives them; it does not reimplement them. Concretely:
 *
 *   preview      is the engine rendering to a canvas, not a DOM approximation
 *   playback     is `SceneHost.play/pause/seek`, not a Studio timer
 *   live update  is `reconciler.project(transaction)`, not a rebuild
 *   evaluation   is the engine's, so what a designer sees is what airs
 *
 * The one thing Studio adds is a paused-by-default clock. An editor that
 * autoplayed would animate a graphic out from under the person editing it.
 *
 * Headlessly constructible against `MockMirrorBackend`, which is what lets the
 * verification suite assert save/load losslessness and undo determinism without
 * a browser.
 */
import {
  SceneHost,
  type FrameResult,
  type ProjectionReport,
} from "@bracketx/engine-host";
import type { MirrorBackend } from "@bracketx/engine-reconciler";
import type { Mat4, SceneDocument } from "@bracketx/engine-scene";

import { DocumentStore } from "./document-store";

export interface SessionOptions {
  /** Bind the document's default output. Off for headless editing tests. */
  readonly output?: boolean;
}

export class StudioSession {
  readonly host: SceneHost;
  readonly store: DocumentStore;

  #disposed = false;
  #frame = 0;

  constructor(
    backend: MirrorBackend,
    document: SceneDocument,
    options: SessionOptions = {},
  ) {
    this.host = new SceneHost(backend, { defaultOutput: options.output ?? true });
    this.host.load(document);
    this.store = new DocumentStore(this.host);
  }

  get document(): SceneDocument {
    return this.store.document;
  }

  /**
   * Replaces the whole document — a file open.
   *
   * `load` rather than a transaction, deliberately. Opening a file is not an
   * edit: it must not be undoable, it must reset history, and it must reseed
   * runtime variables from the new document's defaults.
   */
  open(document: SceneDocument): void {
    this.host.load(document);
    this.store.reset();
    this.#frame = 0;
  }

  /** World matrix of a node, from the mirror. What gizmos and picking read. */
  worldMatrixOf(nodeId: string): Mat4 | undefined {
    return this.host.reconciler.mirror.get(nodeId)?.worldMatrix;
  }

  exists(nodeId: string): boolean {
    return this.host.reconciler.mirror.has(nodeId);
  }

  // -- Transport ------------------------------------------------------------
  //
  // Every one of these is an engine call. Studio owns no clock.

  play(): void {
    this.host.applyLive({ type: "playback.play" }, "studio");
  }

  pause(): void {
    this.host.applyLive({ type: "playback.pause" }, "studio");
  }

  stop(): void {
    this.host.applyLive({ type: "playback.stop" }, "studio");
    this.seek(0);
  }

  seek(frame: number): void {
    this.host.applyLive({ type: "playback.seek", frame: Math.max(0, frame) }, "studio");
    this.render();
  }

  /**
   * Advances exactly one frame with the clock paused.
   *
   * Pausing first is the same rule the workbench established: a running clock
   * advances between the step and the read, and a keyframe inspected at
   * "frame 412" that was actually 414 is a keyframe nobody can reproduce.
   */
  stepFrames(count: number): number {
    this.pause();
    this.seek(this.frame + count);
    return this.frame;
  }

  get frame(): number {
    return this.host.runtime.clock.frame;
  }

  get playing(): boolean {
    return this.host.runtime.clock.snapshot().status === "playing";
  }

  playClip(clipId: string): void {
    this.host.applyLive({ type: "clip.play", clipId }, "studio");
  }

  stopClip(clipId: string): void {
    this.host.applyLive({ type: "clip.stop", clipId }, "studio");
  }

  /** Draws one frame at the current wall time. */
  render(wallMs?: number): FrameResult {
    this.#frame += 1;
    return this.host.renderFrame(wallMs ?? (this.#frame * 1000) / 60);
  }

  get lastReport(): ProjectionReport | null {
    return this.host.lastReport;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.host.dispose();
    this.#disposed = true;
  }

  get disposed(): boolean {
    return this.#disposed;
  }
}
