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
