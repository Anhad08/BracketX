/**
 * Rotate and scale, in three dimensions.
 *
 * ============================================================================
 * MOVE ALREADY EXISTED. THE OTHER TWO DID NOT
 * ============================================================================
 * `axis.ts` gave the viewport a three-axis MOVE gizmo. Rotate and scale were
 * still the flat editor's handles — a corner box and a stem, computed from a
 * screen-space rectangle and solved against the z = 0 plane.
 *
 * Which means that in 3D you could rotate an object about Z and nothing else,
 * and scale it in X and Y and nothing else. Turn a logo to face the camera:
 * impossible. Give a plinth depth by dragging: impossible. "Orbit. Move.
 * Rotate. Scale." was one third of a sentence.
 *
 * This is the other two thirds, and it is deliberately built on the same
 * pieces as the move gizmo — the same `project`, the same `armLength`, the
 * same foreshortening rule, the same axis colours. Three gizmos that agreed
 * about nothing would be three interaction models in one viewport.
 *
 * ============================================================================
 * EVERYTHING HERE IS SCREEN-SPACE GEOMETRY AND NOTHING DRAWS
 * ============================================================================
 * As with the axis gizmo and the helpers: this decides where, the component
 * decides how. Nothing touches the document — a gizmo that edited would be a
 * second path to a transform, and the transform path is a transaction.
 */
import { AXES, MIN_FORESHORTENING, type Axis, type AxisId } from "./axis";
import {
  eulerFromMatrix,
  multiply,
  project,
  rayThrough,
  rotationAbout,
  worldFromEuler,
  type CameraView,
  type Mat4,
  type Vec3,
} from "./camera";
import type { Point } from "./viewport";

/** Which transform the gizmo is currently offering. */
export type GizmoMode = "move" | "rotate" | "scale";

export const GIZMO_MODES: readonly {
  readonly id: GizmoMode;
  readonly label: string;
  readonly key: string;
  readonly hint: string;
}[] = [
  { id: "move", label: "Move", key: "G", hint: "Drag an arrow to slide along that axis" },
  { id: "rotate", label: "Rotate", key: "R", hint: "Drag a ring to turn about that axis" },
  { id: "scale", label: "Scale", key: "S", hint: "Drag a handle to stretch along that axis" },
];

// ---------------------------------------------------------------------------
// Rotate — three rings
// ---------------------------------------------------------------------------

export interface ProjectedRing {
  readonly axis: Axis;
  /** The ring as a screen-space polyline, already closed. */
  readonly points: readonly Point[];
  /**
   * How edge-on the ring's PLANE is, 0 to 1.
   *
   * A ring seen exactly edge-on is a line, and dragging a line to say "turn by
   * this much" is guesswork. Faded and refused below the same threshold the
   * move arms use, so the two gizmos behave the same way in the same
   * situation.
   */
  readonly openness: number;
}

/**
 * THE FRAME THE GIZMO WORKS IN.
 *
 * ============================================================================
 * WHY THIS IS NOT SIMPLY THE WORLD AXES
 * ============================================================================
 * A scale handle drawn along world X that stretches the node's LOCAL X is a
 * control that lies as soon as the node is turned: the red handle points one
 * way and the object grows another. Rotate has the same problem in reverse.
 *
 * So the frame is the SELECTION'S OWN, read off its world matrix, and every
 * solve below takes a world-space direction rather than an axis name. World
 * axes are then just the frame of an unturned object, which is why one code
 * path serves both and there is no local/global mode to get wrong.
 */
export type AxisFrame = readonly [Axis, Axis, Axis];

export const WORLD_FRAME: AxisFrame = [AXES[0]!, AXES[1]!, AXES[2]!];

