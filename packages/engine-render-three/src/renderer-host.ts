/**
 * The WebGLRenderer seam.
 *
 * ============================================================================
 * WHY THIS EXISTS
 * ============================================================================
 * Three.js's scene graph, geometry, materials, and cameras all work without a
 * GPU. `WebGLRenderer` does not — it requires `document` and a real context.
 *
 * Putting the renderer behind a narrow interface means the backend's ownership,
 * translation, and synchronisation logic is fully exercisable in a test
 * process, while the GPU-touching surface stays small enough to reason about.
 * It also serves offline and cloud rendering, which need a different host
 * entirely.
 *
 * This is the same argument as MockMirrorBackend one layer down: isolate the
 * part that cannot be tested so everything else can be.
 *
 * THIS INTERFACE IS INTERNAL. It is not exported from the package. Nothing
 * above the render adapter may know a renderer host exists.
 */
import type { Camera, Object3D, WebGLRenderer } from "three";

export interface HostCapabilities {
  readonly webgl2: boolean;
  readonly maxTextureSize: number;
  readonly maxSamples: number;
  readonly floatRenderTargets: boolean;
  /** Reported by the driver where available. Diagnostic only. */
  readonly vendor: string;
  readonly renderer: string;
}

export interface HostRenderOptions {
  readonly width: number;
  readonly height: number;
  readonly clearColor: readonly [number, number, number, number];
  /** Null renders to the default framebuffer. */
  readonly target: object | null;
}

export interface HostSubmission {
  readonly frame: number;
  readonly drawCalls: number;
  readonly triangles: number;
  readonly programs: number;
}

export interface RendererHost {
  readonly capabilities: HostCapabilities;
  readonly isContextLost: boolean;

  render(scene: Object3D, camera: Camera, options: HostRenderOptions): void;
  setSize(width: number, height: number): void;

  /** Counters since the last reset. Three tracks these on `renderer.info`. */
  submission(): HostSubmission;
  resetSubmissionCounters(): void;

  onContextLost(handler: () => void): void;
  onContextRestored(handler: () => void): void;

  /** Test and diagnostic hook. Real drivers lose context on their own. */
  simulateContextLoss(): void;
  simulateContextRestore(): void;

  dispose(): void;
}

/**
 * A host that performs no GPU work.
 *
 * Used by tests and by any environment without a context. It records what
 * *would* have been submitted, which is enough to verify that the backend
 * submits the right scene through the right camera exactly once per frame —
 * everything except whether the driver draws it correctly.
 */
export class HeadlessRendererHost implements RendererHost {
  readonly capabilities: HostCapabilities = {
    webgl2: true,
    maxTextureSize: 4096,
    maxSamples: 4,
    floatRenderTargets: true,
    vendor: "bracketx",
    renderer: "headless",
  };

  #contextLost = false;
  #frame = 0;
  #drawCalls = 0;
  #triangles = 0;
  #width = 1920;
  #height = 1080;
  #lostHandlers: (() => void)[] = [];
  #restoredHandlers: (() => void)[] = [];

  /** Every submission, for assertions. */
  readonly submissions: {
    scene: Object3D;
    camera: Camera;
    options: HostRenderOptions;
  }[] = [];

  get isContextLost(): boolean {
    return this.#contextLost;
  }

