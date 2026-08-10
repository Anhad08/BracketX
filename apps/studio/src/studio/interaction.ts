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
  /** The context menu owns the right button; nothing else may act on it. */
  | { readonly kind: "menu" }
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
export function wheelIntent(event: InputEvent, dimensional = false): ViewportIntent {
  const dx = event.deltaX ?? 0;
  const dy = event.deltaY ?? 0;
  if (event.mod) {
    if (dy === 0) return { kind: "none" };
    // Wheel down is conventionally zoom OUT.
    return { kind: "zoom", direction: dy < 0 ? 1 : -1, at: event.at };
  }
  if (event.shift) return { kind: "scroll", dx: dy !== 0 ? dy : dx, dy: 0 };
  // ==========================================================================
  // IN A 3D SCENE THE BARE WHEEL DOLLIES. IT DOES NOT SCROLL THE PAGE.
  // ==========================================================================
  // A flat graphic is a document: the wheel scrolls it, the way it scrolls
  // every other document, and §03 says so. A 3D scene is not a document — it
  // has no edges to scroll to — and there the wheel is the one input every 3D
  // editor spends on distance.
  //
  // Leaving both on `scroll` is what made the viewport feel two-dimensional:
  // turning the wheel slid the whole scene up and down the screen instead of
  // moving the camera through it, so the only way to get closer to anything was
  // a modifier nobody guesses. The gesture was never missing; it was spent on
  // the wrong verb.
  if (dimensional) {
    if (dy === 0) return { kind: "none" };
    return { kind: "zoom", direction: dy < 0 ? 1 : -1, at: event.at };
  }
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
export function pointerIntent(
  event: InputEvent,
  dimensional: boolean,
  /**
   * Is something under the pointer that a drag would act ON?
   *
   * The one fact that separates "navigate the scene" from "move that object",
   * and the reason orbit can have the plain left button in 3D without stealing
   * anything. Empty space in a 3D scene has no other job — there is nothing
   * there to select or drag — so a drag that starts on it turns the camera.
   * A drag that starts on an object still moves the object, exactly as before.
   *
   * Defaults false so every existing caller and test keeps its meaning.
   */
  onObject = false,
): ViewportIntent {
  // THE RIGHT BUTTON BELONGS TO THE MENU, AND TO NOTHING ELSE.
  //
  // It used to fall through to selection: a right-click on empty stage began a
  // marquee, and releasing it cleared the selection — so the context menu
  // opened over a selection that had just been thrown away, and Escape then
  // looked like it had deselected when the right-click had already done it.
  // Declared here rather than guarded in the handler, so the rule is one line
  // in the model instead of a condition somebody can forget.
  if (event.button === 2) return { kind: "menu" };
  if (event.button === 1) return { kind: "pan" };
  if (event.space === true) return { kind: "pan" };
  if (event.alt && dimensional) return { kind: "orbit" };
  // ==========================================================================
  // THE PLAIN DRAG ORBITS, WHERE THERE IS A SCENE AND NOTHING UNDER THE HAND.
  // ==========================================================================
  // Alt+drag stays — it is Blender's own emulate-three-button binding and the
  // hands that know it should keep it. But requiring a modifier to turn the
  // camera is what made this read as a 2D canvas with 3D objects sitting in it:
  // the first thing anybody does in a 3D scene is drag to look around, and
  // dragging did nothing but start a marquee over empty air.
  //
  // Deliberately NOT taken from a flat graphic. A lower third is designed
  // square-on and stays square-on, so there the plain drag keeps marquee
  // selection, which is the only thing it could usefully mean.
  if (dimensional && !onObject) return { kind: "orbit" };
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
  /** Back to the opening inspection view. The Scene is not touched. */
  | { readonly kind: "resetView" }
  | { readonly kind: "frame" }
  | { readonly kind: "zoom"; readonly direction: 1 | -1 }
  | { readonly kind: "actualSize" }
  /** Recall a stored camera. `studio-specification.html` §03, ⌥1–⌥6. */
  | { readonly kind: "recall"; readonly slot: number }
  /** Store the current camera into a slot. ⌥⇧1–⌥⇧6. */
  | { readonly kind: "store"; readonly slot: number }
  /**
   * Restore a GRAPHIC's remembered view, or Fit if it has none. §03.
   *
   * Distinct from `recall`, which is a numbered slot a designer filled on
   * purpose. This is the view they simply left behind, and it is per document
   * rather than per key.
   */
  | { readonly kind: "recallCamera"; readonly documentId: string }
  /**
   * Pan the view by a screen delta. The drag's own execution, named.
   *
   * A DELTA rather than a destination, because that is what every route to it
   * carries: a middle-drag, a space-drag and a two-finger scroll all say "this
   * far, this way". The command that offers it from a menu supplies its own.
   */
  | {
      readonly kind: "panBy";
      /** Screen pixels the CONTENT should move by, as a drag would move it. */
      readonly dx: number;
      readonly dy: number;
    }
  /** Centre the frame in the viewport without changing the zoom. */
  | { readonly kind: "centre" }
  /**
   * Turn the scene camera about what it is looking at, in radians.
   *
   * Unlike pan, this MOVES THE SCENE CAMERA — a document edit that changes
   * what the output frames. Navigating the stage and aiming the camera are
   * different acts and the product must not blur them, which is why they are
   * different actions rather than one with a flag.
   */
  | { readonly kind: "orbitBy"; readonly azimuth: number; readonly elevation: number }
  /** Enter or leave walk mode. §03 has no rule for it; Blender's Shift+`. */
  | { readonly kind: "walk" };

/**
 * One orbit step, for the keyboard and the menu. Radians.
 *
 * Fifteen degrees: small enough that a few presses explore an angle, large
 * enough that one press is visibly a move rather than a nudge.
 */
export const ORBIT_STEP = (15 * Math.PI) / 180;

/**
 * One pan step, in screen pixels, for the keyboard and the menu.
 *
 * A tenth of a 1080-line frame — far enough to be worth pressing, short enough
 * that the graphic never leaves the viewport in one go.
 */
export const PAN_STEP = 108;

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

// ===========================================================================
// Zoom animation
// ===========================================================================

/**
 * How long a zoom takes. `studio-specification.html` §03: "120 ms · press".
 *
 * ==========================================================================
 * WHY A NUMBER HERE AND NOT A TOKEN IN THE LADDER
 * ==========================================================================
 * The Design OS motion ladder is 0 · 90 · 180 · 320 · 520 · 900, and it is
 * deliberately short — the file that defines it says an invented system "is
 * gone rather than reconciled". 120 is not on it, and adding a seventh rung
 * for one interaction would grow the general system to serve a specific case.
 *
 * §03 names this duration for THIS interaction, so it lives with the
 * interaction. The CURVE is not invented: `press` is the Design OS's own,
 * "decelerates hard so things arrive and stop", which is what a zoom that
 * lands on a known rung should do.
 */
export const ZOOM_ANIMATION_MS = 120;

/**
 * The Design OS `press` curve, in arithmetic.
 *
 * `cubic-bezier(0.3, 0.7, 0.4, 1)`, solved by the usual Newton step. Copied in
 * value rather than in spirit, so the zoom eases exactly as every other
 * arriving thing in the product does — a viewport that moved on its own curve
 * would read as a different piece of software.
 */
export function press(t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  // x(s) and y(s) for the cubic Bézier with p1 = (0.3, 0.7), p2 = (0.4, 1).
  const bezier = (a: number, b: number, s: number): number => {
    const inverse = 1 - s;
    return 3 * inverse * inverse * s * a + 3 * inverse * s * s * b + s * s * s;
  };
  let s = clamped;
  for (let step = 0; step < 6; step += 1) {
    const x = bezier(0.3, 0.4, s) - clamped;
    const slope =
      3 * (1 - s) * (1 - s) * 0.3 + 6 * (1 - s) * s * (0.4 - 0.3) + 3 * s * s * (1 - 0.4);
    if (Math.abs(slope) < 1e-6) break;
    s -= x / slope;
  }
  return bezier(0.7, 1, Math.min(1, Math.max(0, s)));
}

/**
 * A viewport part-way between two others.
 *
 * Zoom is interpolated in LOG space, for the same reason the ladder's nearest
 * rung is chosen there: zoom is a ratio. Linearly, half way between 100% and
 * 800% is 450%, which is nowhere near the middle of that journey and makes the
 * first half of every zoom-out crawl.
 */
export function tweenViewport(from: Viewport, to: Viewport, t: number): Viewport {
  const eased = press(t);
  return {
    zoom: Math.exp(Math.log(from.zoom) + (Math.log(to.zoom) - Math.log(from.zoom)) * eased),
    panX: from.panX + (to.panX - from.panX) * eased,
    panY: from.panY + (to.panY - from.panY) * eased,
  };
}

/**
 * Does this person want less motion?
 *
 * Asked of the SYSTEM, every time, rather than cached at boot: a preference
 * changed mid-session should take effect without a reload, and someone turning
 * it on is usually doing so because something is already making them unwell.
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
