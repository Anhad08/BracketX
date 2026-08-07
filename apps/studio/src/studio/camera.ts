/**
 * The camera, as the editor must see it.
 *
 * ==========================================================================
 * WHY THIS EXISTS
 * ==========================================================================
 * Studio's original viewport maths was a 2D affine map: canvas pixels per
 * world unit, derived from the active camera's orthographic size and nothing
 * else. It ignored where the camera WAS, which way it was POINTING, and
 * whether it was perspective at all.
 *
 * That is fine for a lower third and wrong for everything this product
 * promises. It is also the reason orbit could not simply be added: the moment
 * a camera moves off the Z axis, an affine map puts every handle, every hit
 * test and every marquee somewhere the graphic is not — while the rendered
 * picture stays perfectly correct. Gizmos silently wrong and the scene looking
 * fine is the worst failure an editor has.
 *
 * So this module projects the way the renderer projects: view = inverse of the
 * camera's world matrix, then a standard GL projection built from the SAME
 * `CameraDescriptor` the projector handed the backend. The parameters have one
 * source; only the arithmetic is repeated, and `camera.test.ts` pins that
 * arithmetic against three.js so the two cannot drift.
 *
 * ==========================================================================
 * SPACES
 * ==========================================================================
 *   world     scene units, Y up, Z toward the viewer
 *   view      world seen from the camera, looking down its own −Z
 *   clip/NDC  −1..1 on each axis
 *   canvas    output pixels, Y DOWN, origin top-left — what the engine renders
 *
 * `viewport.ts` owns canvas → screen (the designer's pan and zoom). This
 * module stops at canvas, so navigating the stage and moving the camera stay
 * the separate things they are.
 */

import type { CameraDescriptor } from "@bracketx/engine-reconciler";
import type { Point } from "./viewport";

/** Column-major 4x4, the same layout three.js and WebGL use. */
export type Mat4 = readonly number[];

export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface Ray {
  readonly origin: Vec3;
  readonly direction: Vec3;
}

/** Everything needed to project, gathered once per frame. */
export interface CameraView {
  readonly descriptor: CameraDescriptor;
  /** The camera's world matrix, as the mirror reports it. */
  readonly world: Mat4;
  readonly canvas: { readonly width: number; readonly height: number };
}

// ---------------------------------------------------------------------------
// Matrix arithmetic
// ---------------------------------------------------------------------------

export function multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Array<number>(16).fill(0);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      let sum = 0;
      for (let k = 0; k < 4; k += 1) sum += (a[k * 4 + row] ?? 0) * (b[column * 4 + k] ?? 0);
      out[column * 4 + row] = sum;
    }
  }
  return out;
}

/**
 * A general 4x4 inverse.
 *
 * Not the "transpose the rotation, negate the translation" shortcut: a camera
 * may be inside a scaled group, and the shortcut is wrong there in a way that
 * only shows up on scenes complex enough that nobody suspects the maths.
 */
