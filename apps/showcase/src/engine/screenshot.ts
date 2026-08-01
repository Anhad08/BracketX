/**
 * Deterministic screenshot capture.
 *
 * ============================================================================
 * DETERMINISM IS THE ONLY REQUIREMENT THAT MATTERS HERE
 * ============================================================================
 * A screenshot that is *usually* the same is worse than no screenshot, because
 * a baseline built from it fails intermittently and eventually gets deleted by
 * whoever is tired of re-approving it.
 *
 * Three things make a capture reproducible, and all three are enforced below:
 *
 *   1. The clock is PAUSED and SOUGHT to an exact frame. A running clock
 *      advances between the seek and the read, so "frame 300" becomes 301 on a
 *      slow machine.
 *   2. The frame is rendered AFTER the seek, synchronously, in the same task.
 *      Waiting for the next animation frame reintroduces the race.
 *   3. The drawing buffer is preserved. Without it the canvas is undefined
 *      after compositing and `toDataURL` returns transparent black on some
 *      drivers — createCanvasBackend already sets this.
 *
 * Visual regression tooling is deliberately NOT built here. This produces
 * stable bytes; deciding whether two sets of bytes are acceptably similar is a
 * separate problem with its own failure modes.
 */
import type { ShowcaseSession } from "./session";

export interface ScreenshotOptions {
  /** Frame to capture at. Defaults to the scene's declared frame, or 0. */
  readonly frame?: number;
  /** `image/png` by default. PNG is lossless, which a baseline requires. */
  readonly type?: string;
}

export interface Screenshot {
  /** `data:` URL of the encoded image. */
  readonly dataUrl: string;
  readonly frame: number;
  readonly width: number;
  readonly height: number;
  /** Session hash at capture. Two identical hashes must give identical bytes. */
  readonly sessionHash: string;
  readonly sceneId: string;
}

export class ScreenshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScreenshotError";
  }
}

/**
 * Captures the canvas at an exact frame.
 *
 * Synchronous by design. An async capture would have to decide what happens if
 * the clock advances while it awaits, and every answer to that is a source of
 * flake.
 */
export function captureScreenshot(
  session: ShowcaseSession,
  canvas: HTMLCanvasElement | null,
  options: ScreenshotOptions = {},
): Screenshot {
  if (canvas === null) {
    throw new ScreenshotError("no canvas is mounted");
  }

  const frame =
    options.frame ?? session.scene.screenshotFrame ?? 0;

  // Pause, seek, render — in that order, in this task.
  session.seekTo(frame);

  const dataUrl = canvas.toDataURL(options.type ?? "image/png");
  if (!dataUrl.startsWith("data:image/")) {
    throw new ScreenshotError(
      "canvas produced no image; the drawing buffer may not be preserved",
    );
  }

  return {
    dataUrl,
    frame,
    width: canvas.width,
    height: canvas.height,
    sessionHash: session.host.sessionHash(),
    sceneId: session.scene.id,
  };
}

/**
 * A stable file name for a capture.
 *
 * Scene and frame only — no timestamp, no run id. A name that changes every run
 * cannot be a baseline, and adding the date is the most common way that
 * happens.
 */
export function screenshotName(scene: string, frame: number): string {
  return `${scene}@${String(frame).padStart(6, "0")}.png`;
}

/** Triggers a browser download. Development convenience, not infrastructure. */
export function downloadScreenshot(shot: Screenshot): void {
  const link = document.createElement("a");
  link.href = shot.dataUrl;
  link.download = screenshotName(shot.sceneId, shot.frame);
  link.click();
}
