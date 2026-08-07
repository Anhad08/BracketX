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
import { CubeTexture, LinearToneMapping, PCFSoftShadowMap, PMREMGenerator } from "three";
import { studioEnvironmentFaces } from "@bracketx/engine-reconciler";
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

export interface HostEnvironment {
  readonly exposure: number;
  readonly shadows: boolean;
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

  /**
   * Exposure and shadow mapping. ADR-013 amendment 3.
   *
   * On the seam rather than in the backend because both live on the
   * `WebGLRenderer` — the one object the backend deliberately cannot see. The
   * headless host records them instead, which is what makes the amendment
   * testable without a GPU.
   */
  setEnvironment(environment: HostEnvironment): void;

  /**
   * The studio environment a metal reflects, or null where there is no GPU.
   *
   * Behind the seam because building it needs both a DOM (six canvases) and the
   * renderer itself (prefiltering by roughness is a render pass) — the two
   * things this interface exists to keep out of the backend. A host with no
   * context answers null, and a scene with nothing to reflect is exactly what
   * a headless host draws.
   */
  environmentTexture(): unknown | null;

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

  /** What the backend last asked for. Asserted by the conformance suite. */
  environment: HostEnvironment = { exposure: 1, shadows: false };

  setEnvironment(environment: HostEnvironment): void {
    this.environment = environment;
  }

  environmentTexture(): unknown | null {
    return null;
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
  #studio: unknown | null = null;

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

  /**
   * The studio environment, prefiltered.
   *
   * ========================================================================
   * WHY THIS IS NOT A PLAIN CUBE TEXTURE
   * ========================================================================
   * Two reasons, and the first is a hard failure rather than a quality one.
   *
   * Three uploads a `CubeTexture` through `texImage2D` expecting DOM images,
   * so a cube built from raw bytes never reaches the GPU — the scene keeps a
   * texture, every metal keeps rendering black, and nothing reports an error.
   * The faces are therefore drawn onto canvases first.
   *
   * And roughness selects a MIP LEVEL of the environment. Ordinary mipmaps are
   * box filters of a cube face, which is not the same thing as a hemispherical
   * convolution — with them, a brushed metal reflects almost as sharply as a
   * mirror and "Premium" is indistinguishable from "Chrome". `PMREMGenerator`
   * does the convolution properly, on the GPU, once.
   */
  environmentTexture(): unknown | null {
    if (this.#studio !== null) return this.#studio;
    if (typeof document === "undefined") return null;

    const { size, faces } = studioEnvironmentFaces(32);
    const images = faces.map((pixels) => {
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const context = canvas.getContext("2d");
      if (context === null) return null;
      const image = context.createImageData(size, size);
      image.data.set(pixels);
      context.putImageData(image, 0, 0);
      return canvas;
    });
    if (images.some((image) => image === null)) return null;

    const cube = new CubeTexture(images as never);
    cube.needsUpdate = true;

    const generator = new PMREMGenerator(this.#renderer);
    generator.compileCubemapShader();
    this.#studio = generator.fromCubemap(cube).texture;
    generator.dispose();
    cube.dispose();
    return this.#studio;
  }

  setEnvironment(environment: HostEnvironment): void {
    // LINEAR tone mapping, not ACES or Reinhard. At an exposure of 1 the
    // linear curve is `saturate(colour)`, which is byte-for-byte what NO tone
    // mapping already produced — so turning this on cannot change a picture
    // that never asks for exposure. A filmic curve would have quietly
    // recoloured every graphic already on air.
    this.#renderer.toneMapping = LinearToneMapping;
    this.#renderer.toneMappingExposure = environment.exposure;
    this.#renderer.shadowMap.enabled = environment.shadows;
    // Soft edges. A hard shadow map at this resolution reads as a jagged
    // stencil, which on a broadcast set looks like a rendering fault.
    this.#renderer.shadowMap.type = PCFSoftShadowMap;
    this.#renderer.shadowMap.needsUpdate = true;
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