/**
 * The frame a node is in, from its world matrix.
 *
 * The first three columns are the node's own axes in world space. Normalised,
 * because a scaled node's columns are not unit vectors and a direction that is
 * not unit length turns every distance solve below into a distance in the
 * wrong units.
 *
 * Falls back to the world frame when the matrix is missing or degenerate — a
 * gizmo that vanished because a node happened to be scaled to zero would be
 * the only way of un-scaling it disappearing at the moment it is needed.
 */
export function frameOf(world: Mat4 | undefined): AxisFrame {
  if (world === undefined) return WORLD_FRAME;
  const columns: Vec3[] = [
    { x: world[0] ?? 0, y: world[1] ?? 0, z: world[2] ?? 0 },
    { x: world[4] ?? 0, y: world[5] ?? 0, z: world[6] ?? 0 },
    { x: world[8] ?? 0, y: world[9] ?? 0, z: world[10] ?? 0 },
  ];
  const out: Axis[] = [];
  for (let index = 0; index < 3; index += 1) {
    const column = columns[index]!;
    const length = Math.hypot(column.x, column.y, column.z);
    if (length < 1e-6) return WORLD_FRAME;
    out.push({
      ...AXES[index]!,
      direction: { x: column.x / length, y: column.y / length, z: column.z / length },
    });
  }
  return out as unknown as AxisFrame;
}

/** Two unit vectors spanning the plane an axis is normal to, within its frame. */
function basisFor(frame: AxisFrame, index: number): readonly [Vec3, Vec3] {
  return [frame[(index + 1) % 3]!.direction, frame[(index + 2) % 3]!.direction];
}

const RING_SEGMENTS = 48;

/**
 * The three rings as drawn.
 *
 * `radius` is in world units and is the caller's business, exactly as the move
 * gizmo's `length` is: it should come from `armLength` so the rings stay a
 * constant size on screen rather than growing with the zoom.
 */
export function projectRings(
  view: CameraView,
  origin: Vec3,
  radius: number,
  frame: AxisFrame = WORLD_FRAME,
): readonly ProjectedRing[] {
  const out: ProjectedRing[] = [];

  for (let axisIndex = 0; axisIndex < 3; axisIndex += 1) {
    const axis = frame[axisIndex]!;
    const [u, v] = basisFor(frame, axisIndex);
    const points: Point[] = [];
    let ok = true;

    for (let index = 0; index <= RING_SEGMENTS; index += 1) {
      const theta = (index / RING_SEGMENTS) * Math.PI * 2;
      const cos = Math.cos(theta) * radius;
      const sin = Math.sin(theta) * radius;
      const world: Vec3 = {
        x: origin.x + u.x * cos + v.x * sin,
        y: origin.y + u.y * cos + v.y * sin,
        z: origin.z + u.z * cos + v.z * sin,
      };
      const projected = project(view, world);
      // A ring with any point behind the camera is not drawn at all. Clipping
      // it would leave an arc that reads as a different ring.
      if (projected === null || !projected.inFront) {
        ok = false;
        break;
      }
      points.push(projected.point);
    }
    if (!ok || points.length === 0) continue;

    out.push({ axis, points, openness: opennessOf(points) });
  }
  return out;
}

/**
 * How open a projected ring looks, 0 to 1.
 *
 * Measured from the DRAWN points rather than from the ring's normal, so it is
 * right for an orthographic projection as well as a perspective one.
 *
 * The obvious measure — the bounding box's shorter side over its longer — is
 * wrong, and wrong in exactly the case that matters: a ring seen edge-on at
 * forty-five degrees draws a diagonal line whose bounding box is a SQUARE, so
 * it would score as fully open and the hit test would offer a target that is
 * one pixel wide. So the spread is taken along the point cloud's own principal
 * directions instead, where a line scores zero however it is angled.
 */