export function invert(m: Mat4): Mat4 | null {
  const a = m;
  const inv = new Array<number>(16).fill(0);
  const g = (i: number): number => a[i] ?? 0;

  inv[0] = g(5) * g(10) * g(15) - g(5) * g(11) * g(14) - g(9) * g(6) * g(15) +
    g(9) * g(7) * g(14) + g(13) * g(6) * g(11) - g(13) * g(7) * g(10);
  inv[4] = -g(4) * g(10) * g(15) + g(4) * g(11) * g(14) + g(8) * g(6) * g(15) -
    g(8) * g(7) * g(14) - g(12) * g(6) * g(11) + g(12) * g(7) * g(10);
  inv[8] = g(4) * g(9) * g(15) - g(4) * g(11) * g(13) - g(8) * g(5) * g(15) +
    g(8) * g(7) * g(13) + g(12) * g(5) * g(11) - g(12) * g(7) * g(9);
  inv[12] = -g(4) * g(9) * g(14) + g(4) * g(10) * g(13) + g(8) * g(5) * g(14) -
    g(8) * g(6) * g(13) - g(12) * g(5) * g(10) + g(12) * g(6) * g(9);
  inv[1] = -g(1) * g(10) * g(15) + g(1) * g(11) * g(14) + g(9) * g(2) * g(15) -
    g(9) * g(3) * g(14) - g(13) * g(2) * g(11) + g(13) * g(3) * g(10);
  inv[5] = g(0) * g(10) * g(15) - g(0) * g(11) * g(14) - g(8) * g(2) * g(15) +
    g(8) * g(3) * g(14) + g(12) * g(2) * g(11) - g(12) * g(3) * g(10);
  inv[9] = -g(0) * g(9) * g(15) + g(0) * g(11) * g(13) + g(8) * g(1) * g(15) -
    g(8) * g(3) * g(13) - g(12) * g(1) * g(11) + g(12) * g(3) * g(9);
  inv[13] = g(0) * g(9) * g(14) - g(0) * g(10) * g(13) - g(8) * g(1) * g(14) +
    g(8) * g(2) * g(13) + g(12) * g(1) * g(10) - g(12) * g(2) * g(9);
  inv[2] = g(1) * g(6) * g(15) - g(1) * g(7) * g(14) - g(5) * g(2) * g(15) +
    g(5) * g(3) * g(14) + g(13) * g(2) * g(7) - g(13) * g(3) * g(6);
  inv[6] = -g(0) * g(6) * g(15) + g(0) * g(7) * g(14) + g(4) * g(2) * g(15) -
    g(4) * g(3) * g(14) - g(12) * g(2) * g(7) + g(12) * g(3) * g(6);
  inv[10] = g(0) * g(5) * g(15) - g(0) * g(7) * g(13) - g(4) * g(1) * g(15) +
    g(4) * g(3) * g(13) + g(12) * g(1) * g(7) - g(12) * g(3) * g(5);
  inv[14] = -g(0) * g(5) * g(14) + g(0) * g(6) * g(13) + g(4) * g(1) * g(14) -
    g(4) * g(2) * g(13) - g(12) * g(1) * g(6) + g(12) * g(2) * g(5);
  inv[3] = -g(1) * g(6) * g(11) + g(1) * g(7) * g(10) + g(5) * g(2) * g(11) -
    g(5) * g(3) * g(10) - g(9) * g(2) * g(7) + g(9) * g(3) * g(6);
  inv[7] = g(0) * g(6) * g(11) - g(0) * g(7) * g(10) - g(4) * g(2) * g(11) +
    g(4) * g(3) * g(10) + g(8) * g(2) * g(7) - g(8) * g(3) * g(6);
  inv[11] = -g(0) * g(5) * g(11) + g(0) * g(7) * g(9) + g(4) * g(1) * g(11) -
    g(4) * g(3) * g(9) - g(8) * g(1) * g(7) + g(8) * g(3) * g(5);
  inv[15] = g(0) * g(5) * g(10) - g(0) * g(6) * g(9) - g(4) * g(1) * g(10) +
    g(4) * g(2) * g(9) + g(8) * g(1) * g(6) - g(8) * g(2) * g(5);

  const determinant = g(0) * inv[0]! + g(1) * inv[4]! + g(2) * inv[8]! + g(3) * inv[12]!;
  // A degenerate matrix means a zero scale somewhere. Returning null lets the
  // caller fall back rather than filling the scene with NaN, which propagates
  // into every handle position and is impossible to trace back here.
  if (determinant === 0 || !Number.isFinite(determinant)) return null;

  const scale = 1 / determinant;
  return inv.map((value) => value * scale);
}

/** Vertical field of view in radians, from the descriptor's physical camera. */
export function verticalFov(descriptor: CameraDescriptor, aspect: number): number {
  if (descriptor.kind === "orthographic") return 0;
  const sensorHeight = descriptor.sensorWidthMm / aspect;
  return 2 * Math.atan(sensorHeight / (2 * descriptor.focalLengthMm));
}

