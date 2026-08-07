/**
 * Which renderer draws the scene.
 *
 * ============================================================================
 * TWO ADAPTERS, ONE ACTIVE PER SESSION
 * ============================================================================
 * The founder's decision, recorded verbatim: *a second selectable backend,
 * three stays default.*
 *
 * `MirrorBackend` has been described as the seam that makes renderers
 * swappable since Phase 2. This module is where that stops being an
 * architectural claim and becomes something a person can click — and the only
 * place in the entire application above `render-adapter` that knows more than
 * one renderer exists. Everything else is handed a `MirrorBackend` and cannot
 * tell which library is behind it; the boundary checker enforces that.
 *
 * ============================================================================
 * WHY THE CHOICE NEEDS A RELOAD
 * ============================================================================
 * MirrorBackend C2: a backend binds to its canvas for the session's lifetime.
 * Swapping renderers under a live session would mean tearing down both mirrors
 * and rebuilding every GPU resource while a graphic might be on air.
 *
 * So the choice is remembered and applied on the next start. That is stated in
 * the UI rather than hidden, because a setting that appears to do nothing is
 * worse than one that says when it takes effect.
 */
import { createCanvasBackend } from "@bracketx/engine-render-three";
import { createBabylonCanvasBackend } from "@bracketx/engine-render-babylon";
import type { MirrorBackend } from "@bracketx/engine-reconciler";

export type RendererChoice = "three" | "babylon";

export interface RendererSpec {
  readonly id: RendererChoice;
  /** What a person calls it. */
  readonly label: string;
  /** One line, shown under the choice. Says what it means for THEM. */
  readonly hint: string;
}

export const RENDERERS: readonly RendererSpec[] = [
  {
    id: "three",
    label: "Standard",
    hint: "The default. Everything is supported, including text and outputs.",
  },
  {
    id: "babylon",
    label: "Babylon",
    hint: "An alternative renderer. 3D scenes only — text is not drawn yet.",
  },
];

export const DEFAULT_RENDERER: RendererChoice = "three";

export function rendererSpec(choice: RendererChoice): RendererSpec {
  return RENDERERS.find((entry) => entry.id === choice) ?? RENDERERS[0]!;
}

export interface BackendOptions {
  readonly antialias?: boolean;
  readonly maxBytes?: number;
  readonly pixelRatio?: number;
}

/**
 * A backend for a canvas, on the chosen renderer.
 *
 * The one function in Studio that names a renderer. Adding a third means
 * adding a case here and nowhere else, which is the property the seam was
 * built for.
 */
export function createBackend(
  choice: RendererChoice,
  canvas: HTMLCanvasElement,
  options: BackendOptions = {},
): MirrorBackend {
  if (choice === "babylon") {
    return createBabylonCanvasBackend(canvas, {
      ...(options.antialias === undefined ? {} : { antialias: options.antialias }),
      ...(options.maxBytes === undefined ? {} : { maxBytes: options.maxBytes }),
    });
  }
  return createCanvasBackend(canvas, options);
}
