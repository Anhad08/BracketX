/**
 * Three quality presets, and the rule that picks one.
 *
 * ==========================================================================
 * WHAT A PRESET IS ALLOWED TO TOUCH
 * ==========================================================================
 * The EDITOR PREVIEW, and nothing else. Programme output is never scaled,
 * never de-antialiased and never simplified — a broadcast feed has a fixed
 * pixel grid, and a preset that quietly softened what went to air would be a
 * defect of the most expensive kind. `programOptions()` exists so that rule is
 * enforced by a function rather than by everybody remembering it.
 *
 * Within the preview, the knobs are the ones the render backend already
 * exposes — pixel ratio, antialias, VRAM ceiling — plus the density of the
 * editor's own chrome. Nothing here is a new rendering path.
 *
 * ==========================================================================
 * WHY THREE, AND WHY ONE IS AUTOMATIC
 * ==========================================================================
 * Two is not enough to describe the range between a phone and a workstation,
 * and five is a menu nobody reads. Three named tiers, plus Auto, is the shape
 * every application with this problem converges on.
 *
 * Auto measures rather than guesses where it can: core count and memory are
 * reported by the browser and are the only honest signals available before a
 * frame has been drawn. They are advisory — the user's explicit choice always
 * wins, and is remembered.
 */

import type { DeviceInput } from "./device";

export type QualityTier = "low" | "mid" | "high";
/** What the user chose. "auto" resolves to a tier; a tier is a pin. */
export type QualityChoice = QualityTier | "auto";

export interface QualitySettings {
  /**
   * Multiplier on the preview's pixel grid.
   *
   * Below 1 the preview renders fewer pixels and is scaled up — the single
   * biggest lever there is, because cost is quadratic in this number.
   */
  readonly renderScale: number;
  readonly antialias: boolean;
  /** VRAM ceiling handed to the backend, in bytes. */
  readonly maxBytes: number;
  /** Half-width of the ground grid, in world units. */
  readonly gridExtent: number;
  readonly gridSpacing: number;
  /** Frames per second the editor aims for. */
  readonly targetFps: number;
  readonly label: string;
  readonly hint: string;
}

const MB = 1024 * 1024;

export const PRESETS: Record<QualityTier, QualitySettings> = {
  low: {
    renderScale: 0.6,
    antialias: false,
    maxBytes: 96 * MB,
    // A coarse grid, and less of it. The floor is there to tell you where you
    // are, and it does that at four-unit spacing just as well.
    gridExtent: 12,
    gridSpacing: 4,
    targetFps: 30,
    label: "Low",
    hint: "For phones and older machines. Smooth first, sharp second.",
  },
  mid: {
    renderScale: 1,
    antialias: false,
    maxBytes: 256 * MB,
    gridExtent: 24,
    gridSpacing: 1,
    targetFps: 60,
    label: "Medium",
    hint: "The balance most laptops and tablets want.",
  },
  high: {
    renderScale: 1,
    antialias: true,
    maxBytes: 512 * MB,
    gridExtent: 48,
    gridSpacing: 1,
    targetFps: 60,
    label: "High",
    hint: "Antialiasing and a deep grid. For desktops with a real GPU.",
  },
};

export const TIERS: readonly QualityTier[] = ["low", "mid", "high"];

/**
 * The tier a device should start on.
 *
 * Deliberately conservative: a machine that turns out to be faster than
 * expected costs a user one click to correct, while a machine that turns out
 * to be slower costs them a stuttering first impression of the product.
 */
export function suggestTier(device: DeviceInput): QualityTier {
  const cores = device.cores ?? 4;
  const memory = device.memoryGb ?? 4;

  // A coarse pointer on a small screen is a phone, whatever it claims about
  // its cores — thermal limits, not core count, decide what it sustains.
  if (device.coarsePointer && Math.min(device.width, device.height) < 600) return "low";
  if (cores <= 4 || memory <= 4) return "low";
  if (cores >= 8 && memory >= 8 && !device.coarsePointer) return "high";
  return "mid";
}