function opennessOf(points: readonly Point[]): number {
  if (points.length < 3) return 0;
  let cx = 0;
  let cy = 0;
  for (const point of points) {
    cx += point.x;
    cy += point.y;
  }
  cx /= points.length;
  cy /= points.length;

  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (const point of points) {
    const dx = point.x - cx;
    const dy = point.y - cy;
    sxx += dx * dx;
    sxy += dx * dy;
    syy += dy * dy;
  }

  const half = (sxx + syy) / 2;
  const spread = Math.sqrt(Math.max(0, ((sxx - syy) / 2) ** 2 + sxy * sxy));
  const major = half + spread;
  const minor = half - spread;
  if (major < 1e-9) return 0;
  // Square-rooted because these are variances and the ratio wanted is of
  // LENGTHS — an ellipse half as tall as it is wide has a quarter the variance.
  return Math.sqrt(Math.max(0, minor) / major);
}

/** Distance from a point to a polyline, in screen space. */
function distanceToPolyline(points: readonly Point[], at: Point): number {
  let best = Infinity;
  for (let index = 0; index < points.length - 1; index += 1) {
    const a = points[index]!;
    const b = points[index + 1]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lengthSquared = dx * dx + dy * dy;
    const t =
      lengthSquared < 1e-9
        ? 0
        : Math.max(0, Math.min(1, ((at.x - a.x) * dx + (at.y - a.y) * dy) / lengthSquared));
    const distance = Math.hypot(at.x - (a.x + dx * t), at.y - (a.y + dy * t));
    if (distance < best) best = distance;
  }
  return best;
}

/**
 * The ring under a point, or null.
 *
 * Nearest wins, and rings too edge-on to aim at are refused — the same rule
 * the move gizmo applies to an arm pointing at the camera, for the same
 * reason: an ambiguous target is worse than no target.
 */
export function pickRing(
  rings: readonly ProjectedRing[],
  at: Point,
  tolerance = 7,
): AxisId | null {
  let best: AxisId | null = null;
  let bestDistance = tolerance;
  for (const ring of rings) {
    if (ring.openness < MIN_FORESHORTENING) continue;
    const distance = distanceToPolyline(ring.points, at);
    if (distance <= bestDistance) {
      bestDistance = distance;
      best = ring.axis.id;
    }
  }
  return best;
}

/**
 * The angle of a pointer around an axis, in radians, measured in the axis's
 * own plane.
 *
 * Solved in WORLD space by intersecting the pointer ray with the plane the
 * ring lies in, rather than by measuring the angle on screen. Screen angle is
 * wrong the moment the ring is tilted: an ellipse's parameter is not its
 * apparent angle, so a drag along the flat side of a tilted ring would turn
 * the object far more than the pointer moved.
 */
export function angleAt(
  view: CameraView,
  canvas: Point,
  origin: Vec3,
  axisId: AxisId,
  frame: AxisFrame = WORLD_FRAME,
): number | null {
  const axisIndex = frame.findIndex((entry) => entry.id === axisId);
  if (axisIndex === -1) return null;
  const axis = frame[axisIndex]!;
  const ray = rayThrough(view, canvas);
  if (ray === null) return null;
  const hit = intersectAxisPlane(ray, origin, axis);
  if (hit === null) return null;

  const [u, v] = basisFor(frame, axisIndex);
  const dx = hit.x - origin.x;
  const dy = hit.y - origin.y;
  const dz = hit.z - origin.z;
  return Math.atan2(dx * v.x + dy * v.y + dz * v.z, dx * u.x + dy * u.y + dz * u.z);
}

/** Ray against the plane through `origin` whose normal is the axis. */
function intersectAxisPlane(
  ray: { readonly origin: Vec3; readonly direction: Vec3 },
  origin: Vec3,
  axis: Axis,
): Vec3 | null {
  const n = axis.direction;
  const denominator = ray.direction.x * n.x + ray.direction.y * n.y + ray.direction.z * n.z;
  // Parallel: the pointer is sliding along the plane and never meets it.
  if (Math.abs(denominator) < 1e-6) return null;
  const t =
    ((origin.x - ray.origin.x) * n.x +
      (origin.y - ray.origin.y) * n.y +
      (origin.z - ray.origin.z) * n.z) /
    denominator;
  if (t < 0) return null;
  return {
    x: ray.origin.x + ray.direction.x * t,
    y: ray.origin.y + ray.direction.y * t,
    z: ray.origin.z + ray.direction.z * t,
  };
}

