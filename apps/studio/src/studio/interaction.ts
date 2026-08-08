/**
 * THE VIEWPORT INTERACTION MODEL.
 *
 * ============================================================================
 * WHY THIS FILE EXISTS
 * ============================================================================
 * Every viewport gesture used to be a separate one-off: the wheel decided zoom
 * inline, the middle button decided orbit inline, walk mode carried its own
 * keyboard listener, and none of them was a command — so none of them appeared
 * in the menu bar, the palette or the keyboard reference, and none could be
 * rebound. Six input systems in one viewport, and eight keydown listeners in
 * the app, with Escape claimed in five places.
 *
 * That is how two of them ended up CONTRADICTING the approved specification
 * without anyone noticing: bare-wheel zoom and middle-drag orbit were added
 * from Blender's conventions while `studio-specification.html` §03 says the
 * wheel scrolls and the middle button pans.
 *
 * So the gestures are declared here, in one table, and the viewport routes
 * through it. A gesture that is not in this file does not exist, and a rule
 * that changes changes in one place.
 *
 * ============================================================================
 * THE AUTHORITY, AND WHERE BLENDER FITS
 * ============================================================================
 * `studio-specification.html` §03 is the authority for zoom and pan. It is
 * emphatic about the wheel, and it is right: bare-wheel zoom fires constantly
 * on trackpads and is the single most complained-about behaviour in design
 * tools. Blender binds it the other way, and Blender is not wrong for Blender —
 * it is a modelling application whose users hold a three-button mouse all day.
 * Streamatrix is a broadcast tool used on laptops.
 *
 * So the SPEC wins wherever the two disagree, and Blender's conventions are
 * adopted everywhere they do not:
 *
 *   Spec wins        wheel scrolls · ⌘-wheel zooms about the pointer ·
 *                    middle-drag pans · discrete zoom steps
 *   Blender adopted  G/R/S for move/rotate/scale · Alt-drag orbits ·
 *                    walk mode on Shift+` with W A S D Q E · F frames
 *
 * Orbit moved from the middle button to Alt-drag precisely because the middle
 * button is spoken for. It is not a compromise: Alt-drag is the orbit binding
 * in Maya and in Blender's own emulate-three-button mode, so it is a gesture
 * a 3D user already has in their hands.
 */
import { MAX_ZOOM, MIN_ZOOM, type Point, type Viewport } from "./viewport";

/**
 * The zoom ladder. `studio-specification.html` §03, exactly as written.
 *
 * DISCRETE, not continuous. The spec's reasoning is the whole point:
 * "continuous zoom means you are never at a known scale, and 'is this 1:1?' is
 * the question that decides whether what you see is what airs."
 */
export const ZOOM_STEPS: readonly number[] = [0.1, 0.25, 0.5, 0.66, 1, 2, 4, 8];

/** The nearest rung to a given scale. Used by Fit, which computes then lands. */
export function nearestStep(zoom: number): number {
  let best = ZOOM_STEPS[0]!;
  let bestDistance = Infinity;
  for (const step of ZOOM_STEPS) {
    // Compared in LOG space. Linearly, 4 is "closer" to 2 than 0.5 is to 1,
    // which lands Fit on the wrong rung for anything below 100%.
    const distance = Math.abs(Math.log(step) - Math.log(zoom));
    if (distance < bestDistance) {
      bestDistance = distance;
      best = step;
    }
  }
  return best;
}

/** The next rung up or down from where the viewport is now. */
export function steppedZoom(zoom: number, direction: 1 | -1): number {
  const current = nearestStep(zoom);
  const index = ZOOM_STEPS.indexOf(current);
  // A zoom that is BETWEEN rungs steps to the rung it is heading towards
  // rather than snapping backwards first, which would make one notch feel
  // like nothing happened.
  const offset = Math.abs(Math.log(current) - Math.log(zoom)) > 1e-6
    ? (direction === 1 ? (current > zoom ? 0 : 1) : current < zoom ? 0 : -1)
    : direction;
  const next = ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, Math.max(0, index + offset))]!;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next));
}