  get size(): { width: number; height: number } {
    return { width: this.#width, height: this.#height };
  }

  render(scene: Object3D, camera: Camera, options: HostRenderOptions): void {
    if (this.#contextLost) {
      // A real driver silently drops draws while the context is lost. Doing
      // the same here keeps the recovery path honest.
      return;
    }
    this.#frame += 1;
    this.submissions.push({ scene, camera, options });

    // Approximate the counters a real renderer reports by walking what would
    // be drawn. Only visible meshes with geometry count.
    let drawCalls = 0;
    let triangles = 0;
    scene.traverseVisible((object) => {
      const mesh = object as { isMesh?: boolean; geometry?: unknown };
      if (mesh.isMesh !== true || !mesh.geometry) return;
      drawCalls += 1;
      const geometry = mesh.geometry as {
        index?: { count: number } | null;
        attributes?: { position?: { count: number } };
      };
      const count =
        geometry.index?.count ?? geometry.attributes?.position?.count ?? 0;
      triangles += Math.floor(count / 3);
    });
    this.#drawCalls += drawCalls;
    this.#triangles += triangles;
  }

  setSize(width: number, height: number): void {
    this.#width = width;
    this.#height = height;
  }

  submission(): HostSubmission {
    return {
      frame: this.#frame,
      drawCalls: this.#drawCalls,
      triangles: this.#triangles,
      programs: 0,
    };
  }

  resetSubmissionCounters(): void {
    this.#drawCalls = 0;
    this.#triangles = 0;
  }

  onContextLost(handler: () => void): void {
    this.#lostHandlers.push(handler);
  }

  onContextRestored(handler: () => void): void {
    this.#restoredHandlers.push(handler);
  }

  simulateContextLoss(): void {
    if (this.#contextLost) return;
    this.#contextLost = true;
    for (const handler of this.#lostHandlers) handler();
  }

  simulateContextRestore(): void {
    if (!this.#contextLost) return;
    this.#contextLost = false;
    for (const handler of this.#restoredHandlers) handler();
  }

  dispose(): void {
    this.submissions.length = 0;
    this.#lostHandlers = [];
    this.#restoredHandlers = [];
  }
}

/**
 * The real host, over a WebGL2 context.
 *
 * Constructed only where a document exists. It is deliberately thin: every
 * decision that can be made without a GPU is made above it.
 */
export class WebGLRendererHost implements RendererHost {
  #renderer: WebGLRenderer;
  #canvas: HTMLCanvasElement;
  #contextLost = false;
  #lostHandlers: (() => void)[] = [];
  #restoredHandlers: (() => void)[] = [];
  #capabilities: HostCapabilities;

  constructor(renderer: WebGLRenderer, canvas: HTMLCanvasElement) {
    this.#renderer = renderer;
    this.#canvas = canvas;

    const gl = renderer.getContext();
    const debugInfo = gl.getExtension("WEBGL_debug_renderer_info");

    this.#capabilities = {
      webgl2: renderer.capabilities.isWebGL2 !== false,
      maxTextureSize: renderer.capabilities.maxTextureSize,
      maxSamples: renderer.capabilities.maxSamples,
      floatRenderTargets: gl.getExtension("EXT_color_buffer_float") !== null,
      vendor: debugInfo
        ? String(gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL))
        : "unknown",
      renderer: debugInfo
        ? String(gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL))
        : "unknown",
    };

    // preventDefault is what allows the browser to restore the context.
    // Without it, the context is lost permanently and recovery is impossible.
    this.#canvas.addEventListener("webglcontextlost", this.#handleLost, false);
    this.#canvas.addEventListener(
      "webglcontextrestored",
      this.#handleRestored,
      false,
    );
  }

  get capabilities(): HostCapabilities {
    return this.#capabilities;
  }

  get isContextLost(): boolean {
    return this.#contextLost;
  }

  render(scene: Object3D, camera: Camera, options: HostRenderOptions): void {
    if (this.#contextLost) return;
    const [r, g, b, a] = options.clearColor;
    this.#renderer.setClearColor(
      (Math.round(r * 255) << 16) | (Math.round(g * 255) << 8) | Math.round(b * 255),
      a,
    );
    this.#renderer.setRenderTarget(
      (options.target as never) ?? null,
    );
    this.#renderer.render(scene, camera);
  }

  setSize(width: number, height: number): void {
    this.#renderer.setSize(width, height, false);
  }

  submission(): HostSubmission {
    const info = this.#renderer.info;
    return {
      frame: info.render.frame,
      drawCalls: info.render.calls,
      triangles: info.render.triangles,
      programs: info.programs?.length ?? 0,
    };
  }

  resetSubmissionCounters(): void {
    this.#renderer.info.reset();
  }

  onContextLost(handler: () => void): void {
    this.#lostHandlers.push(handler);
  }

  onContextRestored(handler: () => void): void {
    this.#restoredHandlers.push(handler);
  }

  simulateContextLoss(): void {
    const extension = this.#renderer
      .getContext()
      .getExtension("WEBGL_lose_context");
    extension?.loseContext();
  }

  simulateContextRestore(): void {
    const extension = this.#renderer
      .getContext()
      .getExtension("WEBGL_lose_context");
    extension?.restoreContext();
  }

  dispose(): void {
    this.#canvas.removeEventListener("webglcontextlost", this.#handleLost);
    this.#canvas.removeEventListener(
      "webglcontextrestored",
      this.#handleRestored,
    );
    this.#renderer.dispose();
  }

  #handleLost = (event: Event): void => {
    event.preventDefault();
    this.#contextLost = true;
    for (const handler of this.#lostHandlers) handler();
  };

  #handleRestored = (): void => {
    this.#contextLost = false;
    for (const handler of this.#restoredHandlers) handler();
  };
}
