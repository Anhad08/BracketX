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
import type {
  ImageProvider,
  MirrorBackend,
  TextProvider,
} from "@bracketx/engine-reconciler";
import type { RuntimeValue } from "@bracketx/engine-runtime";
import type { Mat4, SceneDocument } from "@bracketx/engine-scene";

import { DocumentStore } from "./document-store";

export interface SessionOptions {
  /** Bind the document's default output. Off for headless editing tests. */
  readonly output?: boolean;
  /**
   * Supplies text. Phase 3B.
   *
   * Passed straight through to `SceneHost`, which passes it to the reconciler.
   * Studio adds no text logic of its own — the moment it did, there would be
   * two text engines and the cross-target guarantee would be gone.
   */
  readonly text?: TextProvider;
  readonly images?: ImageProvider;
}

export class StudioSession {
  readonly host: SceneHost;
  readonly store: DocumentStore;

  #disposed = false;
  #frame = 0;
  #listeners = new Set<() => void>();

  constructor(
    backend: MirrorBackend,
    document: SceneDocument,
    options: SessionOptions = {},
  ) {
    this.host = new SceneHost(backend, {
      defaultOutput: options.output ?? true,
      ...(options.text === undefined ? {} : { text: options.text }),
      ...(options.images === undefined ? {} : { images: options.images }),
    });
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
    this.#notify();
  }

  /** World matrix of a node, from the mirror. What gizmos and picking read. */
  worldMatrixOf(nodeId: string): Mat4 | undefined {
    return this.host.reconciler.mirror.get(nodeId)?.worldMatrix;
  }

  exists(nodeId: string): boolean {
    return this.host.reconciler.mirror.has(nodeId);
  }

  // -- Runtime notifications -------------------------------------------------

  /**
   * Notified when RUNTIME state changes — the clock, a clip, a live variable.
   *
   * Separate from `store.subscribe`, which fires on document edits, because
   * these are different kinds of change and a reader usually wants one of them.
   * The UI needs both: the store tells it the document moved, this tells it the
   * engine did.
   *
   * Without this the shell renders the engine to a canvas and never re-reads
   * it, so the frame counter, the timeline playhead and the live variable
   * column are correct once and then frozen — every panel individually right
   * and collectively stale. That was true from Phase 1 and invisible until a
   * browser test looked, because a headless test reads the session directly.
   */
  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #notify(): void {
    for (const listener of this.#listeners) listener();
  }

  // -- Transport ------------------------------------------------------------
  //
  // Every one of these is an engine call. Studio owns no clock.

  play(): void {
    this.host.applyLive({ type: "playback.play" }, "studio");
    this.#notify();
  }

  pause(): void {
    this.host.applyLive({ type: "playback.pause" }, "studio");
    this.#notify();
  }

  stop(): void {
    this.host.applyLive({ type: "playback.stop" }, "studio");
    this.seek(0);
  }

  seek(frame: number): void {
    this.host.applyLive({ type: "playback.seek", frame: Math.max(0, frame) }, "studio");
    this.render();
    this.#notify();
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

  // -- Variables ------------------------------------------------------------
  //
  // RFC-002 §4.3 draws the line these three sit on: a variable's DEFAULT is a
  // document edit — undoable, persisted, and it goes through `editing.ts`. A
  // variable's current VALUE is runtime state — not undoable, not persisted,
  // and it goes through here. Studio has to offer both, because a designer
  // changing what a template ships with and an operator typing a score into it
  // are different acts on the same field.

  /**
   * Overrides a variable for this session only.
   *
   * This is exactly what an operator does on air, which is why the preview
   * panel uses it rather than editing the default: a designer trying values
   * must not have every trial land in the document and the undo stack.
   */
  overrideVariable(key: string, value: RuntimeValue): void {
    this.host.applyLive({ type: "variable.set", key, value }, "studio");
    this.render();
    this.#notify();
  }

  /**
   * Drops an override, restoring the document's default.
   *
   * `variable.clear` alone would leave the key ABSENT rather than default —
   * the runtime has no memory of the document — so the default is re-set
   * explicitly. A designer who resets a field and sees it go blank has lost
   * their default, which is the opposite of what the button says.
   */
  resetVariable(key: string): void {
    const variable = this.document.variables.find((entry) => entry.key === key);
    if (variable === undefined) {
      this.host.applyLive({ type: "variable.clear", key }, "studio");
    } else {
      this.host.applyLive(
        { type: "variable.set", key, value: variable.default as RuntimeValue },
        "studio",
      );
    }
    this.render();
    this.#notify();
  }

  /** The value the engine is currently resolving for a key. */
  variableValue(key: string): unknown {
    return this.host.runtime.state.variables.get(key);
  }

  /**
   * True when the runtime value differs from the document's default.
   *
   * `Object.is`, not a deep compare, and for the same reason the host's own
   * default-sync uses it: an operator who typed a value equal to the default
   * has still typed it, and the badge saying so is what tells them the field
   * is no longer following the template.
   */
  isOverridden(key: string): boolean {
    const variable = this.document.variables.find((entry) => entry.key === key);
    if (variable === undefined) return false;
    return !Object.is(this.variableValue(key), variable.default);
  }

  playClip(clipId: string): void {
    this.host.applyLive({ type: "clip.play", clipId }, "studio");
    this.#notify();
  }

  stopClip(clipId: string): void {
    this.host.applyLive({ type: "clip.stop", clipId }, "studio");
    this.#notify();
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
    this.#listeners.clear();
    this.#disposed = true;
  }

  get disposed(): boolean {
    return this.#disposed;
  }
}