/**
 * The shortest signed turn from one angle to another.
 *
 * Without this a drag that crosses the −π/π seam reports nearly a full turn in
 * the wrong direction, and the object spins away from the pointer.
 */
export function turnBetween(from: number, to: number): number {
  let delta = to - from;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
}

/** Degrees, snapped when asked. Broadcast angles are whole numbers. */
export function degreesOf(radians: number, snapTo = 0): number {
  const degrees = (radians * 180) / Math.PI;
  return snapTo > 0 ? Math.round(degrees / snapTo) * snapTo : degrees;
}

/**
 * A node's stored rotation after a turn about a WORLD axis.
 *
 * The gap this closes: the gizmo's rings lie in world planes, and a node
 * stores a LOCAL YXZ euler. Adding the drag's angle to one euler component is
 * the obvious thing and it is wrong the moment the node is already turned
 * about a different axis — the object drifts off the ring you are dragging and
 * no amount of correcting brings it back.
 *
 * So it is composed as matrices, PRE-multiplied, because the turn happens in
 * world space and the node's own rotation happens first.
 */
export function turnedEuler(
  start: readonly [number, number, number],
  direction: Vec3,
  radians: number,
): readonly [number, number, number] {
  const composed: Mat4 = multiply(
    rotationAbout(direction, radians),
    worldFromEuler({ x: 0, y: 0, z: 0 }, start),
  );
  return eulerFromMatrix(composed);
}

/** A world point turned about a world direction through a pivot. */
export function turnedAbout(
  point: readonly [number, number, number],
  pivot: Vec3,
  direction: Vec3,
  radians: number,
): readonly [number, number, number] {
  const m = rotationAbout(direction, radians);
  const x = point[0] - pivot.x;
  const y = point[1] - pivot.y;
  const z = point[2] - pivot.z;
  return [
    pivot.x + (m[0] ?? 1) * x + (m[4] ?? 0) * y + (m[8] ?? 0) * z,
    pivot.y + (m[1] ?? 0) * x + (m[5] ?? 1) * y + (m[9] ?? 0) * z,
    pivot.z + (m[2] ?? 0) * x + (m[6] ?? 0) * y + (m[10] ?? 1) * z,
  ];
}

// ---------------------------------------------------------------------------
// Scale — three handles
// ---------------------------------------------------------------------------

export interface ProjectedScaleHandle {
  readonly axis: Axis;
  readonly from: Point;
  /** Where the cap is drawn, and the point the hit test measures against. */
  readonly at: Point;
  readonly foreshortening: number;
}

/**
 * The three scale handles as drawn.
 *
 * Shorter than the move arms on purpose. Both gizmos are never on screen at
 * once, but they share an origin and a colour convention, and an operator who
 * switches between them should see the difference immediately rather than
 * having to read the cap shape.
 */
export function projectScaleHandles(
  view: CameraView,
  origin: Vec3,
  length: number,
  frame: AxisFrame = WORLD_FRAME,
): readonly ProjectedScaleHandle[] {
  const centre = project(view, origin);
  if (centre === null || !centre.inFront) return [];

  const out: ProjectedScaleHandle[] = [];
  for (const axis of frame) {
    const tip = project(view, {
      x: origin.x + axis.direction.x * length,
      y: origin.y + axis.direction.y * length,
      z: origin.z + axis.direction.z * length,
    });
    if (tip === null || !tip.inFront) continue;

    const drawn = Math.hypot(
      tip.point.x - centre.point.x,
      tip.point.y - centre.point.y,
    );
    const perpendicular = perpendicularLength(view, origin, length);
    out.push({
      axis,
      from: centre.point,
      at: tip.point,
      foreshortening: perpendicular < 1e-6 ? 0 : Math.min(1, drawn / perpendicular),
    });
  }
  return out;
}

