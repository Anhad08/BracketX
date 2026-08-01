/**
 * Canvas entry point. Phase 2.6d.
 *
 * The only supported way for an application to obtain a GPU-backed
 * MirrorBackend.
 *
 * It exists because of a boundary problem this phase surfaced: WebGLRendererHost
 * takes a Three `WebGLRenderer`, so any application constructing one would have
 * to import `three` — which the isolation rule added in Phase 2.5n forbids, and
 * rightly: an app holding a Three object is an app that pins the backend
 * choice. This function takes a canvas and returns a MirrorBackend, so no Three
 * type ever crosses the package boundary.
 */
import { WebGLRenderer } from "three";

import { WebGLRendererHost } from "./renderer-host";
import { ThreeMirrorBackend } from "./three-backend";

export interface CanvasBackendOptions {
  /** VRAM ceiling. Over it, allocation is refused rather than evicting. */
  readonly maxBytes?: number;
  /** Multisampling. Off by default — broadcast output is usually supersampled. */
  readonly antialias?: boolean;
  /**
   * Device pixel ratio. Defaults to 1 rather than devicePixelRatio: broadcast
   * output has a fixed pixel grid, and silently rendering a 1920x1080 scene at
   * 2x on a retina laptop would make the preview disagree with the programme
   * feed.
   */
  readonly pixelRatio?: number;
}

export function createCanvasBackend(
  canvas: HTMLCanvasElement,
  options: CanvasBackendOptions = {},
): ThreeMirrorBackend {
  const renderer = new WebGLRenderer({
    canvas,
    // Broadcast graphics composite over live video, so the framebuffer must
    // carry alpha and must not be pre-cleared to opaque black.
    alpha: true,
    premultipliedAlpha: true,
    antialias: options.antialias ?? false,
    // Reading pixels back — for verification, for thumbnails, for output —
    // requires the drawing buffer to survive the frame.
    preserveDrawingBuffer: true,
  });

  renderer.setPixelRatio(options.pixelRatio ?? 1);
  // Fully transparent clear. The scene decides what is opaque, not the canvas.
  renderer.setClearColor(0x000000, 0);

  return new ThreeMirrorBackend({
    host: new WebGLRendererHost(renderer, canvas),
    maxBytes: options.maxBytes,
  });
}