/**
 * What a gesture MEANS. The viewport reads this and does it.
 *
 * Named for the user's intent rather than the input, so the same intent can
 * arrive from a wheel, a key or a menu item and be handled once.
 */
export type ViewportIntent =
  | { readonly kind: "scroll"; readonly dx: number; readonly dy: number }
  | { readonly kind: "zoom"; readonly direction: 1 | -1; readonly at: Point }
  | { readonly kind: "pan" }
  | { readonly kind: "orbit" }
  | { readonly kind: "select" }
  | { readonly kind: "none" };

/** What the pointer or wheel carries, without React or DOM types. */
export interface InputEvent {
  readonly button?: number;
  readonly alt: boolean;
  readonly shift: boolean;
  /** Ctrl on Windows, Command on macOS. The spec's "⌘". */
  readonly mod: boolean;
  readonly deltaX?: number;
  readonly deltaY?: number;
  readonly at: Point;
  /** Space held. The spec's first pan route. */
  readonly space?: boolean;
}

/**
 * THE WHEEL. `studio-specification.html` §03.
 *
 *   bare        scrolls vertically
 *   shift       scrolls horizontally, the universal convention
 *   ⌘ / ctrl    zooms about the POINTER, one discrete step per notch
 *
 * Bare-wheel zoom is deliberately not available. The spec calls it the single
 * most complained-about behaviour in design tools, and on a trackpad it fires
 * on every two-finger gesture — which is also, per the same table, one of the
 * three sanctioned ways to PAN.
 */
export function wheelIntent(event: InputEvent): ViewportIntent {
  const dx = event.deltaX ?? 0;
  const dy = event.deltaY ?? 0;
  if (event.mod) {
    if (dy === 0) return { kind: "none" };
    // Wheel down is conventionally zoom OUT.
    return { kind: "zoom", direction: dy < 0 ? 1 : -1, at: event.at };
  }
  if (event.shift) return { kind: "scroll", dx: dy !== 0 ? dy : dx, dy: 0 };
  return { kind: "scroll", dx, dy };
}

/**
 * THE POINTER.
 *
 *   middle              pan          spec §03, one of three sanctioned routes
 *   space + left        pan          spec §03, for anyone without a middle button
 *   alt + left          orbit        Blender's own emulate-3-button binding
 *   left                select
 *
 * Orbit is available only where there is something to orbit. In the flat view
 * the camera is fixed — a lower third is designed square-on and stays square-on
 * — so an Alt-drag there falls through to selection rather than silently
 * turning the camera a designer cannot see they have turned.
 */
export function pointerIntent(event: InputEvent, dimensional: boolean): ViewportIntent {
  if (event.button === 1) return { kind: "pan" };
  if (event.space === true) return { kind: "pan" };
  if (event.alt && dimensional) return { kind: "orbit" };
  return { kind: "select" };
}

/** Applies a scroll, in screen pixels. Positive `dy` moves the content up. */
export function scrolled(viewport: Viewport, dx: number, dy: number): Viewport {
  return { ...viewport, panX: viewport.panX - dx, panY: viewport.panY - dy };
}

/**
 * Zooms one rung, holding the pixel under the pointer in place.
 *
 * The anchor arithmetic is the same as `zoomAt`'s and for the same reason:
 * zooming about the viewport centre is what makes an editor feel like it is
 * fighting you — you point at a corner, zoom, and the corner leaves the screen.
 */
export function zoomedStep(viewport: Viewport, anchor: Point, direction: 1 | -1): Viewport {
  const zoom = steppedZoom(viewport.zoom, direction);
  if (zoom === viewport.zoom) return viewport;
  const ratio = zoom / viewport.zoom;
  return {
    zoom,
    panX: anchor.x - (anchor.x - viewport.panX) * ratio,
    panY: anchor.y - (anchor.y - viewport.panY) * ratio,
  };
}

