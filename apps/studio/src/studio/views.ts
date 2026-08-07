/**
 * Named camera positions — the way a designer actually navigates in 3D.
 *
 * ==========================================================================
 * WHY NAMED VIEWS AND NOT JUST ORBIT
 * ==========================================================================
 * Orbit alone is a gesture you have to know about, and a camera you can turn
 * freely is a camera you can lose. Every 3D tool worth using answers both
 * problems the same way: a small set of named views you can always get back
 * to. It is also how orbit becomes DISCOVERABLE — pressing "Top" is what
 * teaches someone the camera can move at all.
 *
 * The names are broadcast names, not engine names. "Front" is where a lower
 * third is designed; "Three-quarter" is where a virtual set reads best.
 * Nothing here says "azimuth".
 *
 * These produce a camera POSITION AND ROTATION, not a view transform. Choosing
 * a view moves the scene camera, so it is a document edit that undoes — the
 * same rule orbit follows, for the same reason: it changes what goes to air.
 */

import { lookAtRotation, positionFor, type Orbit, type Vec3 } from "./camera";

export interface NamedView {
  readonly id: string;
  readonly label: string;
  /** What it is FOR, in a designer's words. Shown as the control's title. */
  readonly hint: string;
  readonly azimuth: number;
  readonly elevation: number;
}

const DEGREES = Math.PI / 180;

/**
 * The five that earn their place on screen.
 *
 * Deliberately not six: there is no "Back". A broadcast graphic has a front,
 * and a view from behind it is a debugging aid, not a workflow.
 */
/**
 * FRONT IS NOT A MODE, IT IS 2D.
 *
 * The control used to offer five equal buttons — Front, 3/4, Side, Top, Low —
 * which asked a designer to understand camera angles before they could make a
 * flat lower third. It also buried the one distinction that actually matters:
 * whether you are working flat or in space.
 *
 * So the top level is 2D or 3D. Front IS the 2D view; the other four are
 * modes WITHIN 3D and only appear once you are there. Fewer things on screen,
 * and the one choice that changes how the product behaves is the visible one.
 */
export const FLAT: NamedView = {
  id: "front",
  label: "2D",
  hint: "Straight on. Where flat graphics are designed.",
  azimuth: 0,
  elevation: 0,
};

/** The angles offered once the scene is being worked in 3D. */
export const SPATIAL_MODES: readonly NamedView[] = [
  {
    id: "three-quarter",
    label: "3/4",
    hint: "Turned and slightly above. Where a set reads best.",
    azimuth: 35 * DEGREES,
    elevation: 18 * DEGREES,
  },
  {
    id: "side",
    label: "Side",
    hint: "From the right. Shows depth and stacking order.",
    azimuth: 90 * DEGREES,
    elevation: 0,
  },
  {
    id: "top",
    label: "Top",
    hint: "Looking down. Shows how far apart things really are.",
    azimuth: 0,
    elevation: 89 * DEGREES,
  },
  {
    id: "low",
    label: "Low",
    hint: "From below. The hero angle for a title or a trophy.",
    azimuth: 0,
    elevation: -22 * DEGREES,
  },
];

/** The view 3D opens on when you switch into it. */
export const DEFAULT_SPATIAL: NamedView = SPATIAL_MODES[0]!;

export const VIEWS: readonly NamedView[] = [
  {
    id: "front",
    label: "Front",
    hint: "Straight on. Where flat graphics are designed.",
    azimuth: 0,
    elevation: 0,
  },
  {
    id: "three-quarter",
    label: "3/4",
    hint: "Turned and slightly above. Where a set reads best.",
    azimuth: 35 * DEGREES,
    elevation: 18 * DEGREES,
  },
  {
    id: "side",
    label: "Side",
    hint: "From the right. Shows depth and stacking order.",
    azimuth: 90 * DEGREES,
    elevation: 0,
  },
  {
    id: "top",
    label: "Top",
    hint: "Looking down. Shows how far apart things really are.",
    azimuth: 0,
    // Not 90 degrees: straight down is the pole, where a camera has no
    // unambiguous up vector and the horizon flips. 89 looks identical and
    // behaves.
    elevation: 89 * DEGREES,
  },
  {
    id: "low",
    label: "Low",
    hint: "From below. The hero angle for a title or a trophy.",
    azimuth: 0,
    elevation: -22 * DEGREES,
  },
];

