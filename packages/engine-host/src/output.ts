/**
 * Outputs — where frames go. Project Alpha A1.
 *
 * ============================================================================
 * WHY THIS EXISTS
 * ============================================================================
 * Before this, the host held a single width, height, and clear colour, and drew
 * one frame to one implicit surface. That encoded an assumption the engine has
 * no business making: that there is exactly one consumer of its frames, and that
 * the consumer is a browser canvas compositing over live video.
 *
 * A projector wall, a texture handed to a media server, a recording, and an
 * encoded transport stream are all consumers of the same frames with different
 * resolutions, different alpha behaviour, and different rates. None of them is
 * more "native" to the engine than the others.
 *
 * So a scene is bound to OUTPUTS. An output declares what it wants — size,
 * alpha, cadence, which camera, which layers — and receives frames on those
 * terms. What it does with them is not the engine's concern.
 *
 * `MirrorBackend` already anticipated this: `RenderOptions.target` is a render
 * target or null, and Phase 2.6 refused `setSize` on the grounds that the
 * surface being drawn into belongs to whoever created it. This module is the
 * engine layer catching up to a boundary that was already drawn correctly.
 */
import type {
  CameraHandle,
  RenderTargetHandle,
  Rgba,
} from "@bracketx/engine-reconciler";

export class OutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OutputError";
  }
}

/** Fully transparent. Production output composites over something else. */
const TRANSPARENT: Rgba = [0, 0, 0, 0];
const OPAQUE_BLACK: Rgba = [0, 0, 0, 1];

export interface OutputDescriptor {
  /** Stable, caller-chosen. Used to rebind or unbind without a handle. */
  readonly id: string;

  readonly width: number;
  readonly height: number;

  /**
   * `transparent` composites over whatever is behind it — a video switcher, a
   * media server, another layer. `opaque` is for a surface that is the whole
   * picture: a projector, an LED wall, a recording.
   *
   * Defaults to transparent, because an opaque default is a black rectangle on
   * air and that failure is silent until someone sees it.
   */
  readonly alpha?: "transparent" | "opaque";

  /** Overrides the alpha default when a specific clear colour is wanted. */
  readonly clearColor?: Rgba;

  /**
   * Which camera node renders this output. Omitted means the scene's own
   * active camera — the common case, and what makes a second output a one-line
   * addition rather than a scene change.
   *
   * A distinct camera per output is how a preview differs from a programme
   * feed, and how a virtual-production texture sees the scene from elsewhere.
   */
  readonly cameraNodeId?: string | null;

  /**
   * Render every Nth frame. 1 is every frame.
   *
   * Outputs do not share a rate. A 60fps programme feed and a 15fps operator
   * preview are the same scene at different cadences, and without this the
   * preview costs as much as the thing going on air.
   */
  readonly cadence?: number;

  /** Layer bitmask, tested against node layers. */
  readonly layerMask?: number;

  /**
   * Destination surface. `null` is the backend's default surface — the canvas
   * it was created with. A render target draws offscreen.
   */
  readonly target?: RenderTargetHandle | null;
}

/** An output with defaults resolved. What the host actually renders against. */
export interface ResolvedOutput {
  readonly id: string;
  readonly width: number;
  readonly height: number;
  readonly alpha: "transparent" | "opaque";
  readonly clearColor: Rgba;
  readonly cameraNodeId: string | null;
  readonly cadence: number;
  readonly layerMask: number;
  readonly target: RenderTargetHandle | null;
}

/** Per-output counters. Diagnostics, and the basis for on-air telemetry. */
export interface OutputStats {
  readonly id: string;
  /** Frames actually submitted. Differs from the host's frame count by cadence. */
  readonly framesRendered: number;
  /** Frames skipped because cadence said so. Not a fault. */
  readonly framesSkipped: number;
  /** Frames not drawn because no camera resolved. This IS a fault. */
  readonly framesMissed: number;
}

export function resolveOutput(descriptor: OutputDescriptor): ResolvedOutput {
  assertValid(descriptor);

  const alpha = descriptor.alpha ?? "transparent";

  return {
    id: descriptor.id,
    width: descriptor.width,
    height: descriptor.height,
    alpha,
    clearColor:
      descriptor.clearColor ?? (alpha === "opaque" ? OPAQUE_BLACK : TRANSPARENT),
    cameraNodeId: descriptor.cameraNodeId ?? null,
    cadence: descriptor.cadence ?? 1,
    layerMask: descriptor.layerMask ?? 0xffffffff,
    target: descriptor.target ?? null,
  };
}

