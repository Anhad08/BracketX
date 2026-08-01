/**
 * The frame loop.
 *
 * Separate from SceneHost because *when* to render and *how* to render are
 * different concerns with different testability. A loop driven by
 * requestAnimationFrame cannot run in a test; a loop driven by an injected
 * scheduler can, and the host is identical either way.
 *
 * The wall clock is read HERE and passed down, never read inside the runtime —
 * ENGINE_RUNTIME invariant I2. That is what keeps replay and offline rendering
 * possible: the same frames replay identically because time is an argument,
 * not an ambient fact.
 */
import type { SceneHost } from "./host";

/** Schedules the next frame. Returns a handle the loop can cancel. */
export interface FrameScheduler {
  request(callback: (wallMs: number) => void): number;
  cancel(handle: number): void;
  /** Current wall time in ms. Injected so tests control it exactly. */
  now(): number;
}

export interface FrameLoopOptions {
  readonly scheduler?: FrameScheduler;
  /** Called after every frame. Diagnostics and on-air telemetry hang here. */
  readonly onFrame?: (frame: number, wallMs: number) => void;
  /**
   * Called when a frame throws.
   *
   * Without this a single bad frame kills the loop and the output freezes on
   * the last good image — the worst possible on-air failure, because it looks
   * like everything is fine. Default: log and keep running.
   */
  readonly onError?: (error: unknown) => void;
}

/** requestAnimationFrame when there is a browser; refuses otherwise. */
export function browserScheduler(): FrameScheduler {
  if (typeof requestAnimationFrame !== "function") {
    throw new Error(
      "browserScheduler() requires requestAnimationFrame; inject a " +
        "FrameScheduler for headless use",
    );
  }
  return {
    request: (callback) => requestAnimationFrame(callback),
    cancel: (handle) => {
      cancelAnimationFrame(handle);
    },
    now: () => performance.now(),
  };
}

export class FrameLoop {
  #handle: number | null = null;
  #running = false;
  #frames = 0;
  #errors = 0;
  readonly #scheduler: FrameScheduler;

  constructor(
    private readonly host: SceneHost,
    private readonly options: FrameLoopOptions = {},
  ) {
    this.#scheduler = options.scheduler ?? browserScheduler();
  }

  get running(): boolean {
    return this.#running;
  }

  get frames(): number {
    return this.#frames;
  }

  get errors(): number {
    return this.#errors;
  }

  start(): void {
    if (this.#running) return;
    this.#running = true;
    this.#schedule();
  }

  stop(): void {
    if (!this.#running) return;
    this.#running = false;
    if (this.#handle !== null) {
      this.#scheduler.cancel(this.#handle);
      this.#handle = null;
    }
  }

  /** One frame, synchronously. The unit the loop is built from. */
  step(wallMs = this.#scheduler.now()): void {
    try {
      this.host.renderFrame(wallMs);
      this.#frames += 1;
      this.options.onFrame?.(this.host.runtime.clock.frame, wallMs);
    } catch (error) {
      this.#errors += 1;
      // A frame that throws must not stop the show.
      if (this.options.onError) this.options.onError(error);
      else console.error("[bracketx] frame failed", error);
    }
  }

  #schedule(): void {
    this.#handle = this.#scheduler.request((wallMs) => {
      this.#handle = null;
      if (!this.#running) return;
      this.step(wallMs);
      // Re-scheduled after the frame, not before, so a slow frame cannot
      // queue a second one behind itself.
      if (this.#running) this.#schedule();
    });
  }
}