export interface CameraPose {
  readonly position: readonly [number, number, number];
  /** Degrees, YXZ intrinsic — SCENE_FORMAT §4. */
  readonly rotation: readonly [number, number, number];
}

/**
 * The pose a named view puts the camera in.
 *
 * `radius` is preserved from wherever the camera already is, so choosing a
 * view re-aims without also re-framing. Someone who has dollied in close to
 * letter-spacing on a title expects "Side" to show them that title from the
 * side, not to fly back out to a default distance.
 */
export function poseFor(view: NamedView, pivot: Vec3, radius: number): CameraPose {
  const orbit: Orbit = { radius, azimuth: view.azimuth, elevation: view.elevation };
  const position = positionFor(orbit, pivot);
  return {
    position: [round(position.x), round(position.y), round(position.z)],
    rotation: lookAtRotation(position, pivot).map(round) as unknown as readonly [
      number,
      number,
      number,
    ],
  };
}

/**
 * The pose part-way between two orbits.
 *
 * ==========================================================================
 * WHY A TRANSITION AND NOT A JUMP
 * ==========================================================================
 * 2D and 3D are two PORTS ONTO ONE SCENE, not two scenes. Everything in the
 * graphic is in both — the same nodes, the same materials, the same
 * animation — and the only thing that differs is where you are standing.
 *
 * A camera that teleports hides exactly that. The picture changes completely
 * between one frame and the next, so the eye has no way to carry the content
 * across and reads it as a different view of a different thing. Moving the
 * camera there instead makes the continuity self-evident: you watch your own
 * lower third turn, so you know it is the same lower third.
 *
 * Interpolated in SPHERICAL coordinates, not by blending positions. Blending
 * two positions moves the camera in a straight line through the middle of the
 * scene, which passes through the graphic and looks like a collision.
 * Interpolating the angles arcs around the pivot, which is the path the
 * gesture would have taken by hand.
 */
export function between(from: Orbit, to: Orbit, t: number): Orbit {
  const k = Math.max(0, Math.min(1, t));
  // The short way round. Turning 350 degrees to arrive somewhere 10 degrees
  // away is technically correct and reads as a fault.
  const turn = Math.PI * 2;
  let delta = (to.azimuth - from.azimuth) % turn;
  if (delta > Math.PI) delta -= turn;
  if (delta < -Math.PI) delta += turn;
  return {
    radius: from.radius + (to.radius - from.radius) * k,
    azimuth: from.azimuth + delta * k,
    elevation: from.elevation + (to.elevation - from.elevation) * k,
  };
}

/**
 * The Design OS `glide` curve, as a function.
 *
 * cubic-bezier(.16, 1, .3, 1) — fast to leave, long to settle. It is the
 * curve the specification gives for something ARRIVING, which is what a view
 * does.
 */
export function glide(t: number): number {
  const k = Math.max(0, Math.min(1, t));
  return 1 - Math.pow(1 - k, 3);
}

/** How long a view change takes. Volume One's `--d-slow`, near enough. */
export const VIEW_TRANSITION_MS = 420;

/**
 * Which named view a camera is currently in, if any.
 *
 * Used to light the control up. Without it a designer cannot tell "I am in the
 * Front view" from "I have orbited back to roughly the front", and the second
 * is the state where a graphic quietly stops being pixel-accurate.
 */
export function viewOf(orbit: Orbit, tolerance = 0.02): NamedView | null {
  for (const view of VIEWS) {
    const dAzimuth = Math.abs(normalise(orbit.azimuth - view.azimuth));
    const dElevation = Math.abs(orbit.elevation - view.elevation);
    if (dAzimuth <= tolerance && dElevation <= tolerance) return view;
  }
  return null;
}

/** Wraps to −π…π, so 359° and 1° are two degrees apart rather than 358. */
function normalise(radians: number): number {
  const turn = Math.PI * 2;
  const wrapped = ((radians % turn) + turn) % turn;
  return wrapped > Math.PI ? wrapped - turn : wrapped;
}

function round(value: number): number {
  // The `+ 0` normalises negative zero. A camera aimed straight ahead yields
  // -0 for its pitch, which serialises the same but shows up as a difference
  // in every document comparison — a diff nobody made and nobody can explain.
  return Math.round(value * 1e6) / 1e6 + 0;
}
