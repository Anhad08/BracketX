/**
 * The three-axis move gizmo.
 *
 * ==========================================================================
 * WHY AN AXIS GIZMO AT ALL
 * ==========================================================================
 * Free dragging in a 3D viewport is a guess. The pointer has two dimensions
 * and the scene has three, so something has to decide the third — and whatever
 * it decides will be wrong often enough to be maddening. Every 3D tool answers
 * this the same way: you say WHICH AXIS first, and then the drag is exact.
 *
 * That is the whole purpose here. Grab the red arrow and the node moves in X
 * and only X, however the camera happens to be turned.
 *
 * ==========================================================================
 * HOW A DRAG IS RESOLVED
 * ==========================================================================
 * Not by screen deltas. A screen delta has to be divided by some scale to
 * become a world distance, and under perspective there is no single correct
 * scale — the same drag means more at the far end of the axis than the near.
 * Editors that do it that way feel like the object is sliding on ice.
 *
 * Instead the pointer ray is intersected with the AXIS LINE, using the closest
 * point between two skew lines. That is exact under any projection and at any
 * camera angle, and it is why grabbing an arrow and moving the pointer keeps
 * the arrow under the pointer instead of drifting away from it.
 */

import { intersectPlane, project, rayThrough, type CameraView, type Ray, type Vec3 } from "./camera";
import type { Point } from "./viewport";

export type AxisId = "x" | "y" | "z";

export interface Axis {
  readonly id: AxisId;
  readonly direction: Vec3;
  /** The colour convention every 3D tool shares: X red, Y green, Z blue. */
  readonly colour: string;
  readonly label: string;
}

export const AXES: readonly Axis[] = [
  { id: "x", direction: { x: 1, y: 0, z: 0 }, colour: "#e5484d", label: "left and right" },
  { id: "y", direction: { x: 0, y: 1, z: 0 }, colour: "#46a758", label: "up and down" },
  { id: "z", direction: { x: 0, y: 0, z: 1 }, colour: "#3b82f6", label: "towards and away" },
];

export function axisById(id: AxisId): Axis {
  return AXES.find((axis) => axis.id === id) ?? AXES[0]!;
}

/** The far end of an axis arm, in world space. */
export function tipOf(origin: Vec3, axis: Axis, length: number): Vec3 {
  return {
    x: origin.x + axis.direction.x * length,
    y: origin.y + axis.direction.y * length,
    z: origin.z + axis.direction.z * length,
  };
}

export interface ProjectedAxis {
  readonly axis: Axis;
  readonly from: Point;
  readonly to: Point;
  /**
   * How edge-on the axis is, 0 to 1.
   *
   * An axis pointing almost straight at the camera projects to almost nothing.
   * Drawing it anyway gives a stub that is impossible to aim at and, worse,
   * ambiguous about direction — push or pull looks identical. The renderer
   * fades it and the hit test ignores it below a threshold.
   */
  readonly foreshortening: number;
}

/**
 * The three arms as drawn.
 *
 * `length` is in world units and is the caller's business: it should be a
 * constant number of SCREEN pixels, or the gizmo grows and shrinks with the
 * zoom and becomes either invisible or enormous.
 */
export function projectAxes(
  view: CameraView,
  origin: Vec3,
  length: number,
): readonly ProjectedAxis[] {
  const centre = project(view, origin);
  if (centre === null || !centre.inFront) return [];

  const out: ProjectedAxis[] = [];
  for (const axis of AXES) {
    const tip = project(view, tipOf(origin, axis, length));
    if (tip === null || !tip.inFront) continue;

    const dx = tip.point.x - centre.point.x;
    const dy = tip.point.y - centre.point.y;
    const drawn = Math.hypot(dx, dy);

    // Compare against the arm drawn perpendicular to the view, which is the
    // longest it could possibly appear. The ratio is how much of it survives.
    const reference = referenceLength(view, origin, length);
    out.push({
      axis,
      from: centre.point,
      to: tip.point,
      foreshortening: reference === 0 ? 0 : Math.min(1, drawn / reference),
    });
  }
  return out;
}

/**
 * How long an arm appears when it is fully broadside to the camera.
 *
 * Measured, not assumed: under perspective it depends on how far the origin is
 * from the lens, and a constant here would make the fade wrong at every
 * distance but one.
 */