/**
 * The projection matrix, matching the renderer's for the same descriptor.
 *
 * `verticalFov` mirrors `verticalFovDegrees` in the render adapter, which is
 * the one number that must agree for a hit test to land on the pixel a
 * designer clicked.
 */
export function projectionMatrix(descriptor: CameraDescriptor, aspect: number): Mat4 {
  const near = descriptor.near;
  const far = descriptor.far;

  if (descriptor.kind === "orthographic") {
    const halfHeight = descriptor.size;
    const halfWidth = halfHeight * aspect;
    return [
      1 / halfWidth, 0, 0, 0,
      0, 1 / halfHeight, 0, 0,
      0, 0, -2 / (far - near), 0,
      0, 0, -(far + near) / (far - near), 1,
    ];
  }

  const f = 1 / Math.tan(verticalFov(descriptor, aspect) / 2);
  return [
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) / (near - far), -1,
    0, 0, (2 * far * near) / (near - far), 0,
  ];
}

/** view · world⁻¹, or null when the camera's matrix cannot be inverted. */
export function viewMatrix(view: CameraView): Mat4 | null {
  return invert(view.world);
}

// ---------------------------------------------------------------------------
// Projection
// ---------------------------------------------------------------------------

export interface Projected {
  readonly point: Point;
  /**
   * True when the point is in front of the camera.
   *
   * A perspective projection maps points BEHIND the camera to valid-looking
   * screen coordinates, mirrored through the centre. An editor that ignored
   * this draws a handle for a node behind the lens, and clicking it moves
   * something nobody can see.
   */
  readonly inFront: boolean;
}

/** World → canvas pixels. */
export function project(view: CameraView, world: Vec3): Projected | null {
  const viewMatrix_ = viewMatrix(view);
  if (viewMatrix_ === null) return null;
  const aspect = view.canvas.width / view.canvas.height;
  const clip = multiply(projectionMatrix(view.descriptor, aspect), viewMatrix_);

  const x = world.x;
  const y = world.y;
  const z = world.z;
  const cx = (clip[0] ?? 0) * x + (clip[4] ?? 0) * y + (clip[8] ?? 0) * z + (clip[12] ?? 0);
  const cy = (clip[1] ?? 0) * x + (clip[5] ?? 0) * y + (clip[9] ?? 0) * z + (clip[13] ?? 0);
  const cw = (clip[3] ?? 0) * x + (clip[7] ?? 0) * y + (clip[11] ?? 0) * z + (clip[15] ?? 0);
  if (cw === 0) return null;

  const ndcX = cx / cw;
  const ndcY = cy / cw;
  return {
    point: {
      x: (ndcX * 0.5 + 0.5) * view.canvas.width,
      // NDC Y is up, canvas Y is down.
      y: (0.5 - ndcY * 0.5) * view.canvas.height,
    },
    inFront: cw > 0,
  };
}

/** Canvas pixels → a ray through the scene. */
export function rayThrough(view: CameraView, canvas: Point): Ray | null {
  const viewMatrix_ = viewMatrix(view);
  if (viewMatrix_ === null) return null;
  const aspect = view.canvas.width / view.canvas.height;
  const inverseProjection = invert(projectionMatrix(view.descriptor, aspect));
  if (inverseProjection === null) return null;

  const ndcX = (canvas.x / view.canvas.width) * 2 - 1;
  const ndcY = 1 - (canvas.y / view.canvas.height) * 2;

  const near = unprojectNdc(inverseProjection, view.world, ndcX, ndcY, -1);
  const far = unprojectNdc(inverseProjection, view.world, ndcX, ndcY, 1);
  if (near === null || far === null) return null;

  const direction = normalise({ x: far.x - near.x, y: far.y - near.y, z: far.z - near.z });
  return direction === null ? null : { origin: near, direction };
}