/**
 * Lands a computed scale on the ladder, keeping the same centre.
 *
 * "Default Fit, then snap to nearest step. Opening at an arbitrary 87 %
 * teaches nothing." — §03.
 */
export function snappedToStep(
  viewport: Viewport,
  element: { readonly width: number; readonly height: number },
): Viewport {
  const zoom = nearestStep(viewport.zoom);
  if (zoom === viewport.zoom) return viewport;
  const centre = { x: element.width / 2, y: element.height / 2 };
  const ratio = zoom / viewport.zoom;
  return {
    zoom,
    panX: centre.x - (centre.x - viewport.panX) * ratio,
    panY: centre.y - (centre.y - viewport.panY) * ratio,
  };
}

// ===========================================================================
// The command channel
// ===========================================================================

/**
 * A viewport action, named rather than computed by whoever asked for it.
 *
 * ==========================================================================
 * ONE OWNER, ONE CHANNEL
 * ==========================================================================
 * Viewport control used to be split. The stage owned pan, zoom and orbit; the
 * shell owned Fit and Frame through one boolean-ish token each, and computed
 * Zoom In and Zoom Out itself with arithmetic the stage knew nothing about —
 * which is how the keyboard ended up zooming CONTINUOUSLY, about the origin,
 * while the wheel zoomed in discrete steps about the pointer. Two zooms, one
 * product.
 *
 * The stage is the owner: it is the only thing that knows the element's size,
 * and every one of these actions needs it. So the shell now NAMES an action
 * and the stage performs it. Adding one is a case here and a case there, and
 * it is impossible to add one that only half the product agrees with.
 *
 * `nonce` rather than a queue: these are idempotent view changes, and asking
 * for Fit twice while one is in flight should Fit once.
 */
export type ViewportAction =
  | { readonly kind: "fit" }
  | { readonly kind: "frame" }
  | { readonly kind: "zoom"; readonly direction: 1 | -1 }
  | { readonly kind: "actualSize" }
  /** Recall a stored camera. `studio-specification.html` §03, ⌥1–⌥6. */
  | { readonly kind: "recall"; readonly slot: number }
  /** Store the current camera into a slot. ⌥⇧1–⌥⇧6. */
  | { readonly kind: "store"; readonly slot: number };

export interface ViewportRequest {
  readonly action: ViewportAction;
  /** Bumped per request so the stage can tell a repeat from a re-render. */
  readonly nonce: number;
}

/**
 * How many camera presets. §03: "Six, bound ⌥1 – ⌥6."
 *
 * "Six because a lower third has about that many regions worth returning to.
 * Ten would never be filled."
 */
export const PRESET_SLOTS = 6;

/** A stored camera. Exactly a viewport — there is nothing else to remember. */
export type CameraPreset = Viewport;

/**
 * Zooms to exactly 1:1.
 *
 * §03: "At 100 % one viewport pixel is one output pixel, on any display scale
 * factor. The only zoom at which a designer can judge type legibility. It must
 * be EXACT, not approximately exact." So this assigns 1 rather than scaling
 * towards it, and holds the centre.
 */
export function actualSize(
  viewport: Viewport,
  element: { readonly width: number; readonly height: number },
): Viewport {
  if (viewport.zoom === 1) return viewport;
  const centre = { x: element.width / 2, y: element.height / 2 };
  const ratio = 1 / viewport.zoom;
  return {
    zoom: 1,
    panX: centre.x - (centre.x - viewport.panX) * ratio,
    panY: centre.y - (centre.y - viewport.panY) * ratio,
  };
}

/** Zooms one rung about the element's centre. The keyboard's route. */
export function zoomedStepCentred(
  viewport: Viewport,
  element: { readonly width: number; readonly height: number },
  direction: 1 | -1,
): Viewport {
  return zoomedStep(viewport, { x: element.width / 2, y: element.height / 2 }, direction);
}