function referenceLength(view: CameraView, origin: Vec3, length: number): number {
  const centre = project(view, origin);
  if (centre === null) return 0;
  let longest = 0;
  for (const axis of AXES) {
    const tip = project(view, tipOf(origin, axis, length));
    if (tip === null || !tip.inFront) continue;
    longest = Math.max(
      longest,
      Math.hypot(tip.point.x - centre.point.x, tip.point.y - centre.point.y),
    );
  }
  return longest;
}

/** Below this, an axis is too edge-on to aim at and is not offered. */
export const MIN_FORESHORTENING = 0.25;

/**
 * Which arm the pointer is over, in canvas coordinates.
 *
 * Distance to the SEGMENT, not to the infinite line: the arm has a far end,
 * and treating it as endless makes the whole ray beyond the arrowhead
 * grabbable — which steals clicks from everything behind it.
 */
export function pickAxis(
  projected: readonly ProjectedAxis[],
  canvas: Point,
  tolerance: number,
): Axis | null {
  let best: { axis: Axis; distance: number } | null = null;
  for (const arm of projected) {
    if (arm.foreshortening < MIN_FORESHORTENING) continue;
    const distance = distanceToSegment(canvas, arm.from, arm.to);
    if (distance > tolerance) continue;
    if (best === null || distance < best.distance) best = { axis: arm.axis, distance };
  }
  return best?.axis ?? null;
}

function distanceToSegment(point: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(point.x - a.x, point.y - a.y);
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared));
  return Math.hypot(point.x - (a.x + dx * t), point.y - (a.y + dy * t));
}

/**
 * Where along the axis the pointer is, as a distance from the origin.
 *
 * The closest point between the pointer ray and the axis line — the standard
 * two-skew-lines solve. Returns null when the ray is parallel to the axis, at
 * which point there is no answer and pretending otherwise sends the node to
 * infinity.
 */
export function axisParameterAt(
  view: CameraView,
  canvas: Point,
  origin: Vec3,
  axis: Axis,
): number | null {
  const ray = rayThrough(view, canvas);
  if (ray === null) return null;
  return closestOnAxis(ray, origin, axis.direction);
}

export function closestOnAxis(ray: Ray, origin: Vec3, direction: Vec3): number | null {
  const w0: Vec3 = {
    x: origin.x - ray.origin.x,
    y: origin.y - ray.origin.y,
    z: origin.z - ray.origin.z,
  };
  const a = dot(direction, direction);
  const b = dot(direction, ray.direction);
  const c = dot(ray.direction, ray.direction);
  const d = dot(direction, w0);
  const e = dot(ray.direction, w0);

  const denominator = a * c - b * b;
  // Parallel. There is no closest point, only a closest DISTANCE, and every
  // position along the axis is equally valid — which would read as the node
  // teleporting.
  if (Math.abs(denominator) < 1e-9) return null;

  return (b * e - c * d) / denominator;
}

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

/**
 * The world length an arm should be, to be drawn at a constant screen size.
 *
 * Solved by measuring rather than by inverting the projection, because the
 * projection may be orthographic — where distance does not affect size at all
 * — and one expression cannot be right for both. Two probes and a ratio is
 * correct for either.
 */
export function armLength(
  view: CameraView,
  origin: Vec3,
  screenPixels: number,
  fallback = 1,
): number {
  const probe = 1;
  const centre = project(view, origin);
  const tip = project(view, { x: origin.x + probe, y: origin.y, z: origin.z });
  if (centre === null || tip === null || !centre.inFront) return fallback;

  const drawn = Math.hypot(tip.point.x - centre.point.x, tip.point.y - centre.point.y);
  if (drawn < 1e-6) return fallback;
  return (screenPixels / drawn) * probe;
}

/**
 * Where a free (unconstrained) drag lands: the plane through the origin that
 * most faces the camera.
 *
 * Kept here beside the axis solve because it is the same question answered for
 * the no-axis case, and separating them is how the two drift apart.
 */
export function freeDragPoint(view: CameraView, canvas: Point, origin: Vec3): Vec3 | null {
  const ray = rayThrough(view, canvas);
  if (ray === null) return null;
  return intersectPlane(ray, origin.z);
}