/** How long an arm of `length` draws when square-on. The foreshortening base. */
function perpendicularLength(view: CameraView, origin: Vec3, length: number): number {
  const centre = project(view, origin);
  if (centre === null) return 0;
  // A probe along the camera's own right vector is by definition perpendicular
  // to the view direction, so it suffers no foreshortening at all.
  const right: Vec3 = {
    x: view.world[0] ?? 1,
    y: view.world[1] ?? 0,
    z: view.world[2] ?? 0,
  };
  const tip = project(view, {
    x: origin.x + right.x * length,
    y: origin.y + right.y * length,
    z: origin.z + right.z * length,
  });
  if (tip === null) return 0;
  return Math.hypot(tip.point.x - centre.point.x, tip.point.y - centre.point.y);
}

/** The scale handle under a point, or null. Nearest cap wins. */
export function pickScaleHandle(
  handles: readonly ProjectedScaleHandle[],
  at: Point,
  tolerance = 9,
): AxisId | null {
  let best: AxisId | null = null;
  let bestDistance = tolerance;
  for (const handle of handles) {
    if (handle.foreshortening < MIN_FORESHORTENING) continue;
    const distance = Math.hypot(handle.at.x - at.x, handle.at.y - at.y);
    if (distance <= bestDistance) {
      bestDistance = distance;
      best = handle.axis.id;
    }
  }
  return best;
}

/**
 * The scale factor a drag implies, from the pointer's distance along the axis.
 *
 * A ratio of distances rather than a delta, so that dragging twice as far from
 * the pivot doubles the object whichever direction the axis happens to point
 * on screen. Clamped away from zero: a factor of zero collapses the object to
 * nothing and there is no gesture that recovers it.
 */
export function scaleFactor(
  startDistance: number,
  currentDistance: number,
  minimum = 0.02,
): number {
  if (Math.abs(startDistance) < 1e-6) return 1;
  return Math.max(minimum, currentDistance / startDistance);
}

/** Signed distance of the pointer from the pivot, along one axis. */
export function distanceAlongAxis(
  view: CameraView,
  canvas: Point,
  origin: Vec3,
  axisId: AxisId,
  frame: AxisFrame = WORLD_FRAME,
): number | null {
  const axis = frame.find((entry) => entry.id === axisId);
  if (axis === undefined) return null;
  const ray = rayThrough(view, canvas);
  if (ray === null) return null;

  // The same two-skew-lines solve the move gizmo uses, kept in step with it by
  // being the same shape of arithmetic rather than the same call: this one
  // wants a signed distance, that one wants a parameter.
  const d1 = axis.direction;
  const d2 = ray.direction;
  const w0: Vec3 = {
    x: origin.x - ray.origin.x,
    y: origin.y - ray.origin.y,
    z: origin.z - ray.origin.z,
  };
  const a = d1.x * d1.x + d1.y * d1.y + d1.z * d1.z;
  const b = d1.x * d2.x + d1.y * d2.y + d1.z * d2.z;
  const c = d2.x * d2.x + d2.y * d2.y + d2.z * d2.z;
  const d = d1.x * w0.x + d1.y * w0.y + d1.z * w0.z;
  const e = d2.x * w0.x + d2.y * w0.y + d2.z * w0.z;
  const denominator = a * c - b * b;
  // Parallel: the axis points straight down the pointer ray and there is no
  // unique answer.
  if (Math.abs(denominator) < 1e-9) return null;
  return (b * e - c * d) / denominator;
}

/** A fallback pivot when a selection has no bounds of its own. */
export function pivotOf(
  bounds: { readonly x: number; readonly y: number } | null,
  fallback: Vec3 = { x: 0, y: 0, z: 0 },
): Vec3 {
  return bounds === null ? fallback : { x: bounds.x, y: bounds.y, z: fallback.z };
}