function unprojectNdc(
  inverseProjection: Mat4,
  cameraWorld: Mat4,
  x: number,
  y: number,
  z: number,
): Vec3 | null {
  const vx = (inverseProjection[0] ?? 0) * x + (inverseProjection[4] ?? 0) * y +
    (inverseProjection[8] ?? 0) * z + (inverseProjection[12] ?? 0);
  const vy = (inverseProjection[1] ?? 0) * x + (inverseProjection[5] ?? 0) * y +
    (inverseProjection[9] ?? 0) * z + (inverseProjection[13] ?? 0);
  const vz = (inverseProjection[2] ?? 0) * x + (inverseProjection[6] ?? 0) * y +
    (inverseProjection[10] ?? 0) * z + (inverseProjection[14] ?? 0);
  const vw = (inverseProjection[3] ?? 0) * x + (inverseProjection[7] ?? 0) * y +
    (inverseProjection[11] ?? 0) * z + (inverseProjection[15] ?? 0);
  if (vw === 0) return null;

  const ex = vx / vw;
  const ey = vy / vw;
  const ez = vz / vw;
  return {
    x: (cameraWorld[0] ?? 0) * ex + (cameraWorld[4] ?? 0) * ey + (cameraWorld[8] ?? 0) * ez + (cameraWorld[12] ?? 0),
    y: (cameraWorld[1] ?? 0) * ex + (cameraWorld[5] ?? 0) * ey + (cameraWorld[9] ?? 0) * ez + (cameraWorld[13] ?? 0),
    z: (cameraWorld[2] ?? 0) * ex + (cameraWorld[6] ?? 0) * ey + (cameraWorld[10] ?? 0) * ez + (cameraWorld[14] ?? 0),
  };
}

/**
 * Where a ray meets the plane z = `planeZ`.
 *
 * The plane, not a sphere or a mesh: a broadcast scene is overwhelmingly flat
 * content at known depths, and picking against the plane a node lives on is
 * both exact for that case and cheap enough to run on every pointer move.
 */
export function intersectPlane(ray: Ray, planeZ = 0): Vec3 | null {
  if (Math.abs(ray.direction.z) < 1e-9) return null;
  const t = (planeZ - ray.origin.z) / ray.direction.z;
  // Behind the camera. Returning a point here is how an editor ends up
  // selecting something the designer cannot see.
  if (t < 0) return null;
  return {
    x: ray.origin.x + ray.direction.x * t,
    y: ray.origin.y + ray.direction.y * t,
    z: planeZ,
  };
}