export function resolveTier(choice: QualityChoice, device: DeviceInput): QualityTier {
  return choice === "auto" ? suggestTier(device) : choice;
}

export function settingsFor(choice: QualityChoice, device: DeviceInput): QualitySettings {
  return PRESETS[resolveTier(choice, device)];
}

/**
 * Backend options for the PREVIEW canvas.
 *
 * `renderScale` is capped at the device's own pixel ratio: rendering more
 * pixels than the panel can show is pure cost, and on a 2x display a scale of
 * 1 already means one rendered pixel per CSS pixel — which is what the preview
 * wants, because the scene has its own fixed pixel grid.
 */
export function previewOptions(
  settings: QualitySettings,
  devicePixelRatio = 1,
): { pixelRatio: number; antialias: boolean; maxBytes: number } {
  return {
    pixelRatio: Math.max(0.35, Math.min(settings.renderScale, devicePixelRatio)),
    antialias: settings.antialias,
    maxBytes: settings.maxBytes,
  };
}

/**
 * Backend options for PROGRAMME.
 *
 * Fixed, and independent of every preset. What goes to air is not a quality
 * setting — a feed that softened because the operator's laptop was warm would
 * be the most expensive bug this product could ship. Only the VRAM ceiling
 * follows the tier, because that is a limit on allocation rather than on the
 * picture: exceeding it refuses the allocation, it does not degrade the frame.
 */
export function programOptions(settings: QualitySettings): {
  pixelRatio: number;
  antialias: boolean;
  maxBytes: number;
} {
  return { pixelRatio: 1, antialias: false, maxBytes: settings.maxBytes };
}

// ---------------------------------------------------------------------------
// Measuring what actually happened
// ---------------------------------------------------------------------------

export interface FrameReport {
  /** Frames per second over the sample window. */
  readonly fps: number;
  /** The 95th percentile frame time, in ms. What a stutter actually feels like. */
  readonly worstMs: number;
  /** Frames that missed the tier's budget. */
  readonly missed: number;
  readonly sampled: number;
  /** True when the tier is not being met and a lower one would help. */
  readonly strained: boolean;
}

/**
 * A rolling window of frame times.
 *
 * The mean is not enough. A viewport that renders at 60fps and hitches once a
 * second reads as broken while averaging perfectly well, so the 95th
 * percentile is reported alongside — that is the number that matches what
 * somebody watching the screen actually experiences.
 */
export class FrameMeter {
  #times: number[] = [];
  readonly #capacity: number;

  constructor(capacity = 120) {
    this.#capacity = Math.max(8, capacity);
  }

  record(milliseconds: number): void {
    if (!Number.isFinite(milliseconds) || milliseconds <= 0) return;
    this.#times.push(milliseconds);
    if (this.#times.length > this.#capacity) this.#times.shift();
  }

  reset(): void {
    this.#times = [];
  }

  get samples(): number {
    return this.#times.length;
  }

  report(settings: QualitySettings): FrameReport {
    const sampled = this.#times.length;
    if (sampled === 0) {
      return { fps: 0, worstMs: 0, missed: 0, sampled: 0, strained: false };
    }

    const budget = 1000 / settings.targetFps;
    let total = 0;
    let missed = 0;
    for (const time of this.#times) {
      total += time;
      // 1.25x the budget, not 1.0: a frame that lands a whisker late is
      // indistinguishable to the eye, and counting it would report strain on
      // a machine that is comfortably keeping up.
      if (time > budget * 1.25) missed += 1;
    }

    const sorted = [...this.#times].sort((a, b) => a - b);
    const worstMs = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ?? 0;

    return {
      fps: 1000 / (total / sampled),
      worstMs,
      missed,
      sampled,
      // A tenth of frames late, over a full window. Below that it is noise —
      // a garbage collection or a panel opening — and reacting to noise is how
      // a quality setting ends up flickering between tiers.
      strained: sampled >= this.#capacity / 2 && missed / sampled > 0.1,
    };
  }
}

/** The next tier down, or null at the bottom. */
export function lowerTier(tier: QualityTier): QualityTier | null {
  return tier === "high" ? "mid" : tier === "mid" ? "low" : null;
}