/**
 * Rejects a descriptor that cannot produce frames.
 *
 * Loudly, at bind time. An output with a zero width does not fail at bind and
 * then quietly draw nothing for three hours — it refuses immediately, while
 * someone is still looking at the screen that reported it.
 */
function assertValid(descriptor: OutputDescriptor): void {
  if (descriptor.id.length === 0) {
    throw new OutputError("output id must not be empty");
  }
  if (!Number.isInteger(descriptor.width) || descriptor.width <= 0) {
    throw new OutputError(
      `output "${descriptor.id}" has invalid width ${descriptor.width}`,
    );
  }
  if (!Number.isInteger(descriptor.height) || descriptor.height <= 0) {
    throw new OutputError(
      `output "${descriptor.id}" has invalid height ${descriptor.height}`,
    );
  }
  if (
    descriptor.cadence !== undefined &&
    (!Number.isInteger(descriptor.cadence) || descriptor.cadence < 1)
  ) {
    throw new OutputError(
      `output "${descriptor.id}" has invalid cadence ${descriptor.cadence}; ` +
        `must be an integer of 1 or more`,
    );
  }
  if (descriptor.clearColor !== undefined && descriptor.clearColor.length !== 4) {
    throw new OutputError(
      `output "${descriptor.id}" clearColor must be RGBA`,
    );
  }
}

/**
 * The set of outputs bound to a host.
 *
 * Insertion-ordered, because draw order across outputs must be deterministic:
 * two outputs sharing a render target would otherwise produce a different
 * result depending on Map iteration, and "usually correct" is not a property.
 */
export class OutputSet {
  #outputs = new Map<string, ResolvedOutput>();
  #stats = new Map<string, { rendered: number; skipped: number; missed: number }>();

  get size(): number {
    return this.#outputs.size;
  }

  has(id: string): boolean {
    return this.#outputs.has(id);
  }

  get(id: string): ResolvedOutput | undefined {
    return this.#outputs.get(id);
  }

  /** Bind, or rebind in place. Rebinding preserves the output's counters. */
  bind(descriptor: OutputDescriptor): ResolvedOutput {
    const resolved = resolveOutput(descriptor);
    this.#outputs.set(resolved.id, resolved);
    if (!this.#stats.has(resolved.id)) {
      this.#stats.set(resolved.id, { rendered: 0, skipped: 0, missed: 0 });
    }
    return resolved;
  }

  unbind(id: string): boolean {
    this.#stats.delete(id);
    return this.#outputs.delete(id);
  }

  clear(): void {
    this.#outputs.clear();
    this.#stats.clear();
  }

  /** In bind order. */
  list(): readonly ResolvedOutput[] {
    return [...this.#outputs.values()];
  }

  /**
   * True when this output draws on the given frame.
   *
   * Keyed off the frame number rather than a per-output counter so that a
   * late-bound output falls onto the same phase as an early-bound one with the
   * same cadence. Two 30fps outputs in a 60fps show must agree on WHICH frames
   * they skip, or they drift apart and never converge.
   */
  drawsOn(output: ResolvedOutput, frame: number): boolean {
    return output.cadence === 1 || frame % output.cadence === 0;
  }

  recordRendered(id: string): void {
    const stats = this.#stats.get(id);
    if (stats) stats.rendered += 1;
  }

  recordSkipped(id: string): void {
    const stats = this.#stats.get(id);
    if (stats) stats.skipped += 1;
  }

  recordMissed(id: string): void {
    const stats = this.#stats.get(id);
    if (stats) stats.missed += 1;
  }

  stats(): readonly OutputStats[] {
    return this.list().map((output) => {
      const counters = this.#stats.get(output.id);
      return {
        id: output.id,
        framesRendered: counters?.rendered ?? 0,
        framesSkipped: counters?.skipped ?? 0,
        framesMissed: counters?.missed ?? 0,
      };
    });
  }
}

/** Camera resolution per output. Returned so a caller can report a miss. */
export interface OutputRender {
  readonly output: ResolvedOutput;
  readonly camera: CameraHandle | null;
  readonly drawn: boolean;
}