function normalise(v: Vec3): Vec3 | null {
  const length = Math.hypot(v.x, v.y, v.z);
  if (length === 0 || !Number.isFinite(length)) return null;
  return { x: v.x / length, y: v.y / length, z: v.z / length };
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

export interface Orbit {
  /** Distance from the pivot. */
  readonly radius: number;
  /** Around Y, radians. */
  readonly azimuth: number;
  /** From the XZ plane, radians. Clamped away from the poles. */
  readonly elevation: number;
}

/** How close to straight up or down an orbit may get, in radians. */
const POLE_LIMIT = Math.PI / 2 - 0.01;

/**
 * The orbit a camera position describes about a pivot.
 *
 * Spherical coordinates rather than accumulated deltas: a camera driven by
 * deltas drifts, and worse, gimbals — drag in a circle for long enough and the
 * horizon rolls. Recovering the angles from the position each time makes the
 * gesture stateless and the horizon level by construction.
 */
export function orbitOf(position: Vec3, pivot: Vec3): Orbit {
  const dx = position.x - pivot.x;
  const dy = position.y - pivot.y;
  const dz = position.z - pivot.z;
  const radius = Math.hypot(dx, dy, dz);
  if (radius === 0) return { radius: 0, azimuth: 0, elevation: 0 };
  return {
    radius,
    azimuth: Math.atan2(dx, dz),
    elevation: Math.asin(Math.max(-1, Math.min(1, dy / radius))),
  };
}

export function positionFor(orbit: Orbit, pivot: Vec3): Vec3 {
  const elevation = Math.max(-POLE_LIMIT, Math.min(POLE_LIMIT, orbit.elevation));
  const horizontal = Math.cos(elevation) * orbit.radius;
  return {
    x: pivot.x + Math.sin(orbit.azimuth) * horizontal,
    y: pivot.y + Math.sin(elevation) * orbit.radius,
    z: pivot.z + Math.cos(orbit.azimuth) * horizontal,
  };
}

/** Applies a drag to an orbit. Radians per pixel is the caller's choice. */
export function orbitBy(orbit: Orbit, dx: number, dy: number, perPixel = 0.008): Orbit {
  return {
    radius: orbit.radius,
    azimuth: orbit.azimuth - dx * perPixel,
    elevation: Math.max(-POLE_LIMIT, Math.min(POLE_LIMIT, orbit.elevation + dy * perPixel)),
  };
}

/** Moves in and out along the view direction. Never through the pivot. */
export function dolly(orbit: Orbit, factor: number, minimum = 0.2): Orbit {
  return { ...orbit, radius: Math.max(minimum, orbit.radius * factor) };
}

/**
 * The rotation, in degrees, that aims a camera at a pivot from `position`.
 *
 * YXZ intrinsic, which is what SCENE_FORMAT §4 specifies and what the renderer
 * reads — the same order, so a camera authored here and a camera authored by
 * hand mean the same thing. Roll is always zero: a broadcast camera that
 * rolled while being orbited would be a bug, never a feature.
 */
/**
 * A world matrix from a position and a YXZ rotation in degrees.
 *
 * The inverse of `lookAtRotation`, and the composition the renderer performs
 * when it places a camera node. It lives here rather than in a test helper
 * because the editor needs it to reason about a camera it has just aimed —
 * and because a test that borrowed the renderer's matrix maths to check the
 * editor's would be tying the editor to a renderer, which is the one thing
 * this architecture spends effort preventing.
 *
 * YXZ intrinsic, matching SCENE_FORMAT §4: yaw, then pitch, then roll.
 */
export function worldFromEuler(
  position: Vec3,
  rotationDegrees: readonly [number, number, number],
): Mat4 {
  const d = Math.PI / 180;
  const x = rotationDegrees[0] * d;
  const y = rotationDegrees[1] * d;
  const z = rotationDegrees[2] * d;

  const cx = Math.cos(x), sx = Math.sin(x);
  const cy = Math.cos(y), sy = Math.sin(y);
  const cz = Math.cos(z), sz = Math.sin(z);

  // R = Ry · Rx · Rz, expanded. Column-major, as everything here is.
  const m11 = cy * cz + sy * sx * sz;
  const m12 = -cy * sz + sy * sx * cz;
  const m13 = sy * cx;
  const m21 = cx * sz;
  const m22 = cx * cz;
  const m23 = -sx;
  const m31 = -sy * cz + cy * sx * sz;
  const m32 = sy * sz + cy * sx * cz;
  const m33 = cy * cx;

  return [
    m11, m21, m31, 0,
    m12, m22, m32, 0,
    m13, m23, m33, 0,
    position.x, position.y, position.z, 1,
  ];
}

export function lookAtRotation(position: Vec3, pivot: Vec3): readonly [number, number, number] {
  const dx = position.x - pivot.x;
  const dy = position.y - pivot.y;
  const dz = position.z - pivot.z;
  const horizontal = Math.hypot(dx, dz);
  const yaw = Math.atan2(dx, dz);
  const pitch = Math.atan2(dy, horizontal);
  return [(-pitch * 180) / Math.PI, (yaw * 180) / Math.PI, 0];
}
